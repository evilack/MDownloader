import {CaptionModels,CaptionSettingKey,ResolveCaptionOptions,CaptionOutputName,NormalizeCaptionSettings,CaptionOptionsKey} from './local-captions-settings.js';
import {CreateCaptionNativeClient} from './local-captions-native.js';
import {CreateCaptionExecution} from './caption-execution.js';
import {JobKey,ReadJob,UpdateStoredJob,ListStoredJobs} from './job-storage.js';
import {RequirePickedFolder,WriteToPickedFolder} from './picked-download-folder.js';
import {GeneratedTranslationRequested,TranslateGeneratedCaptions} from './generated-caption-translation.js';
import {CaptionRuntimeReady} from './caption-runtime-contract.js';
import {MergeGeneratedSubtitleStatus} from './subtitle-status.js';
import {CaptionPolicy,CaptionConcurrentReady,ValidateCaptionAttempt,ValidateCaptionWindow} from './concurrent-captions-contract.js';
import {UnionCaptionSpans,IntersectCaptionSpans,CaptionSpanLength} from './caption-timeline.js';
import {ValidateCaptionPreview} from './caption-preview.js';
import {CaptionFailureCode,CaptionFailureDetails,MergeCaptionStatus} from './caption-failure.js';

const IdPattern=/^[a-f\d-]{36}$/i;
const ModelOperationPattern=/^[a-f\d]{32}$/;
const ActivePhases=['staging','preparing','metadata-waiting','queued','loading-model','recognizing','windowed-ready','saving','translating','muxing'];
export async function SnapshotCaptionOptions(Override='inherit',Api=chrome,Custom)
{
 const Platform=typeof Api.runtime.getPlatformInfo==='function'?(await Api.runtime.getPlatformInfo()).os:'win';
 if(Override==='custom')return ResolveCaptionOptions(undefined,Override,Platform,Custom);
 const {localCaptions:Saved}=await Api.storage.local.get(CaptionSettingKey);
 return ResolveCaptionOptions(Saved,Override,Platform,Custom);
}
export function CaptionSenderAllowed(Message,Sender,Api)
{
 if(Sender.id!==Api.runtime.id)return false;
 const Path=Sender.url?.split('?')[0],Root=Api.runtime.getURL('');
 if(Message.type==='captionStage')return Path===Root+'hls-runner.html'&&!Sender.tab;
 if(Message.type==='captionReconnect')return Path===Root+'options.html';
 return ['options.html','popup.html','sidepanel.html'].some(Name=>Path===Root+Name);
}
export function CreateCaptionService(Api=chrome,{native,readJob=ReadJob,updateJob=UpdateStoredJob,listJobs=ListStoredJobs,requireFolder=RequirePickedFolder,writeFolder=WriteToPickedFolder}={})
{
 const Completing=new Map(),Starting=new Map(),Saving=new Map(),Handoffs=new Set(),PendingNative=new Map(),InternalCancellation=new Map(),CapabilityCache=new Map();
 let Reconnecting=false,Initialization;
 function Initialize(){
  return Initialization??=(async()=>{
   // session storage survives worker suspension, but is cleared by app restart.
   const Key='captionBrowserSession';
   if((await Api.storage.session.get(Key))[Key])return;
   const OldJobs=await listJobs(),Canceled=[];
   for(const Previous of OldJobs){
    await updateJob(JobKey(Previous.requestId),J=>{
     if(!J||J.created!==Previous.created)return J;
     const Active=['active','starting','started','paused'].includes(J.state),CaptionPending=J.localCaptions?.enabled&&!['complete','canceled'].includes(J.captionStatus?.phase);
     if(!Active&&!CaptionPending)return J;
     Canceled.push({...J,requestId:Previous.requestId});
     return {...J,restartCancellationPending:true,...(Active?{state:'canceled',pendingAction:undefined,waiting:false,connecting:false,saving:false}:{}),...(J.localCaptions?.enabled?{captionStatus:{...J.captionStatus,phase:'canceled',cancelRequested:true,canceledByRestart:true,cancellationPending:true,retryAvailable:false,retryToken:null,outputRetrying:false,controlRevision:(J.captionStatus?.controlRevision||0)+1,error:null}}:{})};
    });
   }
   await Api.storage.session.set({[Key]:true});
   for(const Job of Canceled){
    let DownloadStopped=true,CaptionStopped=!Job.localCaptions?.enabled;
    if(Number.isInteger(Job.downloadId)){
     try{const [Item]=await Api.downloads.search({id:Job.downloadId});if(Item?.byExtensionId===Api.runtime.id&&Item.state==='in_progress')await Api.downloads.cancel(Job.downloadId);else if(Item?.state==='in_progress')DownloadStopped=false;}catch{DownloadStopped=false;}
    }
    if(Job.localCaptions?.enabled){
     // Do not await an offscreen reply that may itself send a gated Stage.
     void Api.runtime.sendMessage({type:'captionPipelineCanceled',requestId:Job.requestId}).catch(()=>{});
     try{
      const Receipt=await CancelNative(Job.requestId,Job.captionStatus?.attempt);
      CaptionStopped=Receipt?.phase==='canceled'&&(Job.captionStatus?.attempt===undefined||Receipt.attempt===Job.captionStatus.attempt);
     }catch{/* Logical cancellation persists; do not claim physical closure. */}
    }
    await updateJob(JobKey(Job.requestId),J=>J&&(!J.localCaptions?.enabled||J.captionStatus?.canceledByRestart)?{...J,restartCancellationPending:!DownloadStopped||!CaptionStopped,...(J.localCaptions?.enabled?{captionStatus:{...J.captionStatus,cancellationPending:!CaptionStopped}}:{})}:J);
   }
  })();
 }
 let Execution;
 const Transport=native?null:CreateCaptionNativeClient(Api,Event=>{
  if(Event.event==='operationProgress'){Execution?.onProgress(Event);return;}
  if(Event.event==='disconnected'){Execution?.disconnect();void OnNativeEvent({...Event,jobs:undefined}).catch(()=>{});return;}
  void OnNativeEvent(Event).catch(()=>{});
 });
 if(!native)Execution=CreateCaptionExecution({request:Message=>Transport.request(Message),emit:Event=>void OnNativeEvent(Event).catch(()=>{})});
 const Native=native || {
  request:Message=>Execution.request(Message),pruneExpired:()=>Execution.pruneExpired(),
  reset(){if(Execution.busy())throw Error('caption_busy');Transport.reset();Execution.disconnect();Execution=CreateCaptionExecution({request:Message=>Transport.request(Message),emit:Event=>void OnNativeEvent(Event).catch(()=>{})});},
 };
 const Update=(Id,Fields)=>updateJob(JobKey(Id),J=>J&&!(J.captionStatus?.phase==='canceled'&&Fields.phase!=='canceled')?{...J,captionStatus:MergeCaptionStatus(J.captionStatus,Fields)}:J);
 const Read=Id=>readJob(JobKey(Id));
 function JobRecognitionOptions(Job){
  const Selected=Job.localCaptions;
  return {...Selected,recognition:{...Selected.recognition},formats:Job.captionPipeline==='staged'?[...new Set([...Selected.formats,'vtt'])]:Selected.formats.length?[...Selected.formats]:['vtt']};
 }
 async function ProbeJob(Job){
  const Options=JobRecognitionOptions(Job),JobOptionsKey=CaptionOptionsKey(Job.localCaptions);
  const Key=Job.requestId+':'+JobOptionsKey;
  if(CapabilityCache.has(Key))return CapabilityCache.get(Key);
  const Pending=SendNative({action:'probe',...Options}).then(Result=>({...Result,jobOptionsKey:JobOptionsKey}));CapabilityCache.set(Key,Pending);
  try{return await Pending;}catch(E){CapabilityCache.delete(Key);throw E;}
 }
 async function SendNative(Message){
  if(!Message.jobId)return Native.request(Message);
  const Id=Message.jobId;
  if(['begin','append','prepare','start','openConcurrent','beginWindow','appendWindow','sealWindow','prepareEncodedBegin','prepareEncodedAppend','prepareEncodedSeal','appendFinalCues','finalizeResult','appendTranslation','saveResult','complete','decoderOpen','decoderPoll','decoderSupply','decoderAck'].includes(Message.action)){
   const Current=await Read(Id);if(!Current||Current.state==='canceled'||Current.pendingAction==='cancel'||Current.captionStatus?.cancelRequested||Current.captionStatus?.phase==='canceled')throw Error('caption_canceled');
   if(Reconnecting)throw Error('caption_busy');
   if(Current.captionStatus?.attempt!==undefined&&Current.captionStatus.attempt!==Message.attempt)throw Error('caption_stale_attempt');
  }
  let Pending=PendingNative.get(Id);if(!Pending){Pending=new Set();PendingNative.set(Id,Pending);}
  const Task=Native.request(Message);Pending.add(Task);
  try{return await Task;}finally{Pending.delete(Task);if(!Pending.size)PendingNative.delete(Id);}
 }
 async function CancelNative(Id,Attempt){
  const Message={action:'cancel',jobId:Id,...(Attempt?{attempt:Attempt}:{})},Pending=[...(PendingNative.get(Id)||[])];
  // Signal the native event before waiting for an in-flight sidecar/copy.
  // A second ACK closes the race with an already-dispatched admission.
  const Cancellation=Native.request(Message);const Settled=await Promise.allSettled([Cancellation,...Pending]);
  if(Settled[0].status==='rejected'&&Settled[0].reason?.message!=='caption_busy')throw Settled[0].reason;
  return Native.request(Message);
 }
 const RecordTranslation=(Id,Language,Target,Translation)=>updateJob(JobKey(Id),J=>{
  if(!J||J.captionStatus?.phase==='canceled')return J;
  const Base=J.captionStatus?.subtitleSourceStatus||J.subtitleStatus||{};
  return {...J,captionStatus:{...J.captionStatus,subtitleSourceStatus:Base},subtitleStatus:MergeGeneratedSubtitleStatus(Base,Language,Target,Translation)};
 });
 async function OnNativeEvent(Event){
  await Initialize();
  if(Event.event==='model-state'){if(['model-ready','model-failed','model-canceled'].includes(Event.phase))CapabilityCache.clear();await Api.runtime.sendMessage({type:'captionModelProgress',engine:Event.engine,model:Event.model,operationId:Event.operationId,phase:Event.phase,received:Event.received,total:Event.total,error:Event.error}).catch(()=>{});return;}
  if(Event.event==='disconnected'){
   CapabilityCache.clear();
   const Jobs=await listJobs(),Scopes=Array.isArray(Event.jobs)?Event.jobs:Jobs.filter(J=>J.localCaptions?.enabled&&!['complete','canceled'].includes(J.captionStatus?.phase)).map(J=>({jobId:J.requestId,attempt:J.captionStatus?.attempt}));
   for(const Scope of Scopes){
    const Job=Jobs.find(J=>J.requestId===Scope.jobId);if(!Job?.localCaptions?.enabled||Job.captionStatus?.attempt!==Scope.attempt)continue;
    const Current=await updateJob(JobKey(Job.requestId),J=>{
     if(!J||J.captionStatus?.attempt!==Scope.attempt||J.captionStatus?.cancelRequested||['complete','canceled'].includes(J.captionStatus?.phase))return J;
     const KeepOutputFailure=J.captionStatus.phase==='failed'&&J.captionStatus.retryAvailable&&J.captionStatus.recognitionFinalized;
     return {...J,captionStatus:MergeCaptionStatus(J.captionStatus,{phase:'failed',nativeFailureRevision:(J.captionStatus.nativeFailureRevision||0)+1,...(KeepOutputFailure?{}:{error:'caption_helper_missing'})})};
    });
    if(Current?.captionStatus?.phase!=='failed'||Current.captionStatus.attempt!==Scope.attempt)continue;
    await Api.runtime.sendMessage({type:'captionPipelineFailed',requestId:Job.requestId,attempt:Scope.attempt,code:'caption_helper_missing',nativeFailureRevision:Current.captionStatus.nativeFailureRevision}).catch(()=>{});
   }
   return;
  }
  if(Event.event!=='state'||!IdPattern.test(Event.jobId))return;
  // Capture the handoff at frame receipt, before storage I/O can outlive it.
  if(Handoffs.has(Event.jobId))return;
  const Job=await Read(Event.jobId);if(!Job?.localCaptions?.enabled)return;
  const Internal=InternalCancellation.get(Event.jobId);
  if(Event.phase==='canceled'&&(Internal?.attempt===Event.attempt||Event.attempt===undefined&&Job.captionStatus?.legacyNative&&Internal?.attempt===Job.captionStatus.attempt)&&(Job.captionStatus?.controlRevision||0)===Internal?.controlRevision&&!Job.captionStatus?.cancelRequested)return;
  if(Job.captionStatus?.cancelRequested&&Event.phase!=='canceled')return;
  if(Handoffs.has(Event.jobId)||Job.captionStatus?.attempt!==undefined&&Event.attempt!==Job.captionStatus.attempt&&!(Event.attempt===undefined&&Job.captionStatus?.legacyNative))return;
  const Fields={};for(const Key of ['phase','completed','total','error','language','attempt','mode','recognitionStarted','inputSealed','committedSamples','committedSpans','finalSamples','fallbackReason','finalizationPending','resultRevision','credit','windowState','warningCount','warningCode'])if(Event[Key]!==undefined)Fields[Key]=Event[Key];
  const Finalized=Job.captionStatus?.recognitionFinalized||Event.phase==='recognized'&&Event.finalizationPending!==true;
  if(Event.committedSamples!==undefined&&!Finalized)Fields.rawCommittedSamples=Event.committedSamples;
  if(Job.captionStatus?.finalCoverage&&!Finalized){
   const C=UnionCaptionSpans(Job.captionStatus.finalCoverage),N=Event.committedSamples??Job.captionStatus.rawCommittedSamples??0,Start=Job.captionStatus.recognitionStartSample||0;
   const Raw=Event.committedSpans||Job.captionStatus.committedSpans||(N>0?[{epoch:0,startSample:Start,endSample:Start+N}]:[]);
   Fields.finalSamples=CaptionSpanLength(C);Fields.committedSamples=CaptionSpanLength(IntersectCaptionSpans(C,Raw));
  }
  if(Finalized)Fields.recognitionFinalized=true;
  if(Event.usingFallback)Object.assign(Fields,{prepared:false,offset:0});
  if(Fields.phase==='preparation-failed')Object.assign(Fields,{phase:Job.captionStatus?.recognitionStarted?'queued':'waiting',prepared:false,preparationError:true});
  if(Job.captionStatus?.phase==='canceled'&&Fields.phase!=='canceled')return;
  if(Fields.phase==='failed'&&Job.captionPipeline!=='staged'&&!Job.captionStatus?.recognitionStarted&& !['complete','interrupted'].includes(Job.state))Object.assign(Fields,{phase:'waiting',prepared:false,preparationError:true});
  await updateJob(JobKey(Event.jobId),Current=>{
   if(!Current||Current.captionStatus?.attempt!==Job.captionStatus?.attempt||Current.captionStatus?.phase==='canceled'&&Fields.phase!=='canceled')return Current;
   if(Current.captionStatus?.phase==='failed'&&Current.captionStatus.retryAvailable)return Current;
   const Next={...Fields};if(Next.warningCount!==undefined){Next.finalWarningCount=Math.max(Current.captionStatus?.finalWarningCount||0,Next.warningCount);Next.warningCount=(Current.captionStatus?.mergeWarningCount||0)+Next.finalWarningCount;}if(Current.captionStatus?.recognitionFinalized&&['translating','muxing','saving','complete'].includes(Current.captionStatus.phase)&&['preparing','queued','loading-model','recognizing','recognized','windowed-ready'].includes(Next.phase))delete Next.phase;
   return {...Current,captionStatus:MergeCaptionStatus(Current.captionStatus,Next)};
  });
  if(Event.phase==='recognized'&&Array.isArray(Event.formats)&&Job.captionPipeline!=='staged')await SaveResults(Event.jobId,Event.formats);
 }
 async function BrowserFile(Job){
  if(!Number.isInteger(Job.downloadId))return null;
  const [Item]=await Api.downloads.search({id:Job.downloadId});
  return Item?.byExtensionId===Api.runtime.id&&Item.state==='complete'&&Item.exists!==false?Item:null;
 }
 async function SaveResults(Id,Formats){
  if(Completing.has(Id))return Completing.get(Id);
  const Task=(async()=>{
   let Job=await Read(Id);if(!Job||Job.captionStatus?.phase==='complete'||Job.captionStatus?.phase==='canceled')return;
   await Update(Id,{phase:'saving'});const Outputs=[],Controller=new AbortController();Saving.set(Id,Controller);
   if(Job.pickedDownloadFolder){
    const Folder=await requireFolder(Job.pickedDownloadFolder);
    const OriginalByFormat={...Job.captionStatus?.originalByFormat};
    for(const Format of Formats){Controller.signal.throwIfAborted();if((await Read(Id))?.captionStatus?.phase==='canceled')return;
     if(OriginalByFormat[Format]){Outputs.push(OriginalByFormat[Format]);continue;}let Offset=0;
     const Body=new ReadableStream({async pull(Controller){try{const Result=await SendNative({action:'readResult',jobId:Id,format:Format,offset:Offset});const Bytes=Uint8Array.from(atob(Result.data),C=>C.charCodeAt(0));Offset=Result.offset;if(Bytes.length)Controller.enqueue(Bytes);if(Result.done)Controller.close();}catch(E){Controller.error(E);}}});
     const Name=await writeFolder(Folder,CaptionOutputName(Job.filename,Format),Body,Controller.signal);Outputs.push(Name);OriginalByFormat[Format]=Name;
     await Update(Id,{originalByFormat:{...OriginalByFormat},outputs:[...Outputs]});
    }
   }else{
    const File=await BrowserFile(Job);if(!File)throw new Error('caption_source_missing');
    const Result=await SendNative({action:'saveResult',jobId:Id,videoPath:File.filename,formats:Formats});Outputs.splice(0,Outputs.length,...Result.outputs);Job.captionVideoPath=File.filename;
   }
   if(GeneratedTranslationRequested(Job)){
    await Update(Id,{outputs:[...new Set([...Outputs,...Object.values(Job.captionStatus?.translatedOutputs||{})])],originalOutputs:[...Outputs],translation:'pending'});
    try{
     const Translated=await TranslateGeneratedCaptions(Job,Formats,{api:Api,native:Native,signal:Controller.signal,
      savePicked:async(Format,Language,Bytes)=>{
       const Key=Language+':'+Format,Current=await Read(Id),Previous=Current?.captionStatus?.translatedOutputs?.[Key];if(Previous)return Previous;
       Controller.signal.throwIfAborted();return writeFolder(await requireFolder(Job.pickedDownloadFolder),CaptionOutputName(Job.filename,Format).replace('.'+Format,'.'+Language+'.'+Format),new Blob([Bytes]).stream(),Controller.signal);
      },
      onOutput:async(Format,Language,Name)=>{Controller.signal.throwIfAborted();await updateJob(JobKey(Id),J=>J&&J.captionStatus?.phase!=='canceled'?{...J,captionStatus:{...J.captionStatus,translatedOutputs:{...J.captionStatus.translatedOutputs,[Language+':'+Format]:Name},outputs:[...new Set([...(J.captionStatus.outputs||[]),Name])]}}:J);},
      onState:async(Translation,Source,Target)=>{Controller.signal.throwIfAborted();await Update(Id,{phase:Translation==='translating'?'translating':'saving',translation:Translation});await RecordTranslation(Id,Source,Target,Translation);}});
     Outputs.push(...Translated);
    }catch(ErrorValue){if(!Controller.signal.aborted&&(await Read(Id))?.captionStatus?.phase!=='canceled'){await Update(Id,{translation:'failed'});await RecordTranslation(Id,Job.captionStatus?.language||Job.localCaptions.language,Job.subtitleOptions.translation.targetLanguage,'failed');}throw Error(ErrorValue.message==='caption_helper_update_required'?ErrorValue.message:'caption_translation_failed');}
   }
   if((await Read(Id))?.captionStatus?.phase==='canceled')return;
   await SendNative({action:'complete',jobId:Id});
   if((await Read(Id))?.captionStatus?.phase!=='canceled')await Update(Id,{phase:'complete',outputs:Outputs,error:null});
  })().catch(async E=>{if((await Read(Id))?.captionStatus?.phase!=='canceled')await Update(Id,{phase:'failed',error:E.message?.startsWith('caption_')?E.message:'caption_save_failed'});}).finally(()=>{Completing.delete(Id);Saving.delete(Id);});
  Completing.set(Id,Task);return Task;
 }
 async function Start(Id,Retry=false){
  await Initialize();
  if(Starting.has(Id))return Starting.get(Id);
  const Task=(async()=>{
   let Job=await Read(Id);if(!Job?.localCaptions?.enabled||Job.snapshot)return;
   if(Job.captionStatus?.canceledByRestart)throw Error('caption_canceled');
   if(Retry&&!Job.localCaptions.model&&Api.storage?.local){
    const Saved=NormalizeCaptionSettings((await Api.storage.local.get(CaptionSettingKey))[CaptionSettingKey],(await Api.runtime.getPlatformInfo()).os);
    if(Saved.model){await updateJob(JobKey(Id),J=>J?{...J,localCaptions:{...J.localCaptions,engine:Saved.engine,model:Saved.model}}:J);Job=await Read(Id);}
   }
   if(Job.captionPipeline==='staged'){
    if(!Retry)return;
    if(!['failed','canceled'].includes(Job.captionStatus?.phase))throw Error('caption_busy');
    const RetryToken=crypto.randomUUID(),Revision=Job.captionStatus?.controlRevision||0;
    const Authorized=await updateJob(JobKey(Id),J=>J&&(J.captionStatus?.controlRevision||0)===Revision&&!J.pendingAction?{...J,captionStatus:{...J.captionStatus,retryToken:RetryToken}}:J);
    if(Authorized?.captionStatus?.retryToken!==RetryToken)throw Error('caption_stale_attempt');
    const Result=await Api.runtime.sendMessage({type:'captionPipelineResume',requestId:Id,localCaptions:Job.localCaptions,retryToken:RetryToken,controlRevision:Revision});
    if(!Result?.ok){await Update(Id,{phase:'failed',retryAvailable:false,error:'caption_source_missing'});throw Error('caption_source_missing');}
    return Result;
   }
   if(!Retry&&['complete','canceled','failed','queued','recognizing','saving','translating'].includes(Job.captionStatus?.phase))return;
   const File=await BrowserFile(Job);
   if(!File&&!(Job.pickedDownloadFolder&&['complete','interrupted'].includes(Job.state)))return;
   const Queued=await updateJob(JobKey(Id),Current=>{
    if(!Current||(Current.captionStatus?.controlRevision||0)!==(Job.captionStatus?.controlRevision||0)||!Retry&&Current.captionStatus?.phase==='canceled')return Current;
    return {...Current,captionStatus:{...Current.captionStatus,phase:'queued',error:null,recognitionStarted:true}};
   });
   if(!Queued||Queued.captionStatus?.phase==='canceled')return;
   try{
    if(!Job.localCaptions.model)throw new Error('caption_model_missing');
    const Status=await SendNative({action:'status',jobId:Id});
    if((await Read(Id))?.captionStatus?.phase==='canceled')return;
    if(Status.phase==='recognized'||Status.phase==='complete'){await SaveResults(Id,Job.localCaptions.formats);return;}
    let Prepared=Job.captionStatus?.prepared===true&&['staged','preparing','audio-ready','queued','recognizing'].includes(Status.phase);
    let StartOffset=Prepared?Job.captionStatus.offset||0:0;
    if(Job.pickedDownloadFolder&&!Prepared){
     const Folder=await requireFolder(Job.pickedDownloadFolder),File=await (await Folder.getFileHandle(Job.filename)).getFile();
     await SendNative({action:'begin',jobId:Id});
     for(let Offset=0;Offset<File.size;Offset+=192*1024){
      if((await Read(Id))?.captionStatus?.phase==='canceled')return;
      const Bytes=new Uint8Array(await File.slice(Offset,Offset+192*1024).arrayBuffer());let Text='';for(let I=0;I<Bytes.length;I+=8192)Text+=String.fromCharCode(...Bytes.subarray(I,I+8192));
      await SendNative({action:'append',jobId:Id,offset:Offset,data:btoa(Text)});
     }
     await SendNative({action:'prepare',jobId:Id});Prepared=true;StartOffset=0;await Update(Id,{prepared:true,offset:0});
    }
    if(!Prepared)await Update(Id,{prepared:false,offset:0});
    await SendNative({action:'start',jobId:Id,options:JobRecognitionOptions(Job),offset:StartOffset,...(File?Prepared?{fallbackPath:File.filename}:{sourcePath:File.filename}:{})});
   }catch(E){if((await Read(Id))?.captionStatus?.phase!=='canceled')await Update(Id,{phase:'failed',error:E.message?.startsWith('caption_')?E.message:'caption_recognition_failed'});}
  })().finally(()=>Starting.delete(Id));Starting.set(Id,Task);return Task;
 }
 async function Stage(Message){
  const Id=Message.requestId;if(!IdPattern.test(Id))throw new Error('caption_invalid');
  // Cleanup authority is the execution-owned job/attempt/token, including a
  // confirmed-close receipt after its durable job record has been removed.
  if(Message.action==='decoderClose'){
   if(!IdPattern.test(Message.decoderToken||''))throw Error('caption_invalid');ValidateCaptionAttempt(Message.attempt);
   return SendNative({action:'decoderClose',jobId:Id,attempt:Message.attempt,decoderToken:Message.decoderToken});
  }
  const Job=await Read(Id);if(!Job?.localCaptions?.enabled||Job.snapshot)throw new Error('caption_state');
  if(Message.action==='capabilities')return ProbeJob(Job);
  if(Message.action==='beginAttempt'){
   const MayPublish=Current=>Current&&Current.captionPipeline==='staged'&&['active','starting'].includes(Current.state)&&Current.pendingAction!=='cancel'&&!Current.captionStatus?.cancelRequested&&!['canceled','complete'].includes(Current.captionStatus?.phase)&&
    (Current.captionStatus?.phase!=='failed'||Current.captionStatus.handoffRevision===Message.controlRevision)&&
    (Current.captionStatus?.controlRevision||0)===Message.controlRevision&&(Current.captionStatus?.attempt||0)===Message.previousAttempt&&!Reconnecting;
   if(!MayPublish(Job)||Handoffs.has(Id))throw Error('caption_stale_attempt');
   Handoffs.add(Id);
   try{
    if(Job.captionStatus?.attempt)InternalCancellation.set(Id,{attempt:Job.captionStatus.attempt,controlRevision:Message.controlRevision});
    if(Job.captionStatus?.attempt)await SendNative({action:'cancel',jobId:Id,attempt:Job.captionStatus.attempt});
    const Attempt=ValidateCaptionAttempt((Job.captionStatus?.attempt||0)+1),Probe=await ProbeJob(Job);
    const Current=await updateJob(JobKey(Id),J=>{
     if(!MayPublish(J))return J;
    return {...J,state:'active',captionStatus:{...J.captionStatus,attempt:Attempt,phase:'waiting',warningCount:0,mergeWarningCount:0,finalWarningCount:0,warningCode:null,handoffRevision:null,liveTranscript:null,liveFile:null,mode:'postprocess',recognitionStarted:false,inputSealed:false,committedSamples:0,rawCommittedSamples:0,recognitionFinalized:false,finalSamples:null,finalCoverage:null,recognitionStartSample:null,resultRevision:null,outputReceipts:{},translationLanguage:null,offset:0,preparationError:false,error:null,prepared:false,legacyNative:!CaptionConcurrentReady(Probe),...(Message.fallbackReason?{fallbackReason:String(Message.fallbackReason).slice(0,96)}:{})}};
    });
    if(Current?.captionStatus?.attempt!==Attempt)throw Error('caption_stale_attempt');InternalCancellation.delete(Id);return {attempt:Attempt};
   }finally{Handoffs.delete(Id);}
  }
  if(Job.captionStatus?.attempt!==undefined&&Message.attempt!==Job.captionStatus.attempt)throw Error('caption_stale_attempt');
  const Attempt=Job.captionStatus?.attempt,NativeJob={jobId:Id,...(Attempt?{attempt:Attempt}:{})};
  if(Message.action==='quiesce'){
   Handoffs.add(Id);InternalCancellation.set(Id,{attempt:Attempt,controlRevision:Message.controlRevision});try{const Result=await CancelNative(Id,Attempt);await updateJob(JobKey(Id),J=>J&&['active','starting'].includes(J.state)&&J.pendingAction!=='cancel'&&!J.captionStatus?.cancelRequested&&(J.captionStatus?.controlRevision||0)===Message.controlRevision&&J.captionStatus?.attempt===Attempt?{...J,captionStatus:{...J.captionStatus,handoffRevision:Message.controlRevision}}:J);return Result;}finally{Handoffs.delete(Id);}
  }
  if(Message.action==='failure'){
   let ExpiresAt;
   if(Message.retryAvailable===true){ExpiresAt=Date.now()+CaptionPolicy.retentionMs;try{const State=await SendNative({action:'status',...NativeJob});if(Number.isFinite(State.updated))ExpiresAt=Math.min(ExpiresAt,State.updated*1000+CaptionPolicy.retentionMs);}catch{}}
   if(Job.captionStatus?.phase!=='canceled')await Update(Id,{phase:Job.captionPipeline==='staged'||Job.captionStatus?.recognitionStarted||['complete','interrupted'].includes(Job.state)?'failed':'waiting',error:CaptionFailureCode(Message.code)||'caption_prepare_failed',...(Message.details?{errorDetails:CaptionFailureDetails(Message.details)}:{}),...(Message.retryAvailable===true?{retryAvailable:true,expiresAt:ExpiresAt}:{}),...(Message.finalMediaReady===true?{finalMediaReady:true}:{})});return {expiresAt:ExpiresAt};
  }
  if(Message.action==='expireOutput'){
   Handoffs.add(Id);
   try{for(;;){try{await CancelNative(Id,Attempt);break;}catch(ErrorValue){if(ErrorValue.message!=='caption_busy')break;await new Promise(Resolve=>setTimeout(Resolve,CaptionPolicy.pollIntervalMs));}}await SendNative({action:'forget',...NativeJob}).catch(()=>{});}
   finally{Handoffs.delete(Id);await updateJob(JobKey(Id),J=>J&&J.captionStatus?.attempt===Attempt&&J.captionStatus.retryAvailable?{...J,captionStatus:MergeCaptionStatus(J.captionStatus,{phase:'failed',retryAvailable:false,error:'caption_source_missing'})}:J);}return {};
  }
  if(Job.captionStatus?.phase==='canceled'&&!['saved','cancel','outputReceipt','resumeOutput','decoderClose'].includes(Message.action))throw new Error('caption_canceled');
  if(Message.action==='timing'){
   if(!Number.isFinite(Message.offset)||Math.abs(Message.offset)>86400)throw new Error('caption_invalid');
   await Update(Id,{offset:Message.offset});return {};
  }
  if(Message.action==='timingWarnings'){
   if(!Number.isSafeInteger(Message.count)||Message.count<1||Message.count>CaptionPolicy.maxLedgerBytes)throw Error('caption_invalid');
   const Count=Math.max(Job.captionStatus?.mergeWarningCount||0,Message.count);await Update(Id,{mergeWarningCount:Count,warningCount:Count+(Job.captionStatus?.finalWarningCount||0),warningCode:'caption_timing_adjusted'});return {};
  }
  if(Job.captionPipeline==='staged'){
   const DecoderActions={decoderOpen:['sourceFingerprint','access','resample'],decoderPoll:['decoderToken','afterEvent','maxEvents','maxBytes'],decoderSupply:['decoderToken','offset','data','eof'],decoderAck:['decoderToken','throughEvent','throughFrame'],decoderClose:['decoderToken']};
   if(Object.hasOwn(DecoderActions,Message.action)){
    if(!Attempt||Message.action!=='decoderClose'&&(!['active','starting'].includes(Job.state)||(Job.captionStatus?.controlRevision||0)!==(Message.controlRevision||0)))throw Error('caption_stale_attempt');
    if(Message.action==='decoderOpen'){
     const P=await ProbeJob(Job);if(!(P.avDecodeStreamVersion>=1)||!CaptionConcurrentReady(P,'windowed'))throw Error('caption_concurrency_unsupported');if(Message.resample?.async&&P.avDecodeStreamVersion<2)throw Error('caption_helper_update_required');
     if(Message.resample!==undefined&&(!Message.resample||Object.keys(Message.resample).join(',')!=='async'||!Number.isSafeInteger(Message.resample.async)||Message.resample.async<0||Message.resample.async>1000))throw Error('caption_invalid');
     if(!/^[a-f0-9]{64}$/.test(Message.sourceFingerprint||'')||!Message.access||typeof Message.access.seekable!=='boolean'||Message.access.knownSize!==null&&(!Number.isSafeInteger(Message.access.knownSize)||Message.access.knownSize<0)||Message.access.seekable&&Message.access.knownSize===null)throw Error('caption_invalid');
    }else if(typeof Message.decoderToken!=='string'||!IdPattern.test(Message.decoderToken))throw Error('caption_invalid');
    if(Message.action==='decoderPoll'&&(!Number.isSafeInteger(Message.afterEvent)||Message.afterEvent<0||!Number.isSafeInteger(Message.maxEvents)||Message.maxEvents<1||Message.maxEvents>CaptionPolicy.resultPageItems||Message.maxBytes!==CaptionPolicy.resultPageBytes))throw Error('caption_invalid');
    if(Message.action==='decoderSupply'&&(typeof Message.data!=='string'||Message.data.length>Math.ceil(CaptionPolicy.uploadChunkBytes/3)*4||typeof Message.eof!=='boolean'||!Number.isSafeInteger(Message.offset)||Message.offset<0||!/^r[1-9][0-9]*$/.test(Message.inputRequestId||'')))throw Error('caption_invalid');
    if(Message.action==='decoderAck'&&(!Number.isSafeInteger(Message.throughEvent)||Message.throughEvent<0||!Number.isSafeInteger(Message.throughFrame)||Message.throughFrame<0))throw Error('caption_invalid');
    const Fields=Object.fromEntries(DecoderActions[Message.action].map(K=>[K,Message[K]]));
    if(Message.action==='decoderSupply')Fields.requestId=Message.inputRequestId;
    if(Message.action==='decoderOpen')Fields.access={seekable:Message.access.seekable,knownSize:Message.access.knownSize};
    return SendNative({action:Message.action,...NativeJob,...Fields});
   }
   if(Message.action==='finalCoverage'){
    const C=UnionCaptionSpans(Message.coverage),Raw=Message.committedSpans?UnionCaptionSpans(Message.committedSpans):Job.captionStatus?.committedSpans||[];
    await Update(Id,{finalCoverage:C,finalSamples:CaptionSpanLength(C),committedSamples:CaptionSpanLength(IntersectCaptionSpans(C,Raw))});return {};
   }
   if(Message.action==='recognizeEarly'){
    if(!['active','starting'].includes(Job.state)||!Job.captionStatus?.prepared||!Attempt)throw Error('caption_state');
    const Probe=await ProbeJob(Job);if(!CaptionConcurrentReady(Probe))throw Error('caption_concurrency_unsupported');
    await Update(Id,{phase:'queued',mode:'early-audio',recognitionStarted:true,error:null});
    return SendNative({action:'start',...NativeJob,timelineMode:'deferred',offset:0,options:JobRecognitionOptions(Job)});
   }
   const PreviewActions={beginPreview:['preview','prepareToken'],appendPreview:['previewId','offset','data'],sealPreview:['previewId','bytes','sha256'],releasePreview:['previewId']};
   if(Object.hasOwn(PreviewActions,Message.action)){
    const Current=()=>Read(Id),Valid=J=>J&&Attempt&&J.captionStatus?.attempt===Attempt&&(J.captionStatus.controlRevision||0)===(Message.controlRevision||0)&&['active','starting'].includes(J.state)&&J.pendingAction!=='cancel'&&!J.captionStatus.cancelRequested&&!['failed','canceled','complete'].includes(J.captionStatus.phase)&&J.captionStatus.mode==='windowed';
    if(!Valid(Job))throw Error('caption_stale_attempt');
    if(Message.action==='beginPreview')ValidateCaptionPreview(Message.preview);
    else if(!/^[a-f0-9]{64}$/.test(Message.previewId||''))throw Error('caption_invalid');
    if(Message.prepareToken!==undefined&&!IdPattern.test(Message.prepareToken))throw Error('caption_invalid');
    if(Message.action==='appendPreview'&&(typeof Message.data!=='string'||Message.data.length>Math.ceil(CaptionPolicy.uploadChunkBytes/3)*4||!Number.isSafeInteger(Message.offset)||Message.offset<0))throw Error('caption_invalid');
    const Fields=Object.fromEntries(PreviewActions[Message.action].filter(K=>Message[K]!==undefined).map(K=>[K,Message[K]]));
    const Result=await SendNative({action:Message.action,...NativeJob,...Fields});
    if(!Valid(await Current()))throw Error('caption_stale_attempt');return Result;
   }
   const ConcurrentActions={openConcurrent:['sourceFingerprint'],prepareEncodedBegin:['bytes','sha256','repairOf','repairAttempt','purpose'],prepareEncodedAppend:['prepareToken','offset','data'],prepareEncodedSeal:['prepareToken'],prepareEncodedRelease:['prepareToken'],beginWindow:['window','prepareToken'],appendWindow:['windowId','offset','data'],sealWindow:['windowId','bytes','sha256'],windowResults:['cursor','limit'],readWindowResult:['windowId','offset'],ackWindows:['windowIds','committedSamples','committedSpans'],sealConcurrent:['sourceEndSample','reason','spans','sourceOrigin','sourceOriginRational'],appendFinalCues:['offset','data','done'],finalizeResult:['mapping','outputStart','outputEnd','expectedCoverage','audioBoundOnly','formats']};
   if(Object.hasOwn(ConcurrentActions,Message.action)){
    if(!Attempt||!['active','starting'].includes(Job.state))throw Error('caption_state');
    if(Message.action.startsWith('prepareEncoded')&&((Job.captionStatus?.controlRevision||0)!==(Message.controlRevision||0)||Job.pendingAction==='cancel'||Job.captionStatus?.cancelRequested||['failed','canceled','complete'].includes(Job.captionStatus?.phase)))throw Error('caption_stale_attempt');
    if(Message.purpose!==undefined&&(Message.purpose!=='preview'||(Job.captionStatus?.controlRevision||0)!==(Message.controlRevision||0)||Job.pendingAction==='cancel'||Job.captionStatus?.cancelRequested||['failed','canceled','complete'].includes(Job.captionStatus?.phase)||Job.captionStatus?.mode!=='windowed'))throw Error('caption_stale_attempt');
    if(Message.action==='beginWindow')ValidateCaptionWindow(Message.window);
    if(['appendWindow','appendFinalCues','prepareEncodedAppend'].includes(Message.action)&&(typeof Message.data!=='string'||Message.data.length>Math.ceil(CaptionPolicy.uploadChunkBytes/3)*4))throw Error('caption_invalid');
    if(Message.prepareToken!==undefined&&(typeof Message.prepareToken!=='string'||!/^[a-f\d-]{36}$/i.test(Message.prepareToken)))throw Error('caption_invalid');
    if(Message.action==='openConcurrent'&&!CaptionConcurrentReady(await ProbeJob(Job),'windowed'))throw Error('caption_concurrency_unsupported');
    const Fields=Object.fromEntries(ConcurrentActions[Message.action].filter(K=>Message[K]!==undefined).map(K=>[K,Message[K]]));
    if(Message.action==='openConcurrent')Fields.options=JobRecognitionOptions(Job);
    if(Message.action==='finalizeResult')Fields.formats=[...new Set([...Job.localCaptions.formats,'vtt'])];
    const Result=await SendNative({action:Message.action,...NativeJob,...Fields});
    if(Message.action==='beginWindow'&&!Message.window.repairOf&&Job.captionStatus?.recognitionStartSample==null)await Update(Id,{recognitionStartSample:Message.window.coreStartSample});
    if(Message.action==='openConcurrent')await Update(Id,{mode:'windowed',recognitionStarted:true,phase:Result.phase,error:null});
    if(Message.action==='finalizeResult')await Update(Id,{phase:'recognized',resultRevision:Result.resultRevision,recognitionFinalized:true,finalizationPending:false,finalCoverage:Message.expectedCoverage,committedSamples:Result.committedSamples,finalSamples:Result.finalSamples,language:Result.language});
    return Result;
   }
   if(Message.action==='outputReceipt'){
    if(!Message.receipt||!['media','sidecar'].includes(Message.kind)||!Number.isSafeInteger(Message.receipt.bytes)||Message.receipt.bytes<0||typeof Message.receipt.filename!=='string'||/[\\/\x00]/.test(Message.receipt.filename))throw Error('caption_invalid');
    const Receipt={filename:Message.receipt.filename,bytes:Message.receipt.bytes,resultRevision:Job.captionStatus?.resultRevision||0,...(Number.isInteger(Message.receipt.downloadId)?{downloadId:Message.receipt.downloadId}:{})};
    if(Message.kind==='sidecar'&&(typeof Message.key!=='string'||Message.key.length>80))throw Error('caption_invalid');
    await updateJob(JobKey(Id),J=>J&&J.captionStatus?.attempt===Attempt?{...J,...(Message.kind==='media'?{filename:Receipt.filename,exists:true,bytesReceived:Receipt.bytes,totalBytes:Receipt.bytes}:{}),captionStatus:{...J.captionStatus,outputReceipts:{...J.captionStatus.outputReceipts,...(Message.kind==='media'?{media:Receipt}:{sidecars:{...J.captionStatus.outputReceipts?.sidecars,[Message.key]:Receipt}})},finalMediaReady:true}}:J);return Receipt;
   }
   if(Message.action==='resumeOutput'){
    let Resumed=false;
    await updateJob(JobKey(Id),J=>{if(!J||!Message.retryToken||J.captionStatus?.retryToken!==Message.retryToken||(J.captionStatus?.controlRevision||0)!==Message.controlRevision||J.pendingAction==='cancel')return J;Resumed=true;return {...J,state:'active',error:null,captionStatus:{...J.captionStatus,phase:'preparing',cancelRequested:false,retryToken:null,outputRetrying:true,retryAvailable:false,error:null}};});
    if(!Resumed)throw Error('caption_stale_attempt');return {controlRevision:Message.controlRevision,nativeFailureRevision:Job.captionStatus?.nativeFailureRevision||0};
   }
   if(Message.action==='saveArtifact'){
    if(Job.pickedDownloadFolder||!Job.localCaptions.formats.includes(Message.format)||Message.language!==undefined&&Message.language!==Job.subtitleOptions?.translation?.targetLanguage)throw Error('caption_invalid');
    const File=await BrowserFile(Job);if(!File)throw Error('caption_source_missing');
    return SendNative({action:'saveResult',...NativeJob,videoPath:File.filename,formats:[Message.format],...(Message.language?{translationLanguage:Message.language}:{})});
   }
   if(Message.action==='recognize'){
    if(!['active','starting'].includes(Job.state)||!Job.localCaptions.model)throw Error('caption_state');
    const Probe=await ProbeJob(Job);if(!CaptionRuntimeReady(Probe))throw Error('caption_helper_update_required');
    const Status=await SendNative({action:'status',...NativeJob});
    if(Status.phase==='recognized')return Status;
    const Current=await Read(Id);if(!Current||Current.captionStatus?.phase==='canceled')throw Error('caption_canceled');
    await Update(Id,{phase:'queued',recognitionStarted:true,error:null});
    return SendNative({action:'start',...NativeJob,options:JobRecognitionOptions(Job),offset:Job.captionStatus?.prepared?Job.captionStatus.offset||0:0});
   }
   if(Message.action==='processing'){
    if(!['preparing','metadata-waiting','translating','muxing','saving'].includes(Message.phase)||Message.mediaReady!==undefined&&(Message.mediaReady!==true||Message.phase!=='preparing'))throw Error('caption_invalid');
    if(Message.fallbackReason!==undefined&&(typeof Message.fallbackReason!=='string'||Message.fallbackReason.length>96))throw Error('caption_invalid');
    await Update(Id,{phase:Message.phase,...(Message.mediaReady===true?{mediaReady:true}:{}),...(Message.fallbackReason?{fallbackReason:Message.fallbackReason}:{}),...(Message.phase==='translating'?{translation:'translating'}:{})});return {};
   }
   if(Message.action==='translationResult'){
    const Translation=Job.subtitleOptions?.translation;
    if(!Translation?.generated||!['complete','not_needed','failed'].includes(Message.result)||typeof Message.language!=='string'||Message.language.length>35)throw Error('caption_invalid');
    await Update(Id,{translation:Message.result});
    await RecordTranslation(Id,Message.language,Translation.targetLanguage,Message.result);return {};
   }
   if(Message.action==='readResult'){
    if(!['srt','vtt'].includes(Message.format)||!Number.isSafeInteger(Message.offset)||Message.offset<0)throw Error('caption_invalid');
    return SendNative({action:'readResult',...NativeJob,format:Message.format,offset:Message.offset});
   }
   if(Message.action==='appendTranslation'){
    if(!Job.subtitleOptions?.translation?.generated||Message.language!==Job.subtitleOptions.translation.targetLanguage||!Job.localCaptions.formats.includes(Message.format))throw Error('caption_invalid');
    const Result=await SendNative({action:'appendTranslation',...NativeJob,format:Message.format,language:Message.language,offset:Message.offset,data:Message.data,done:Message.done});
    if(Message.done)await Update(Id,{translationLanguage:Message.language});return Result;
   }
   if(Message.action==='saved'){
    const Receipts=Job.captionStatus?.outputReceipts;
    if(!Receipts?.media||Job.localCaptions.formats.some(F=>!Receipts.sidecars?.['original:'+F])||GeneratedTranslationRequested(Job)&&Job.captionStatus?.translation==='complete'&&Job.localCaptions.formats.some(F=>!Receipts.sidecars?.[Job.subtitleOptions.translation.targetLanguage+':'+F]))throw Error('caption_save_incomplete');
    const Outputs=Object.values(Receipts.sidecars||{}).map(R=>R.filename);
    if((await Read(Id))?.captionStatus?.phase==='canceled')throw Error('caption_canceled');
    await SendNative({action:'complete',...NativeJob});await updateJob(JobKey(Id),J=>J&&J.captionStatus?.phase!=='canceled'?{...J,state:J.recordingInterrupted?'interrupted':'complete',endTime:new Date().toISOString(),captionStatus:{...J.captionStatus,phase:'complete',outputs:[...new Set(Outputs)],retryAvailable:false,error:null}}:J);return {};
   }
  }
  if(Message.action==='saved')return Start(Id);
  if(!['begin','append','prepare','cancel','status'].includes(Message.action))throw new Error('caption_invalid');
  if(Message.action==='begin'&&!['active','starting','complete','interrupted'].includes(Job.state))throw new Error('caption_state');
  const Result=Message.action==='cancel'?await CancelNative(Id,Attempt):await SendNative({action:Message.action,...NativeJob,...(Message.action==='append'?{offset:Message.offset,data:Message.data}:{})});
  if(Message.action==='status'&&Result.phase==='audio-ready')await Update(Id,{prepared:true});return Result;
 }
 return {
  initialize:Initialize,
  async handle(Message,Sender){
   if(!CaptionSenderAllowed(Message,Sender,Api))throw new Error('caption_forbidden');
   await Initialize();
   if(Message.type==='captionStage')return Stage(Message);
   if(Message.type==='captionReconnect'){
    const Jobs=await listJobs();
    if(Reconnecting||Starting.size||Completing.size||Saving.size||Handoffs.size)throw new Error('caption_busy');
    Reconnecting=true;
    try{
     for(const Job of Jobs.filter(J=>J.localCaptions?.enabled&&(!['complete','canceled'].includes(J.captionStatus?.phase)||J.captionStatus?.retryAvailable||['active','starting','started','paused'].includes(J.state)))){
      const Response=await Api.runtime.sendMessage({type:'captionPipelineQuiesce',requestId:Job.requestId,attempt:Job.captionStatus?.attempt,failed:Job.captionStatus?.phase==='failed'}).catch(()=>null);
      if(Response?.busy||Response?.owned&&!Response.ok)throw Error('caption_busy');
      if(Response?.owned)continue;
      if(ActivePhases.includes(Job.captionStatus?.phase))throw Error('caption_busy');
      if(Job.captionStatus?.retryAvailable)await Update(Job.requestId,{retryAvailable:false,error:'caption_source_missing'});
     }
     if(typeof Native.reset!=='function')throw new Error('caption_helper_missing');
     Native.reset();CapabilityCache.clear();return {reconnected:true};
    }finally{Reconnecting=false;}
   }
   if(['captionProbe','captionPrepareModel','captionCancelModel','captionDeleteModel'].includes(Message.type)){
    const Platform=(await Api.runtime.getPlatformInfo()).os;const Options=NormalizeCaptionSettings(Message,Platform,{strict:true});if(!Options.formats.length)Options.formats=['vtt'];
    if(Message.type==='captionProbe'){CapabilityCache.clear();return SendNative({action:'probe',...Options});}
    if(!CaptionModels.includes(Message.model)||!['faster-whisper','whisper.cpp'].includes(Message.engine)||Options.engine!==Message.engine)throw new Error('caption_invalid');
    const Action={captionPrepareModel:'prepareModel',captionCancelModel:'cancelModel',captionDeleteModel:'deleteModel'}[Message.type];
    if(Action!=='deleteModel'&&(typeof Message.operationId!=='string'||!ModelOperationPattern.test(Message.operationId)))throw new Error('caption_invalid');
    CapabilityCache.clear();return SendNative({action:Action,...Options,...(Action==='deleteModel'?{}:{operationId:Message.operationId})});
   }
   if(Message.type==='captionControl'){
    if(!IdPattern.test(Message.requestId))throw new Error('caption_invalid');
    if(Message.action==='retry')return Start(Message.requestId,true);
    if(Message.action==='cancel'){
     const Job=await Read(Message.requestId);if(Job?.captionPipeline==='staged'&&Job.captionStatus?.phase==='complete')throw Error('caption_state');
     Saving.get(Message.requestId)?.abort();InternalCancellation.delete(Message.requestId);await updateJob(JobKey(Message.requestId),J=>J?{...J,captionStatus:{...J.captionStatus,phase:'canceled',cancelRequested:true,retryToken:null,controlRevision:(J.captionStatus?.controlRevision||0)+1}}:J);
     if(Job?.captionPipeline==='staged')void Api.runtime.sendMessage({type:'captionPipelineCanceled',requestId:Message.requestId}).catch(()=>{});
     await CancelNative(Message.requestId,Job?.captionStatus?.attempt);return {};
    }
   }
   throw new Error('caption_invalid');
  },
  async downloadChanged(Change){
   await Initialize();
   if(Change.state?.current!=='complete')return;
   for(const Job of await listJobs())if(Job.downloadId===Change.id&&Job.localCaptions?.enabled)await Start(Job.requestId);
  },
  async jobsChanged(Changes){
   await Initialize();
   for(const [Key,Change]of Object.entries(Changes)){
    if(!Key.startsWith('job:'))continue;
    const Job=Change.newValue,Previous=Change.oldValue;
    if(!Job&&Previous?.localCaptions?.enabled){Saving.get(Previous.requestId)?.abort();InternalCancellation.delete(Previous.requestId);if(Previous.captionPipeline==='staged')void Api.runtime.sendMessage({type:'captionPipelineCanceled',requestId:Previous.requestId}).catch(()=>{});const Attempt=Previous.captionStatus?.attempt?{attempt:Previous.captionStatus.attempt}:{};await CancelNative(Previous.requestId,Previous.captionStatus?.attempt).catch(()=>{});await SendNative({action:'forget',jobId:Previous.requestId,...Attempt}).catch(()=>{});}
    if(Job?.localCaptions?.enabled&&['failed','canceled'].includes(Job.state)&&Job.state!==Previous?.state&&Job.captionStatus?.phase!=='complete'){
     if(Job.state==='failed'&&Job.captionStatus?.retryAvailable)continue;
     InternalCancellation.delete(Job.requestId);
     await updateJob(JobKey(Job.requestId),J=>J?{...J,captionStatus:{...J.captionStatus,phase:'canceled',cancelRequested:true,retryToken:null,controlRevision:Math.max(J.captionStatus?.controlRevision||0,(Previous?.captionStatus?.controlRevision||0)+1)}}:J);
     if(Job.captionPipeline==='staged')void Api.runtime.sendMessage({type:'captionPipelineCanceled',requestId:Job.requestId}).catch(()=>{});await CancelNative(Job.requestId,Job.captionStatus?.attempt).catch(()=>{});
    }
    if(Job?.localCaptions?.enabled&&Job.downloadId!==undefined&&Job.downloadId!==Previous?.downloadId)await Start(Job.requestId);
   }
  },
  start:Start,onNativeEvent:OnNativeEvent,
 };
}
