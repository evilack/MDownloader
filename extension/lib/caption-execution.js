import {CaptionModelCatalog,CaptionProcessingPolicy as Policy} from '../data/caption-runtime-metadata.js';
import {NormalizeRecognitionOptions} from './caption-engine-options.js';
import {CaptionOutputName,CaptionOptionsKey} from './local-captions-settings.js';
import {CaptionTextForFormat} from './generated-caption-translation.js';
import {ValidateCaptionWindow} from './concurrent-captions-contract.js';
import {CreateCaptionAudioPreparation} from './caption-audio-preparation.js';
import {CreateCaptionPreviewExecution} from './caption-preview.js';
import {UnionCaptionSpans,IntersectCaptionSpans,CaptionSpanLength,CaptionCovers,CaptionRationalSeconds} from './caption-timeline.js';
import {CaptionCueSource,CorrectCaptionOverlaps} from './caption-timing-correction.js';

import {ValidateCaptionPcmWav} from './caption-wav.js';

const Encoder=new TextEncoder(),Decoder=new TextDecoder('utf-8',{fatal:true});
const Fail=Code=>{throw Error(Code);};
const Integer=(N,Min=0)=>Number.isSafeInteger(N)&&N>=Min;
const Encode=Bytes=>{let S='';for(let I=0;I<Bytes.length;I+=8192)S+=String.fromCharCode(...Bytes.subarray(I,I+8192));return btoa(S);};
const Decode=S=>Uint8Array.from(atob(S),C=>C.charCodeAt(0));
const Digest=async Bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Bytes)),B=>B.toString(16).padStart(2,'0')).join('');
const ModelPath=O=>O.engine+'/'+O.model+(O.engine==='whisper.cpp'?'.bin':'');
const RequiredFiles=Engine=>Engine==='faster-whisper'?['model.bin','config.json','tokenizer.json']:[];

/** Application workflow. The native peer receives only individual executions.
 * Durable status is an opaque extension-owned file; native code never reads it.
 * A reconnect interrupts running work, rather than silently restarting inference.
 */
export function CreateCaptionExecution({request:Execute,emit=()=>{},now=Date.now}={}){
 const Jobs=new Map(),Models=new Map(),SessionOwners=new Set(),DecoderOwners=new Set(),DecoderReceipts=new Map(),WindowOwners=new Map(),ProbeCache=new Map();let Closed=false,Maintenance,Reopening;
 const Raw=async(Operation,Fields={},Scope='probe')=>{if(Closed)Fail('caption_helper_missing');return Execute({action:'execute',operation:Operation,scope:Scope,...Fields});};
 const File=(R,Name)=>R.id+'/'+Name;
 const Check=R=>{if(R.canceled)Fail('caption_canceled');if(Closed)Fail('caption_helper_missing');};
 const CheckpointBusy=R=>R.statePending||R.checkpoint||R.foreignCheckpoints?.length;
 const CheckpointTemps=Entries=>Entries.filter(E=>/^extension-state-[a-f\d-]{36}\.tmp$/i.test(E.name));
 const Run=async(R,Op,Fields={})=>{Check(R);if(Op==='write')await Admission(R,Math.ceil((Fields.data?.length||0)*3/4));Check(R);return Raw(Op,Fields,R.scope);};
 const EncodedPreparation=CreateCaptionAudioPreparation({run:Run,raw:Raw,read:Read,write:Write,file:File,admission:Admission,windowOwners:WindowOwners,decoderOwners:DecoderOwners,sessionOwners:SessionOwners});
 const PreviewExecution=CreateCaptionPreviewExecution({check:Check,run:Run,read:Read,write:Write,admission:Admission,preparation:EncodedPreparation,infer:Infer,append:AppendLedgerBytes});
 async function Admission(R,Addition=0,Force=false,Scope=R.scope){
  if(!R.id)return;R.diskEstimate=(R.diskEstimate||0)+Addition;
  if(!Force&&R.diskChecked&&R.diskEstimate<8*1024*1024)return;
  const [Job,All]=await Promise.all([Raw('usage',{area:'jobs',path:R.id},Scope),Raw('usage',{area:'jobs',path:''},Scope)]);
  if(Job.bytes+Addition>Policy.maxJobBytes||All.bytes+Addition>Policy.maxDiskBytes||All.free<Policy.minFreeBytes+Addition)Fail('caption_disk_full');
  R.diskChecked=true;R.diskEstimate=0;return {job:Job,all:All};
 }
 async function Read(Path,Scope='probe',Maximum=Policy.maxLedgerBytes,Area='jobs'){
  const Parts=[];let Offset=0;
  for(;;){const P=await Raw('read',{area:Area,path:Path,offset:Offset,maxBytes:Policy.uploadChunkBytes},Scope),B=Decode(P.data);
   if(P.offset!==Offset+B.length||P.offset>Maximum||!P.done&&!B.length)Fail('caption_result_limit');Parts.push(B);Offset=P.offset;if(P.done)break;}
  return new Uint8Array(await new Blob(Parts).arrayBuffer());
 }
 async function Write(Path,Bytes,Scope,Area='jobs'){
  if(Bytes.length>Policy.maxLedgerBytes)Fail('caption_result_limit');
  const R=Jobs.get(Path.split('/')[0]);if(Area==='jobs'&&R)await Admission(R,Bytes.length,false,Scope);
  if(!Bytes.length)return Raw('write',{area:Area,path:Path,offset:0,data:'',truncate:true},Scope);
  for(let Offset=0;Offset<Bytes.length;Offset+=Policy.uploadChunkBytes){const B=Bytes.subarray(Offset,Offset+Policy.uploadChunkBytes);await Raw('write',{area:Area,path:Path,offset:Offset,data:Encode(B),truncate:Offset===0},Scope);}
 }
 function AcceptCheckpoint(R,P){
  const {checkpoint,windowLedger,resultCursor,resultOrder,resultPage,finalCueUpload,...Public}=P.snapshot;
  R.checkpointSignature=P.signature;R.persistedPublic=Public;P.accepted=true;
  emit({event:'state',jobId:R.id,...Public});return Public;
 }
 async function SettleCheckpoint(R){
  const P=R.checkpoint;if(!P)return;
  // An absent/old target cannot resolve a move that is still in flight. Stop
  // only this publication's scope before reading or removing its owned temp.
  if(!P.quiescent&&!P.disconnected){const C=await Execute({action:'cancelExecution',scope:P.scope});if(C?.canceled!==true)Fail('caption_checkpoint_uncertain');if(!P.disconnected)P.quiescent=true;}
  const Scope='cleanup.'+crypto.randomUUID();
  if(P.publishing&&!P.outcome){
   P.observed='unknown';
   const S=await Raw('stat',{area:'jobs',path:File(R,'extension-state.json')},Scope);
   const Signature=S.exists?await Digest(await Read(File(R,'extension-state.json'),Scope)):null;
   if(Signature===P.signature)P.outcome=P.observed='published';
   else if(Signature===P.previous){P.observed='previous';if(!P.quiescent)Fail('caption_checkpoint_uncertain');P.outcome='previous';}
   else {P.observed='mismatch';Fail('caption_checkpoint_conflict');}
  }
  if(P.outcome==='published'){
   // Exact bytes include this generation, receipts and revision. Rename has
   // consumed the temp; never remove the accepted checkpoint.
   if(!P.accepted)AcceptCheckpoint(R,P);R.checkpoint=null;return;
  }
  // A replacement native connection cannot certify the old host's scope.
  // Preserve ownership if its last write/remove may still be in flight.
  if(!P.quiescent||P.cleanupDisconnected)Fail('caption_checkpoint_uncertain');
  if(P.cleanupScope){const C=await Execute({action:'cancelExecution',scope:P.cleanupScope});if(C?.canceled!==true||P.cleanupDisconnected)Fail('caption_checkpoint_cleanup');P.cleanupScope=null;}
  if(P.owned){
   const S=await Raw('stat',{area:'jobs',path:P.path},Scope);
   if(S.exists){P.cleanupScope=Scope;const D=await Raw('remove',{area:'jobs',path:P.path},Scope);if(D?.removed!==true)Fail('caption_checkpoint_cleanup');P.cleanupScope=null;}
   P.owned=false;
  }
  R.checkpoint=null;
 }
 function QueueState(R,Work){
  R.statePending=(R.statePending||0)+1;
  const Saving=(R.stateWrite||Promise.resolve()).catch(()=>{}).then(Work);R.stateWrite=Saving;
  return Saving.finally(()=>{R.statePending--;});
 }
 async function PublishCheckpoint(R,Snapshot,Scope){
  await SettleCheckpoint(R);
  const CheckState=()=>{if(Closed)Fail('caption_helper_missing');if(R.canceled&&Snapshot.phase!=='canceled')Fail('caption_canceled');if(Snapshot.phase!=='canceled'&&Scope!==R.scope)Fail('caption_stale_attempt');};
  CheckState();
  const Generation=crypto.randomUUID(),Payload=Encoder.encode(JSON.stringify(Snapshot));
  const Bytes=Encoder.encode(JSON.stringify({...Snapshot,checkpoint:{generation:Generation,sha256:await Digest(Payload)}}));
  if(Bytes.length>Policy.maxLedgerBytes)Fail('caption_result_limit');
  const Signature=await Digest(Bytes);CheckState();
  const P={snapshot:Snapshot,signature:Signature,previous:R.checkpointSignature??null,path:File(R,'extension-state-'+Generation+'.tmp'),scope:'checkpoint.'+Generation};
  // Never claim a pre-existing path, even when a UUID collision is unlikely.
  const S=await Raw('stat',{area:'jobs',path:P.path},P.scope);CheckState();if(S.exists)Fail('caption_result_conflict');
  R.checkpoint=P;P.owned=true;
  try{
   await Admission(R,Bytes.length,false,P.scope);
   for(let Offset=0;Offset<Bytes.length;Offset+=Policy.uploadChunkBytes){
    CheckState();const B=Bytes.subarray(Offset,Offset+Policy.uploadChunkBytes);
    const W=await Raw('write',{area:'jobs',path:P.path,offset:Offset,data:Encode(B),truncate:Offset===0},P.scope);
    if(W?.offset!==Offset+B.length)Fail('caption_protocol');
   }
   CheckState();P.publishing=true;
   const M=await Raw('move',{area:'jobs',source:P.path,target:File(R,'extension-state.json'),replace:true},P.scope);
   if(M?.moved!==true)Fail('caption_checkpoint_uncertain');
   P.outcome='published';const Public=AcceptCheckpoint(R,P);R.checkpoint=null;return Public;
  }catch(E){
   P.error=E.message;
   try{await SettleCheckpoint(R);}catch(ReconcileError){P.reconcileError=ReconcileError.message;throw ReconcileError;}
   if(P.accepted)return R.persistedPublic;throw E;
  }
 }
 async function State(R,Fields={},Scope=R.scope){
  if(R.foreignCheckpoints?.length)Fail('caption_checkpoint_uncertain');
  if(R.canceled&&Fields.phase!=='canceled')Fail('caption_canceled');
  Object.assign(R.state,Fields,{updated:now()/1000});
  const Snapshot=structuredClone({...R.state,...(R.state.mode==='windowed'?{windowLedger:[...R.windows.values()].map(W=>({window:W.window,phase:W.phase,offset:W.offset||0,result:W.result,resultBytes:W.resultBytes,receipts:W.receipts||[],ack:W.phase==='acked'})),resultCursor:R.resultCursor||0,resultOrder:[...R.results],resultPage:R.resultPage||null,finalCueUpload:R.finalCueUpload||null}: {})});
  return QueueState(R,()=>PublishCheckpoint(R,Snapshot,Scope));
 }
 async function Job(M,Create=false){
  if(typeof M.jobId!=='string'||!/^[a-f\d-]{36}$/i.test(M.jobId))Fail('caption_invalid');
  let R=Jobs.get(M.jobId);
  if(!R){
   R={id:M.jobId,scope:M.jobId+'.'+crypto.randomUUID(),state:{},windows:new Map(),results:[],decoders:new Map(),closedDecoders:new Map(),tasks:new Set(),canceled:false};Jobs.set(M.jobId,R);
   R.loading=(async()=>{
    // A fresh executor cannot cancel a previous host's scope. Observe temp
    // sources before reading the accepted file: an old queued move may still
    // consume one. Preserve them and permit durable reads, not a new writer.
    const {entries:Entries}=await Raw('list',{area:'jobs',path:R.id});R.foreignCheckpoints=CheckpointTemps(Entries);
    const S=await Raw('stat',{area:'jobs',path:File(R,'extension-state.json')});
    if(S.exists){const Bytes=await Read(File(R,'extension-state.json')),Signature=await Digest(Bytes),{checkpoint,...Snapshot}=JSON.parse(Decoder.decode(Bytes));
     if(checkpoint){if(typeof checkpoint.generation!=='string'||!/^[-a-f\d]{36}$/i.test(checkpoint.generation)||checkpoint.sha256!==await Digest(Encoder.encode(JSON.stringify(Snapshot))))Fail('caption_checkpoint_conflict');}
     else if(R.foreignCheckpoints.length&&Signature!==await Digest(await Read(File(R,'extension-state.json'))))Fail('caption_checkpoint_uncertain');
     R.checkpointSignature=Signature;const {windowLedger,resultCursor,resultOrder,resultPage,finalCueUpload,...Saved}=Snapshot;R.state=Saved;R.persistedPublic={...Saved};
     if(windowLedger){if(!Array.isArray(windowLedger)||windowLedger.length>Policy.maxWindows)Fail('caption_result_limit');
      for(const W of windowLedger){ValidateCaptionWindow(W.window);if(R.windows.has(W.window.id))Fail('caption_result_conflict');R.windows.set(W.window.id,{...W,creditReleased:W.phase==='acked'});}
      if(!Array.isArray(resultOrder)||resultOrder.length>Policy.maxWindows||resultOrder.some(Id=>!R.windows.has(Id))||!Integer(resultCursor)||resultCursor>resultOrder.length)Fail('caption_result_cursor');
      R.results=resultOrder;R.resultCursor=resultCursor;R.resultPage=resultPage;R.finalCueUpload=finalCueUpload;R.finalCues=finalCueUpload?.done===true;
     }
     R.recoveryNeeded=!['recognized','complete','canceled','failed'].includes(R.state.phase);}})();
  }
  await R.loading;
  if(R.recoveryNeeded&&!R.foreignCheckpoints?.length){R.recovering??=State(R,{phase:'failed',error:'caption_source_missing'}).then(()=>{R.recoveryNeeded=false;}).finally(()=>{R.recovering=null;});await R.recovering;}
  if(!Create&&R.state.attempt!==undefined&&M.attempt!==R.state.attempt)Fail('caption_stale_attempt');
  return R;
 }
 function Options(Value){
  if(!Value||!CaptionModelCatalog[Value.model]?.[Value.engine]||typeof Value.language!=='string'||!Array.isArray(Value.formats)||!Value.formats.length||Value.formats.some(F=>!['srt','vtt'].includes(F)))Fail('caption_invalid');
  return {...Value,recognition:NormalizeRecognitionOptions(Value.recognition,Value.engine,{strict:true})};
 }
 function Background(R,Work,Preparation=false){
  const P=(async()=>{try{await Work();}catch(E){
   let Failure=E,Cleaned=false;try{await CloseSession(R);await CloseDecoders(R);await EncodedPreparation.release(R);Cleaned=true;}catch(CloseError){Failure=CloseError;}
   if(!R.canceled&&!Closed)await State(R,{phase:Preparation?'preparation-failed':'failed',error:Failure.message?.startsWith('caption_')?Failure.message:'caption_recognition_failed',sourceError:E.message});
   if(Cleaned)for(const W of R.windows.values())WindowOwners.delete(R.id+':'+W.window.id);
  }})();
  R.tasks.add(P);P.then(()=>R.tasks.delete(P),()=>R.tasks.delete(P));return P;
 }
 async function Probe(M){
  let P;try{P=await Raw('probe',{engine:M.engine});}catch(E){if(E.message==='caption_unsupported')Fail('caption_helper_update_required');throw E;}if(P.executionProtocol!==2)Fail('caption_helper_update_required');
  const Installed=[];
  for(const [Model,Entry]of Object.entries(CaptionModelCatalog)){
   if(!Entry[M.engine])continue;const O={engine:M.engine,model:Model},Path=ModelPath(O);
   const Checks=M.engine==='whisper.cpp'?[await Raw('stat',{area:'models',path:Path})]:await Promise.all(RequiredFiles(M.engine).map(Name=>Raw('stat',{area:'models',path:Path+'/'+Name})));
   if(Checks.every(S=>S.exists&&!S.isDirectory&&S.size>0))Installed.push(Model);
  }
  const EngineReady=P.engineReady&&(M.engine!=='whisper.cpp'||M.recognition?.useGpu!==false||P.gpuToggleReady!==false||P.cliReady===true);
  const Result={...P,engineReady:EngineReady,modelReady:Installed.includes(M.model),installedModels:Installed,modelManagement:true,modelDownloadVersion:3,captionTranslationVersion:1,recognitionOptionsVersion:1,
   captionConcurrencyVersion:EngineReady?1:0,captionWindowVersion:EngineReady?2:0,captionFinalizeVersion:2,captionTimelineVersion:2,captionWindowProfiles:['aac','pcm-s16-wav-16000-mono-v1'],processing:{...Policy},captionPackageVersion:P.captionPackageVersion};
  ProbeCache.set(CaptionOptionsKey([M.engine,M.model,M.recognition]),Result);return Result;
 }
 async function ModelOperation(M){
  const O=Options({...M,formats:M.formats?.length?M.formats:['vtt']}),Token=M.operationId;
  if(!/^[a-f\d]{32}$/.test(Token||''))Fail('caption_invalid');
  if(Models.has(Token)||[...Models.values()].some(R=>R.engine===O.engine&&R.model===O.model))Fail('caption_busy');
  const R={engine:O.engine,model:O.model,scope:Token,canceled:false,received:0,total:0,base:0};Models.set(Token,R);
  const Progress=Fields=>emit({event:'model-state',engine:O.engine,model:O.model,operationId:Token,...Fields});R.progress=Progress;
  const Target=ModelPath(O),Stage=Target+'.downloading-'+Token;
  try{
   Progress({phase:'model-metadata',received:0,total:0});const Repo=CaptionModelCatalog[O.model][O.engine];
   const Metadata=await Run(R,'httpJson',{url:'https://huggingface.co/api/models/'+Repo+'?blobs=true',maxBytes:1048576});Check(R);
   if(!/^[a-f\d]{40}$/.test(Metadata?.sha||''))Fail('caption_model_metadata_invalid');
   const Allowed=O.engine==='faster-whisper'?['config.json','preprocessor_config.json','model.bin','tokenizer.json','vocabulary.txt','vocabulary.json']:['ggml-'+O.model+'.bin'];
   const Files=(Metadata.siblings||[]).filter(F=>Allowed.includes(F.rfilename)),Required=O.engine==='faster-whisper'?RequiredFiles(O.engine):Allowed;
   if(!Required.every(N=>Files.some(F=>F.rfilename===N))||Files.some(F=>!Integer(F.size,1)))Fail('caption_model_metadata_invalid');
   R.total=Files.reduce((N,F)=>N+F.size,0);Progress({phase:'model-downloading',received:0,total:R.total});
   const Disk=await Run(R,'usage',{area:'models',path:''});if(Disk.free<R.total+Policy.minFreeBytes)Fail('caption_disk_full');
   for(const F of Files){Check(R);R.base=R.received;
    const Path=O.engine==='faster-whisper'?Stage+'/'+F.rfilename:Stage;
    await Run(R,'fetchFile',{url:'https://huggingface.co/'+Repo+'/resolve/'+Metadata.sha+'/'+F.rfilename,area:'models',path:Path,bytes:F.size,
     checksum:{algorithm:F.lfs?.sha256?'sha256':'git-sha1',value:F.lfs?.sha256||F.blobId}});
    R.received+=F.size;Progress({phase:'model-downloading',received:R.received,total:R.total});
   }
   Check(R);Progress({phase:'model-verifying',received:R.received,total:R.total});await Run(R,'publish',{area:'models',source:Stage,target:Target});
   Progress({phase:'model-ready',received:R.total,total:R.total});return await Probe(O);
  }catch(E){Progress({phase:R.canceled?'model-canceled':'model-failed',received:R.received,total:R.total,error:R.canceled?'caption_canceled':E.message});throw E;}
  finally{await Raw('remove',{area:'models',path:Stage},'cleanup.'+Token).catch(()=>{});Models.delete(Token);}
 }
 async function Prepare(R,Source){
  Check(R);await State(R,{phase:'preparing'});
  const Budget=await Admission(R,0,true);
  await Run(R,'remove',{area:'jobs',path:File(R,'audio')});
  R.audio=await Run(R,'decode',{source:Source||File(R,'input.media'),output:File(R,'audio'),rate:Policy.sampleRate,chunkSeconds:Policy.chunkSeconds,alignOrigin:true,
   maxOutputBytes:Math.min(2*1024**3,Policy.maxJobBytes-Budget.job.bytes,Policy.maxDiskBytes-Budget.all.bytes),minFreeBytes:Policy.minFreeBytes});
  if(!R.audio.files?.length)Fail('caption_no_audio');await State(R,{phase:'audio-ready'});
 }
 async function Session(R){
  if(R.sessionOpening)return R.sessionOpening;
  const Opening=OpenSession(R);R.sessionOpening=Opening;
  try{return await Opening;}finally{if(R.sessionOpening===Opening)R.sessionOpening=null;}
 }
 async function OpenSession(R){
  if(R.session)return R.session;const O=R.state.options,Id=crypto.randomUUID();
  while(SessionOwners.size>=Policy.maxInferenceSessions){Check(R);await new Promise(Resolve=>setTimeout(Resolve,Policy.pollIntervalMs));}
  Check(R);SessionOwners.add(R.scope);R.sessionSlot=R.scope;
  try{await State(R,{phase:'loading-model'});
   const Capabilities=ProbeCache.get(CaptionOptionsKey([O.engine,O.model,O.recognition]))||await Probe(O);
   const Backend=Capabilities.persistentReady!==false&&(O.engine!=='whisper.cpp'||O.recognition.useGpu||Capabilities.gpuToggleReady!==false)?'binding':'cli';
   if(Backend==='cli'&&!Capabilities.cliReady)Fail('caption_engine_options_unsupported');
   R.session=Id;
   await Run(R,'sessionOpen',{sessionId:Id,backend:Backend,engine:O.engine,model:ModelPath(O),recognition:O.recognition,processing:{...Policy},work:File(R,'worker')});
   Check(R);R.session=Id;return Id;
  }catch(E){await CloseSession(R);throw E;}
 }
 async function Infer(R,Audio,Name,Provisional=false){
  const SessionId=await Session(R);if(!Provisional)await State(R,{phase:'recognizing'});
  const Words=R.state.options.engine==='faster-whisper';
  if(Words){const P=ProbeCache.get(CaptionOptionsKey([R.state.options.engine,R.state.options.model,R.state.options.recognition]))||await Probe(R.state.options);if(!(P.wordTimestampsVersion>=1))Fail('caption_helper_update_required');}
  const Result=await Run(R,'sessionInfer',{sessionId:SessionId,audio:Audio,language:R.state.language&&R.state.language!=='auto'?R.state.language:R.state.options.language,output:File(R,Name+'.json'),...(Words?{wordTimestamps:true}:{})});
  const Value=JSON.parse(Decoder.decode(await Read(Result.path,R.scope,Policy.maxWorkerResultBytes)));Check(R);
  if(!Array.isArray(Value.segments)||Words&&!Array.isArray(Value.words))Fail('caption_inference_result');
  const Speech=Value.segments.some(S=>typeof S[2]==='string'&&S[2].trim());
  if(!Provisional){if(R.state.options.language!=='auto')R.state.language=R.state.options.language;
   else if(!R.state.language&&Speech&&Value.language&&!['auto','und'].includes(Value.language))R.state.language=Value.language;}
  return Value;
 }
 async function CloseSession(R){
  if(R.session){const V=await Raw('sessionClose',{sessionId:R.session},R.scope);if(!V.closed)Fail('caption_busy');R.session=null;}
  SessionOwners.delete(R.sessionSlot);R.sessionSlot=null;
  EncodedPreparation.releaseReservation(R);
 }
 async function CloseDecoders(R){
  for(const [Token,D]of R.decoders){await CloseDecoder(D);R.decoders.delete(Token);DecoderOwners.delete(Token);R.closedDecoders.set(Token,D.attempt);DecoderReceipts.set(Token,{jobId:R.id,attempt:D.attempt});}
 }
 async function CloseDecoder(D){
  try{const V=await Raw('avDecodeClose',{decoderId:D.id},D.scope);if(!V.closed)Fail('caption_busy');return V;}
  catch(E){
   // A fresh private ID rejected before Open admission has no native owner.
   // An accepted handle disappearing is a protocol failure, never close proof.
   if(!D.openAccepted&&E.message==='caption_decoder_missing')return {closed:true};throw E;
  }
 }
 async function DispatchDecoder(R,M){
  if(M.action==='decoderOpen'){
   if(R.state.mode!=='windowed'||R.state.inputSealed||R.state.resultRevision||!/^[a-f0-9]{64}$/.test(M.sourceFingerprint||''))Fail('caption_state');
   const Access=M.access;if(!Access||typeof Access.seekable!=='boolean'||Access.knownSize!==null&&!Integer(Access.knownSize)||Access.seekable&&Access.knownSize===null)Fail('caption_invalid');
   const Resample=M.resample===undefined?{async:0}:M.resample;if(!Resample||Object.keys(Resample).join(',')!=='async'||!Integer(Resample.async)||Resample.async>1000)Fail('caption_invalid');
   const Identity=JSON.stringify([M.sourceFingerprint,Access,Resample]);
   if(R.decoders.size){const [Token,D]=R.decoders.entries().next().value;if(D.identity!==Identity)Fail('caption_session_conflict');return {decoderToken:Token,attempt:R.state.attempt};}
   EncodedPreparation.admitDecoder(R);if(DecoderReceipts.size+DecoderOwners.size>=Policy.maxWindows)Fail('caption_result_limit');
   const O=R.state.options,Key=CaptionOptionsKey([O.engine,O.model,O.recognition]);let P=ProbeCache.get(Key);if(!P)P=await Probe(O);if(!(P.avDecodeStreamVersion>=1))Fail('caption_concurrency_unsupported');if(Resample.async&&P.avDecodeStreamVersion<2)Fail('caption_helper_update_required');
   // Named transport/primitive ceilings; processing choices derive from Policy.
   const NativeFrameCeiling=131072,NativeMetadataCeiling=4*1024*1024,ResponseReserve=4096,NativeQueueCeiling=64*1024*1024;
   const FrameBytes=Math.min(NativeFrameCeiling,Math.floor((Policy.resultPageBytes-ResponseReserve)*3/4/2)*2,Policy.uploadChunkBytes);
   const Limits={ioChunkBytes:Policy.uploadChunkBytes,queuedOutputBytes:Math.min(NativeQueueCeiling,Policy.maxPcmWindows*Policy.chunkSeconds*Policy.sampleRate*2),maxOutputFrameBytes:FrameBytes,
    maxMetadataBytes:Math.min(NativeMetadataCeiling,Policy.maxLedgerBytes),maxLogBytes:0,cancelGraceMs:Policy.cancelGraceMs,pollIntervalMs:Policy.pollIntervalMs};
   await Admission(R,Limits.queuedOutputBytes*2+Limits.maxMetadataBytes,true);
   EncodedPreparation.admitDecoder(R);if(DecoderReceipts.size+DecoderOwners.size>=Policy.maxWindows)Fail('caption_result_limit');
   const Token=crypto.randomUUID(),D={id:crypto.randomUUID(),scope:R.scope,attempt:R.state.attempt,identity:Identity,lastEvent:0,lastFrame:0,ackedEvent:0,ackedFrame:0,events:new Map()};
   // Register before awaiting Open, so cancellation owns even an opening child.
   R.decoders.set(Token,D);DecoderOwners.add(Token);
   try{await Run(R,'avDecodeOpen',{decoderId:D.id,work:File(R,'decoder'),input:{seekable:Access.seekable,knownSize:Access.knownSize,bufferBytes:Policy.uploadChunkBytes},demux:{format:null,options:{}},audio:{index:0},
    output:{rate:Policy.sampleRate,channels:1,sampleFormat:'s16',byteOrder:'little'},...(Resample.async?{resample:Resample}:{}),limits:Limits});}catch(E){
    try{await CloseDecoders(R);}catch(CloseError){return {decoderToken:Token,state:'cleanup-pending',error:E.message,cleanupError:CloseError.message,attempt:R.state.attempt};}throw E;
   }
   D.openAccepted=true;return {decoderToken:Token,attempt:R.state.attempt};
  }
  if(M.action==='decoderClose'&&R.closedDecoders.get(M.decoderToken)===M.attempt)return {closed:true,attempt:M.attempt};
  const D=R.decoders.get(M.decoderToken);if(!D||D.scope!==R.scope||D.attempt!==M.attempt)Fail('caption_decoder_missing');
  const Fields={decoderId:D.id};
  if(M.action==='decoderClose'){const V=await CloseDecoder(D);R.decoders.delete(M.decoderToken);DecoderOwners.delete(M.decoderToken);R.closedDecoders.set(M.decoderToken,M.attempt);DecoderReceipts.set(M.decoderToken,{jobId:R.id,attempt:M.attempt});return {...V,attempt:R.state.attempt};}
  if(M.action==='decoderSupply'){
   if(typeof M.requestId!=='string'||!/^r[1-9][0-9]*$/.test(M.requestId)||!Integer(M.offset)||typeof M.eof!=='boolean'||typeof M.data!=='string'||M.data.length>Math.ceil(Policy.uploadChunkBytes/3)*4)Fail('caption_invalid');
   return {...await Run(R,'avDecodeSupply',{...Fields,requestId:M.requestId,offset:M.offset,data:M.data,eof:M.eof}),attempt:R.state.attempt};
  }
  if(M.action==='decoderPoll'){
   if(!Integer(M.afterEvent,D.ackedEvent)||M.afterEvent>D.lastEvent||!Integer(M.maxEvents,1)||M.maxEvents>Policy.resultPageItems||M.maxBytes!==Policy.resultPageBytes)Fail('caption_invalid');
   const V=await Run(R,'avDecodePoll',{...Fields,afterEvent:M.afterEvent,maxEvents:M.maxEvents,maxBytes:M.maxBytes});
   if(!Array.isArray(V.events)||V.events.length>Policy.resultPageItems)Fail('caption_worker_protocol');
   for(const E of V.events){
    if(!Integer(E.eventId,1)||E.eventId>D.lastEvent+1)Fail('caption_worker_protocol');
    if(E.type==='pcm'){
     const B=Decode(E.data);if(!Integer(E.sequence,1)||E.bytes!==B.length||E.samples*2!==B.length||E.rate!==Policy.sampleRate||E.channels!==1||E.sampleFormat!=='s16'||E.byteOrder!=='little'||await Digest(B)!==E.sha256)Fail('caption_window_checksum');
    }
    const Signature=await Digest(Encoder.encode(JSON.stringify(E))),Old=D.events.get(E.eventId);if(Old&&Old.signature!==Signature)Fail('caption_result_conflict');
    if(E.eventId>D.lastEvent){if(E.type==='pcm'){if(E.sequence!==D.lastFrame+1)Fail('caption_worker_protocol');D.lastFrame=E.sequence;}D.lastEvent=E.eventId;D.events.set(E.eventId,{signature:Signature,frame:D.lastFrame});}
   }
   if(D.events.size>Policy.resultPageItems*Policy.maxQueuedWindows)Fail('caption_result_limit');
   return {...V,attempt:R.state.attempt};
  }
  if(M.action==='decoderAck'){
   if(!Integer(M.throughEvent,D.ackedEvent)||!Integer(M.throughFrame,D.ackedFrame)||M.throughEvent>D.lastEvent||M.throughFrame>D.lastFrame||M.throughEvent>D.ackedEvent&&D.events.get(M.throughEvent)?.frame!==M.throughFrame||M.throughEvent===D.ackedEvent&&M.throughFrame!==D.ackedFrame)Fail('caption_invalid');
   const V=await Run(R,'avDecodeAck',{...Fields,throughEvent:M.throughEvent,throughFrame:M.throughFrame});
   D.ackedEvent=M.throughEvent;D.ackedFrame=M.throughFrame;for(const Id of D.events.keys())if(Id<=D.ackedEvent)D.events.delete(Id);return {...V,attempt:R.state.attempt};
  }
  Fail('caption_invalid');
 }
 async function Recognize(R,M){
  try{
   let Offset=M.offset||0;
   if(R.preparing)await R.preparing;Check(R);
   if(!R.audio){const Source=M.sourcePath||M.fallbackPath;if(!Source)Fail('caption_prepare_failed');await Prepare(R,{external:Source});if(!M.sourcePath){Offset=0;await State(R,{usingFallback:true});}}
   const Segments=[];let Samples=0;
   for(const [Index,F]of R.audio.files.entries()){
    const V=await Infer(R,F.path,'inference-'+Index);for(const [A,B,T]of V.segments)Segments.push({startSample:Samples+Math.round(A*Policy.sampleRate),endSample:Samples+Math.round(B*Policy.sampleRate),text:T,epoch:0});
    Samples+=F.frames;await State(R,{completed:Index+1,total:R.audio.files.length,committedSamples:Samples,finalSamples:R.audio.files.reduce((N,F)=>N+F.frames,0),language:R.state.language||R.state.options.language});
   }
   await Write(File(R,'raw-cues.json'),Encoder.encode(JSON.stringify(Segments)),R.scope);R.raw=Segments;
   if(M.timelineMode==='deferred')await State(R,{phase:'recognized',finalizationPending:true,rawSourceStartSample:0,rawSourceEndSample:Samples});
   else await Finalize(R,{formats:R.state.options.formats,outputStart:0,outputEnd:Samples/Policy.sampleRate+Math.max(0,Offset),expectedCoverage:{startSample:0,endSample:Samples},
    mapping:[{epoch:0,validStartSample:0,validEndSample:Samples,sourceOrigin:{ticks:0,timeBaseNum:1,timeBaseDen:1},trackShift:{ticks:Math.round(Offset*Policy.sampleRate),timeBaseNum:1,timeBaseDen:Policy.sampleRate},shiftApplied:false}]});
  }finally{await CloseSession(R);await Raw('remove',{area:'jobs',path:File(R,'audio')},'cleanup.'+R.id);R.audio=null;R.recognizing=false;}
 }
 function OriginalCoverage(R,Ids=[]){return UnionCaptionSpans([...R.windows.values()].filter(W=>!W.window.repairOf&&(W.phase==='acked'||Ids.includes(W.window.id))).map(W=>({epoch:W.window.epoch,startSample:W.window.coreStartSample,endSample:W.window.coreEndSample})));}
 async function AppendLedgerBytes(R,Upload,Path,M,Maximum,Ephemeral=false){
  if(!Integer(M.offset)||typeof M.data!=='string'||M.data.length>Math.ceil(Policy.uploadChunkBytes/3)*4||M.done!==undefined&&typeof M.done!=='boolean')Fail('caption_invalid');
  const Bytes=Decode(M.data);if(Bytes.length>Policy.uploadChunkBytes||M.offset+Bytes.length>Maximum||!Bytes.length&&!M.done)Fail('caption_result_limit');
  const Signature=await Digest(Bytes),Receipt=(Upload.receipts||[]).find(P=>P.offset===M.offset);
  if(Receipt){if(Receipt.sha256!==Signature||Receipt.bytes!==Bytes.length||Receipt.done!==(M.done===true))Fail('caption_result_conflict');return {offset:M.offset+Bytes.length,done:Upload.done,attempt:R.state.attempt};}
  if(Upload.done||M.offset!==(Upload.offset||0))Fail('caption_upload_order');
  const V=await Run(R,'write',{area:'jobs',path:Path,offset:M.offset,data:M.data,truncate:M.offset===0});if(V.offset!==M.offset+Bytes.length)Fail('caption_upload_order');
  Upload.offset=V.offset;Upload.done=M.done===true;(Upload.receipts??=[]).push({offset:M.offset,bytes:Bytes.length,sha256:Signature,done:M.done===true});
  if(Upload.receipts.length>Policy.resultPageItems)Upload.receipts.shift();
  if(!Ephemeral)await State(R);return {...V,done:Upload.done,attempt:R.state.attempt};
 }
 async function Finalize(R,M){
  if(!Array.isArray(M.mapping)||!M.mapping.length||M.mapping.length>Policy.maxWindows||!Array.isArray(M.formats)||!M.formats.length||M.formats.some(F=>!['srt','vtt'].includes(F))||!Number.isFinite(M.outputStart)||!Number.isFinite(M.outputEnd)||M.outputEnd<=M.outputStart)Fail('caption_invalid');
  const Coverage=UnionCaptionSpans(M.expectedCoverage);if(!Coverage.length)Fail('caption_no_audio');
  if(R.state.mode==='windowed'){
   if(!R.state.inputSealed||!R.finalCues||!R.finalCueUpload?.done||!CaptionCovers(OriginalCoverage(R),Coverage)||!CaptionCovers(R.state.committedSpans||OriginalCoverage(R),Coverage)||!CaptionCovers(R.state.sourceSpans,Coverage))Fail('caption_coverage');
  }else if(!CaptionCovers([{epoch:0,startSample:R.state.rawSourceStartSample||0,endSample:R.state.rawSourceEndSample??R.state.finalSamples??0}],Coverage))Fail('caption_coverage');
  const Mapping=M.mapping.map(E=>{
   if(!Integer(E.epoch)||!Integer(E.validStartSample)||!Integer(E.validEndSample,E.validStartSample+1)||typeof E.shiftApplied!=='boolean')Fail('caption_invalid');
   return {...E,offset:CaptionRationalSeconds(E.sourceOrigin)+(E.shiftApplied?0:CaptionRationalSeconds(E.trackShift))-M.outputStart};
  }).sort((A,B)=>A.epoch-B.epoch||A.validStartSample-B.validStartSample);
  const MapSpans=Mapping.map(E=>({epoch:E.epoch,startSample:E.validStartSample,endSample:E.validEndSample}));
  if(!CaptionCovers(MapSpans,Coverage)||!CaptionCovers(Coverage,MapSpans))Fail('caption_coverage');
  for(let I=1;I<Mapping.length;I++)if(Mapping[I].epoch===Mapping[I-1].epoch&&Mapping[I].validStartSample<Mapping[I-1].validEndSample)Fail('caption_coverage');
  const RawCues=R.finalCues?JSON.parse('['+Decoder.decode(await Read(File(R,'final-cues.jsonl'),R.scope)).trim().split('\n').filter(Boolean).join(',')+']'):R.raw||JSON.parse(Decoder.decode(await Read(File(R,'raw-cues.json'),R.scope)));
  let HypothesisId,Hypothesis;const Seen=new Set(),Cues=[];
  for(const Q of RawCues){
   if(!Integer(Q.epoch??0)||!Integer(Q.startSample)||!Integer(Q.endSample,Q.startSample+1)||typeof Q.text!=='string')Fail('caption_result_invalid');
   if(R.state.mode==='windowed'){
    const Parts=Q.parts||[Q];if(!Array.isArray(Parts)||!Parts.length||Parts.length>Policy.maxWindows)Fail('caption_result_invalid');
    const Sources=[];
    for(const Part of Parts){
     const W=R.windows.get(Part.windowId);if(!W||W.phase!=='acked'||Part.revision!==W.result.revision||!Integer(Part.cueIndex)||Part.epoch!==W.window.epoch||Part.epoch!==Q.epoch)Fail('caption_result_invalid');
     if(HypothesisId!==Part.windowId){Hypothesis=JSON.parse(Decoder.decode(await Read(File(R,'windows/'+Part.windowId+'/hypothesis.json'),R.scope,Policy.maxWorkerResultBytes)));HypothesisId=Part.windowId;}
     const Source=CaptionCueSource(Part,Hypothesis);Sources.push(Source);
     if(Source.text!==Part.text||Part.startSample<Source.startSample||Part.endSample>Source.endSample||Part.endSample<=Part.startSample||Part.sourceStartSample!==undefined&&Part.sourceStartSample!==Source.startSample||Part.sourceEndSample!==undefined&&Part.sourceEndSample!==Source.endSample)Fail('caption_result_conflict');
     for(const Unit of Source.keys){const Key=Part.windowId+':'+Part.revision+':'+Unit;if(Seen.has(Key))Fail('caption_result_conflict');Seen.add(Key);}
    }
    if(Q.startSample<Math.min(...Sources.map(S=>S.startSample))||Q.endSample>Math.max(...Sources.map(S=>S.endSample))||Q.text!==Sources.map(S=>S.text).join(Q.parts?'\n':''))Fail('caption_result_conflict');
   }
   for(const E of Mapping){if(E.epoch!==(Q.epoch??0))continue;
    const A=Math.max(Q.startSample,E.validStartSample),B=Math.min(Q.endSample,E.validEndSample);if(B<=A)continue;
    const Start=Math.max(0,A/Policy.sampleRate+E.offset),End=Math.min(M.outputEnd-M.outputStart,B/Policy.sampleRate+E.offset);
    if(End>Start)Cues.push({start:Start,end:End,text:Q.text,windowId:Q.windowId,revision:Q.revision,cueIndex:Q.cueIndex,epoch:Q.epoch??0});
   }
  }
  Cues.sort((A,B)=>A.start-B.start||A.end-B.end);
  const Corrected=CorrectCaptionOverlaps(Cues.map(C=>({...C,startSample:Math.round(C.start*Policy.sampleRate),endSample:Math.round(C.end*Policy.sampleRate),epoch:0})));
  if(Corrected.warnings)Cues.splice(0,Cues.length,...Corrected.cues.map(C=>({...C,start:C.startSample/Policy.sampleRate,end:C.endSample/Policy.sampleRate})));
  if(M.audioBoundOnly!==undefined&&typeof M.audioBoundOnly!=='boolean')Fail('caption_invalid');
  const Receipt={mapping:Mapping.map(({offset,...E})=>E),expectedCoverage:Coverage,outputStart:M.outputStart,outputEnd:M.outputEnd,audioBoundOnly:M.audioBoundOnly===true,formats:[...new Set(M.formats)].sort()},Signature=await Digest(Encoder.encode(JSON.stringify({receipt:Receipt,cues:Cues})));
  if(R.state.resultSignature===Signature){
   if(!['recognized','complete'].includes(R.state.phase))return State(R,{phase:'recognized',error:null});
   return {...R.state};
  }const Revision=(R.state.resultRevision||0)+1;
  for(const F of Receipt.formats)await Write(File(R,'result-'+Revision+'.'+F),Encoder.encode(CaptionTextForFormat({cues:Cues},F)),R.scope);
  await Write(File(R,'mapped-cues-'+Revision+'.json'),Encoder.encode(JSON.stringify(Cues)),R.scope);
  return State(R,{phase:'recognized',finalizationPending:false,formats:Receipt.formats,resultRevision:Revision,resultSignature:Signature,finalMappingReceipt:Receipt,outputs:{},committedSamples:CaptionSpanLength(Coverage),finalSamples:CaptionSpanLength(Coverage),language:R.state.language||R.state.options?.language||'auto',...(Corrected.warnings?{warningCount:Corrected.warnings,warningCode:'caption_timing_adjusted'}:{}),error:null});
 }
 function Credit(R){return Math.max(0,Math.min(Policy.maxQueuedWindows-WindowOwners.size,Policy.maxQueuedWindows-[...R.windows.values()].filter(W=>W.phase!=='acked'||!W.creditReleased).length));}
 async function WindowLoop(R){
  if(R.windowTask)return;R.windowTask=Background(R,async()=>{
   try{for(;;){Check(R);const W=[...R.windows.values()].find(W=>W.phase==='queued');if(!W)break;W.phase='recognizing';
    await Admission(R,Policy.maxWorkerResultBytes,true);
    const V=W.window,Dir=File(R,'windows/'+V.id),D=W.prepareToken?{files:[{path:await EncodedPreparation.slice(R,V,W.prepareToken),frames:V.inputEndSample-V.inputStartSample}]}:await Run(R,'decode',{source:Dir+'/input.media',output:Dir+'/audio',rate:Policy.sampleRate,chunkSeconds:Policy.chunkSeconds,alignOrigin:false,maxOutputBytes:Policy.maxPcmWindows*Policy.sampleRate*Policy.chunkSeconds*2,minFreeBytes:Policy.minFreeBytes,
     trim:{before:V.trimStartSamples||0,frames:V.inputEndSample-V.inputStartSample,expectedFrames:V.inputEndSample-V.inputStartSample+(V.trimStartSamples||0)+(V.trimEndSamples||0)}});
    // WindowLoop is serial; read each scratch result before the next inference.
    // Keep the atomic writer's temporary suffix below Windows' path limit.
    if(D.files.length!==1||D.files[0].frames!==V.inputEndSample-V.inputStartSample)Fail('caption_window_clock');const H=await Infer(R,D.files[0].path,'window-inference');
    W.result={windowId:V.id,revision:(V.repairAttempt||0)+1,...(V.repairOf?{repairOf:V.repairOf,repairAttempt:V.repairAttempt}:{}),language:R.state.language||R.state.options.language,cues:H.segments.map(([A,B,T])=>({startSample:V.inputStartSample+Math.round(A*Policy.sampleRate),endSample:V.inputStartSample+Math.round(B*Policy.sampleRate),text:T})),coverage:{epoch:V.epoch,startSample:V.inputStartSample,endSample:V.inputEndSample},diagnostics:{epoch:V.epoch,coreStartSample:V.coreStartSample,coreEndSample:V.coreEndSample}};
    if(H.words)W.result.words=H.words.map(([A,B,T,Index,Probability])=>({startSample:V.inputStartSample+Math.round(A*Policy.sampleRate),endSample:V.inputStartSample+Math.round(B*Policy.sampleRate),text:T,segmentIndex:Index,probability:Probability}));
    const Bytes=Encoder.encode(JSON.stringify(W.result));if(Bytes.length>Policy.maxWorkerResultBytes)Fail('caption_result_limit');await Write(Dir+'/hypothesis.json',Bytes,R.scope);W.resultBytes=Bytes.length;W.result={...W.result,cues:undefined,words:undefined,resultRef:true,bytes:Bytes.length,sha256:await Digest(Bytes)};W.phase='recognized';R.results.push(V.id);
    await Run(R,'remove',{area:'jobs',path:Dir+'/audio'});await State(R,{credit:Credit(R),completed:R.results.length,total:R.windows.size});
   }}finally{R.windowTask=null;}
   if(R.state.inputSealed){await CloseSession(R);await State(R,{phase:'windowed-ready'});}
  });
 }
 async function Save(R,M){
  if(!['recognized','complete'].includes(R.state.phase)||R.state.finalizationPending)Fail('caption_state');
  const Outputs={...R.state.outputs},Names=[];
  for(const F of M.formats){Check(R);const Key=F+(M.translationLanguage?':'+M.translationLanguage:'');if(Outputs[Key]){Names.push(Outputs[Key]);continue;}
   const Filename=M.videoPath.replace(/\\/g,'/').split('/').at(-1);let Name=CaptionOutputName(Filename,F);if(M.translationLanguage)Name=Name.replace('.'+F,'.'+M.translationLanguage+'.'+F);
   const Dot=Name.lastIndexOf('.'),Stem=Name.slice(0,Dot),Extension=Name.slice(Dot);
   for(let Index=0;;Index++){Check(R);const Candidate=Stem+(Index?' ('+Index+')':'')+Extension;
    try{const P=await Run(R,'copyExclusive',{area:'jobs',source:File(R,M.translationLanguage?'translated.'+M.translationLanguage+'.'+F:'result-'+R.state.resultRevision+'.'+F),videoPath:M.videoPath,name:Candidate});Outputs[Key]=P.name;Names.push(P.name);break;}
    catch(E){if(E.message!=='caption_output_exists')throw E;}}
   await State(R,{outputs:Outputs});
  }return {outputs:Names,attempt:R.state.attempt};
 }
 async function Cancel(R){
  if(R.canceling)return R.canceling;
  const Work=(async()=>{R.canceled=true;const Canceled=await Execute({action:'cancelExecution',scope:R.scope});if(Canceled?.canceled!==true)Fail('caption_busy');await Promise.all([...R.tasks,...(R.foregroundTasks||[])]);await CloseDecoders(R);await CloseSession(R);
   const CleanupScope='cleanup.'+crypto.randomUUID();await EncodedPreparation.release(R,undefined,CleanupScope);R.preview=null;await State(R,{phase:'canceled',error:null},CleanupScope);for(const W of R.windows.values())WindowOwners.delete(R.id+':'+W.window.id);return {...R.state};})();R.canceling=Work;
  try{return await Work;}finally{R.canceling=null;}
 }
 async function Reopen(){
  if(Reopening)return Reopening;if(!Closed)return;
  if(Models.size||SessionOwners.size||DecoderOwners.size||EncodedPreparation.size()||[...Jobs.values()].some(R=>R.tasks.size||R.recognizing||R.foregroundTasks?.size||R.statePending))Fail('caption_helper_missing');
  Reopening=(async()=>{
   Closed=false;
   try{for(const R of Jobs.values())if(R.checkpoint)await QueueState(R,()=>SettleCheckpoint(R));}
   catch(E){Closed=true;throw E;}
   Jobs.clear();Models.clear();WindowOwners.clear();ProbeCache.clear();
  })().finally(()=>{Reopening=undefined;});return Reopening;
 }
 async function Dispatch(M){
  if(M.action==='decoderClose'){
   const Receipt=DecoderReceipts.get(M.decoderToken);if(Receipt){if(Receipt.jobId!==M.jobId||Receipt.attempt!==M.attempt)Fail('caption_decoder_missing');return {closed:true,attempt:M.attempt};}
  }
  await Reopen();if(Maintenance)await Maintenance;
  if(!M.jobId)return Request(M);
  const R=await Job(M,true),Reset=['begin','openConcurrent','forget'].includes(M.action),Starting=M.action==='start';
  const Foreground=!['status','readResult','windowResults','readWindowResult','cancel','forget','start','begin','openConcurrent'].includes(M.action);
  if((Reset||Starting||Foreground)&&(R.resetting||R.foregroundTasks?.size))Fail('caption_busy');
  if(Reset)R.resetting=true;
  let Release,Pending;if(Foreground){Pending=new Promise(Resolve=>Release=Resolve);(R.foregroundTasks??=new Set()).add(Pending);}
  try{return await Request(M);}finally{if(Reset)R.resetting=false;if(Pending){R.foregroundTasks.delete(Pending);Release();}}
 }
 async function Request(M){
  await Reopen();
  if(M.action==='probe')return Probe(M);
  if(M.action==='prepareModel')return ModelOperation(M);
  if(M.action==='cancelModel'){const R=Models.get(M.operationId);if(R){if(R.engine!==M.engine||R.model!==M.model)Fail('caption_invalid');R.canceled=true;await Execute({action:'cancelExecution',scope:R.scope});}return {canceled:!!R,operationId:M.operationId};}
  if(M.action==='deleteModel'){if([...Models.values()].some(R=>R.engine===M.engine&&R.model===M.model)||[...Jobs.values()].some(R=>(R.session||R.sessionSlot||R.recognizing||R.windowTask)&&R.state.options?.engine===M.engine&&R.state.options?.model===M.model))Fail('caption_busy');await Raw('remove',{area:'models',path:ModelPath(Options({...M,formats:['vtt']}))});return {...await Probe(M),deleted:true};}
  const R=await Job(M,['begin','openConcurrent','start'].includes(M.action));
  if(M.action!=='cancel'&&M.action!=='forget'&&CheckpointBusy(R))await QueueState(R,()=>SettleCheckpoint(R));
  if(R.foreignCheckpoints?.length&&!['status','readResult','readWindowResult'].includes(M.action))Fail('caption_checkpoint_uncertain');
  if(M.action==='start'&&R.state.attempt!==undefined&&M.attempt!==R.state.attempt)Fail('caption_stale_attempt');
  if(M.action==='cancel')return Cancel(R);
  if(M.action==='forget'){await Cancel(R);await Raw('remove',{area:'jobs',path:R.id},'cleanup.'+crypto.randomUUID());Jobs.delete(R.id);return {forgotten:true};}
  if(M.action==='status')return {...(R.persistedPublic||R.state),credit:Credit(R)};
  if(M.action==='decoderClose')return DispatchDecoder(R,M);
  if(['begin','openConcurrent'].includes(M.action)){
   if(R.tasks.size||R.recognizing||R.sessionSlot)Fail('caption_busy');if(R.state.attempt!==undefined&&M.attempt<=R.state.attempt){
    if(M.attempt===R.state.attempt){if((M.action==='openConcurrent')!==(R.state.mode==='windowed')||M.action==='openConcurrent'&&(M.sourceFingerprint!==R.state.sourceFingerprint||CaptionOptionsKey(Options(M.options))!==CaptionOptionsKey(R.state.options)))Fail('caption_session_conflict');return {...R.state,credit:Credit(R)};}Fail('caption_stale_attempt');
   }
   if(M.action==='openConcurrent'&&!/^[a-f0-9]{64}$/.test(M.sourceFingerprint||''))Fail('caption_invalid');
   await CloseDecoders(R);await CloseSession(R);await EncodedPreparation.release(R);
   R.canceled=false;R.scope=R.id+'.'+crypto.randomUUID();R.windows.clear();R.results=[];R.resultCursor=0;R.resultPage=null;R.finalCueUpload=null;R.audio=null;R.raw=null;R.finalCues=false;R.preparing=null;
   R.state={attempt:M.attempt,phase:M.action==='begin'?'staging':'queued',mode:M.action==='begin'?'postprocess':'windowed',sourceFingerprint:M.sourceFingerprint,options:M.options?Options(M.options):undefined,inputSealed:false,committedSamples:0,outputs:{}};
   if(M.action==='begin')await Write(File(R,'input.media'),new Uint8Array(),R.scope);return State(R,{credit:Credit(R),sessionId:R.scope});
  }
  if(R.canceled&&M.action==='start'&&M.sourcePath){
   if(R.tasks.size)Fail('caption_busy');R.canceled=false;R.scope=R.id+'.'+crypto.randomUUID();R.audio=null;R.raw=null;R.preparing=null;R.finalCues=false;
   R.state={attempt:M.attempt,phase:'staged',outputs:{}};
  }
  Check(R);
  if(['beginPreview','appendPreview','sealPreview','releasePreview'].includes(M.action))return PreviewExecution.dispatch(R,M);
  if(['prepareEncodedBegin','prepareEncodedAppend','prepareEncodedSeal','prepareEncodedRelease'].includes(M.action)){
   if(M.action==='prepareEncodedBegin'&&M.purpose==='preview'&&R.windowTask){await R.windowTask;Check(R);}
   return EncodedPreparation.dispatch(R,M);
  }
  if(['decoderOpen','decoderPoll','decoderSupply','decoderAck'].includes(M.action))return DispatchDecoder(R,M);
  if(M.action==='append')return Run(R,'write',{area:'jobs',path:File(R,'input.media'),offset:M.offset,data:M.data});
  if(M.action==='prepare'){if(R.preparing)return {phase:R.state.phase};if(R.state.phase!=='staging')Fail('caption_state');R.preparing=Background(R,()=>Prepare(R),true);return {phase:'preparing'};}
  if(M.action==='start'){
   if(R.state.mode==='windowed')Fail('caption_session_conflict');
   const Identity=JSON.stringify(M);if(R.recognizing){if(R.startIdentity!==Identity)Fail('caption_session_conflict');return {phase:R.state.phase};}
   R.recognizing=true;R.startIdentity=Identity;const Scope=R.scope,Attempt=M.attempt;
   try{R.state.options=Options(M.options);R.state.attempt=M.attempt;R.state.mode=M.timelineMode==='deferred'?'early-audio':'postprocess';
    await State(R,{phase:'queued'});Check(R);if(R.scope!==Scope||R.state.attempt!==Attempt)Fail('caption_stale_attempt');Background(R,()=>Recognize(R,M));return {phase:'queued'};
   }catch(E){R.recognizing=false;throw E;}
  }
  if(M.action==='readResult')return Raw('read',{area:'jobs',path:File(R,'result-'+R.state.resultRevision+'.'+M.format),offset:M.offset,maxBytes:Policy.uploadChunkBytes},R.scope);
  if(M.action==='appendTranslation'){if(!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(M.language)||!['srt','vtt'].includes(M.format))Fail('caption_invalid');return Run(R,'write',{area:'jobs',path:File(R,'translated.'+M.language+'.'+M.format),offset:M.offset,data:M.data,truncate:M.offset===0});}
  if(M.action==='saveResult')return Save(R,M);
  if(M.action==='complete'){await Promise.all([...R.tasks]);Check(R);if(!['recognized','complete'].includes(R.state.phase)||R.state.finalizationPending)Fail('caption_state');await CloseSession(R);await Run(R,'remove',{area:'jobs',path:File(R,'input.media')});return State(R,{phase:'complete'});}
  if(M.action==='beginWindow'){
   if(R.state.mode!=='windowed'||R.state.resultRevision||R.state.inputSealed)Fail('caption_state');
   const V=ValidateCaptionWindow(M.window),Existing=R.windows.get(V.id);
   if(Existing){if(JSON.stringify(Existing.window)!==JSON.stringify(V))Fail('caption_window_conflict');return {offset:Existing.offset||0,attempt:M.attempt};}
   const Prepared=M.prepareToken?EncodedPreparation.validate(R,M.prepareToken,V):null;
   if(V.profile==='aac-prepared-pcm-v1'&&!Prepared)Fail('caption_preparation_missing');
   if(!Credit(R)&&!Prepared)Fail('caption_window_backpressure');if(R.windows.size>=Policy.maxWindows)Fail('caption_window_limit');
   // A queued newcomer must not consume the windows needed by the resident
   // sessions to resolve seams and eventually relinquish their model leases.
   if(!R.session&&SessionOwners.size>=Policy.maxInferenceSessions)Fail('caption_window_backpressure');
   if(!V.repairOf&&[...WindowOwners.values()].filter(Repair=>!Repair).length-(Prepared?1:0)>=Math.max(1,Policy.maxQueuedWindows-Policy.maxInferenceSessions))Fail('caption_window_backpressure');
   if(V.descriptorVersion===2&&[...R.windows.values()].some(W=>W.window.descriptorVersion===2&&W.window.ordinal===V.ordinal))Fail('caption_window_conflict');
   if(V.repairOf){const Parent=R.windows.get(V.repairOf);if(!Parent||Parent.window.repairOf||Parent.window.epoch!==V.epoch||!['recognized','acked'].includes(Parent.phase)||[...R.windows.values()].some(W=>W.window.repairOf===V.repairOf&&W.window.repairAttempt===V.repairAttempt))Fail('caption_window_conflict');
    const Boundary=Parent.window.coreEndSample,Right=[...R.windows.values()].find(W=>!W.window.repairOf&&W.window.epoch===V.epoch&&W.window.coreStartSample===Boundary),Repairs=[...R.windows.values()].filter(W=>W.window.repairOf===V.repairOf);
    if(!Right||!['recognized','acked'].includes(Right.phase)||V.repairAttempt!==Repairs.length+1||V.coreStartSample>Boundary||V.coreEndSample<Boundary||V.inputStartSample>=Boundary||V.inputEndSample<=Boundary)Fail('caption_window_epoch');
   }else{
    const Originals=[...R.windows.values()].filter(W=>!W.window.repairOf),Last=Originals.at(-1)?.window;
    if(Last&&(V.epoch<Last.epoch||V.epoch===Last.epoch&&V.coreStartSample!==Last.coreEndSample||V.epoch>Last.epoch&&V.coreStartSample<Last.coreEndSample))Fail('caption_coverage');
   }
   WindowOwners.set(R.id+':'+V.id,!!V.repairOf);
   try{
    if(Prepared)EncodedPreparation.attach(R,M.prepareToken,V);else await Write(File(R,'windows/'+V.id+'/input.media'),new Uint8Array(),R.scope);
    R.windows.set(V.id,{window:structuredClone(V),phase:Prepared?'prepared':'uploading',offset:Prepared?V.bytes:0,receipts:[],...(Prepared?{prepareToken:M.prepareToken}:{})});await State(R);
   }catch(E){WindowOwners.delete(R.id+':'+V.id);throw E;}return {offset:Prepared?V.bytes:0,attempt:M.attempt};
  }
  if(['appendWindow','sealWindow','readWindowResult'].includes(M.action)){
   const W=R.windows.get(M.windowId);if(!W)Fail('caption_window_missing');const Path=File(R,'windows/'+M.windowId+'/input.media');
   if(M.action==='appendWindow'){if(W.phase!=='uploading')Fail('caption_upload_incomplete');return AppendLedgerBytes(R,W,Path,M,W.window.bytes);}
   if(M.action==='readWindowResult'){if(!['recognized','acked'].includes(W.phase)||!Integer(M.offset)||M.offset>W.resultBytes)Fail('caption_invalid');return Run(R,'read',{area:'jobs',path:File(R,'windows/'+M.windowId+'/hypothesis.json'),offset:M.offset,maxBytes:Policy.uploadChunkBytes});}
   if(M.bytes!==W.window.bytes||M.sha256!==W.window.sha256)Fail('caption_window_conflict');
   if(W.phase==='prepared'){EncodedPreparation.validate(R,W.prepareToken,W.window);W.phase='queued';await State(R);void WindowLoop(R);}
   if(W.phase==='uploading'){
    if(W.offset!==W.window.bytes)Fail('caption_upload_incomplete');
    const Bytes=await Read(Path,R.scope,Policy.maxWindowBytes);if(Bytes.length!==W.window.bytes||await Digest(Bytes)!==M.sha256)Fail('caption_window_checksum');
    if(W.window.codec==='pcm-s16le'){
     ValidateCaptionPcmWav(Bytes,Policy.sampleRate);
    }
    W.phase='queued';await State(R);void WindowLoop(R);
   }
   return {accepted:true,credit:Credit(R),attempt:M.attempt};
  }
  if(M.action==='windowResults'){
   if(!Integer(M.cursor)||M.cursor>R.results.length||!Integer(M.limit,1)||M.limit>Policy.resultPageItems)Fail('caption_invalid');
   if(M.cursor!==(R.resultCursor||0)){if(R.resultPage?.cursor===M.cursor&&R.resultPage.limit===M.limit)return R.resultPage.value;Fail('caption_result_cursor');}
   const Selected=R.results.slice(M.cursor||0,(M.cursor||0)+Math.min(M.limit||Policy.resultPageItems,Policy.resultPageItems)),Items=[];let Bytes=256;
   for(const Id of Selected){const W=R.windows.get(Id);let V=W.result;const Size=Encoder.encode(JSON.stringify(V)).length;if(Size>Policy.resultPageBytes-1024)V={...V,cues:undefined,resultRef:true,bytes:Size};const N=Encoder.encode(JSON.stringify(V)).length;if(Bytes+N>Policy.resultPageBytes)break;Items.push(V);Bytes+=N;}
   const Next=M.cursor+Items.length,Value={items:Items,nextCursor:Next,done:R.state.inputSealed&&!R.windowTask&&Next===R.results.length,attempt:M.attempt};
   if(Items.length){R.resultCursor=Next;R.resultPage={cursor:M.cursor,limit:M.limit,value:Value};await State(R);}return Value;
  }
  if(M.action==='ackWindows'){
   if(!Array.isArray(M.windowIds)||M.windowIds.length>Policy.maxQueuedWindows||new Set(M.windowIds).size!==M.windowIds.length||!Integer(M.committedSamples,R.state.committedSamples||0))Fail('caption_coverage');
   for(const Id of M.windowIds){const W=R.windows.get(Id);if(!W||!['recognized','acked'].includes(W.phase)||R.results.indexOf(Id)>=(R.resultCursor||0))Fail('caption_state');}
   const Available=OriginalCoverage(R,M.windowIds),Committed=M.committedSpans?UnionCaptionSpans(M.committedSpans):IntersectCaptionSpans(Available,[{epoch:0,startSample:Available[0]?.startSample||0,endSample:(Available[0]?.startSample||0)+M.committedSamples}].filter(S=>S.endSample>S.startSample));
   if(!CaptionCovers(Available,Committed)||CaptionSpanLength(Committed)!==M.committedSamples||!CaptionCovers(Committed,R.state.committedSpans||[]))Fail('caption_coverage');
   for(const Id of M.windowIds)R.windows.get(Id).phase='acked';
   await State(R,{committedSamples:M.committedSamples,committedSpans:Committed,ackedOriginalSpans:Available});
   for(const Id of M.windowIds){const W=R.windows.get(Id);if(W.prepareToken)await EncodedPreparation.release(R,W.prepareToken);W.creditReleased=true;WindowOwners.delete(R.id+':'+Id);await Run(R,'remove',{area:'jobs',path:File(R,'windows/'+Id+'/input.media')});}
   return {credit:Credit(R),attempt:M.attempt};
  }
  if(M.action==='sealConcurrent'){
   if([...R.windows.values()].some(W=>W.phase!=='acked'))Fail('caption_upload_incomplete');
   const Spans=UnionCaptionSpans(M.spans||OriginalCoverage(R));if(!Spans.length||!CaptionCovers(OriginalCoverage(R),Spans)||!Integer(M.sourceEndSample)||Spans.some(S=>S.endSample>M.sourceEndSample))Fail('caption_coverage');
   if(!R.windowTask)await CloseSession(R);
   await State(R,{inputSealed:true,sourceEndSample:M.sourceEndSample,sourceSpans:Spans,sourceOrigin:M.sourceOrigin,sourceOriginRational:M.sourceOriginRational,sourceReason:M.reason,phase:R.windowTask?'recognizing':'windowed-ready'});return {inputSealed:true,attempt:M.attempt};
  }
  if(M.action==='appendFinalCues'){
   if(!R.state.inputSealed||R.state.resultRevision)Fail('caption_state');R.finalCueUpload??={offset:0,done:false,receipts:[]};
   const P=await AppendLedgerBytes(R,R.finalCueUpload,File(R,'final-cues.jsonl'),M,Policy.maxLedgerBytes);if(M.done)R.finalCues=true;return P;
  }
  if(M.action==='finalizeResult'){if(R.windowTask)Fail('caption_busy');const Result=await Finalize(R,M);await CloseSession(R);return Result;}
  Fail('caption_unsupported');
 }
 return {request:Dispatch,onProgress(Event){const R=Models.get(Event.scope);if(R)R.progress({phase:'model-downloading',received:R.base+Event.received,total:R.total});},
  async pruneExpired(){
   Maintenance??=(async()=>{const {entries:Entries}=await Raw('list',{area:'jobs',path:''});for(const Entry of Entries){
    if(!Entry.isDirectory||!/^[a-f\d-]{36}$/i.test(Entry.name))continue;const Active=Jobs.get(Entry.name);if(Active&&(Active.tasks.size||Active.session||Active.foregroundTasks?.size||Active.resetting||Active.canceling||CheckpointBusy(Active)))continue;
    const Path=Entry.name+'/extension-state.json',Exists=await Raw('stat',{area:'jobs',path:Path});if(!Exists.exists)continue;
    const S=JSON.parse(Decoder.decode(await Read(Path)));if(Number.isFinite(S.updated)&&now()/1000-S.updated>Policy.retentionMs/1000){
     const {entries:Files}=await Raw('list',{area:'jobs',path:Entry.name}),Current=Jobs.get(Entry.name);
     if(CheckpointTemps(Files).length||Current&&(Current.tasks.size||Current.session||Current.recognizing||Current.foregroundTasks?.size||Current.resetting||Current.canceling||CheckpointBusy(Current)))continue;
     await Raw('remove',{area:'jobs',path:Entry.name});Jobs.delete(Entry.name);
    }
   }})().finally(()=>{Maintenance=undefined;});return Maintenance;
  },
  disconnect(){Closed=true;ProbeCache.clear();for(const R of Jobs.values()){R.canceled=true;R.ownershipUncertain=!!(R.session||R.decoders.size);if(R.checkpoint){R.checkpoint.disconnected=true;if(R.checkpoint.cleanupScope)R.checkpoint.cleanupDisconnected=true;}}},
  busy(){return !!Reopening||Models.size>0||SessionOwners.size>0||DecoderOwners.size>0||EncodedPreparation.size()>0||[...Jobs.values()].some(R=>R.tasks.size||R.recognizing||R.foregroundTasks?.size||R.resetting||R.session||R.decoders.size||CheckpointBusy(R));},
  reset(){if(Reopening||SessionOwners.size||DecoderOwners.size||EncodedPreparation.size()||[...Jobs.values()].some(R=>R.tasks.size||R.foregroundTasks?.size||CheckpointBusy(R)))Fail('caption_busy');Closed=false;Jobs.clear();Models.clear();WindowOwners.clear();ProbeCache.clear();},
 };
}
