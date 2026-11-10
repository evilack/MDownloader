import {CaptionPolicy as Policy,CaptionDigest,CaptionAbortableWait,ValidateCaptionWindow} from './concurrent-captions-contract.js';
import {CaptionRationalSample,CaptionRationalSeconds,UnionCaptionSpans} from './caption-timeline.js';
import {CaptionPreviewPolicy,ValidateCaptionPreview} from './caption-preview.js';
import {CaptionDecoderError} from './caption-failure.js';

const PCM_BYTES=2,WAV_BYTES=44;
const Decode=S=>Uint8Array.from(atob(S),C=>C.charCodeAt(0));
const Encode=B=>{let S='';for(let I=0;I<B.length;I+=8192)S+=String.fromCharCode(...B.subarray(I,I+8192));return btoa(S);};
const Safe=N=>Number.isSafeInteger(N)&&N>=0;
function WavHeader(Frames){
 const B=new Uint8Array(WAV_BYTES),V=new DataView(B.buffer),Text=(O,S)=>{for(let I=0;I<S.length;I++)B[O+I]=S.charCodeAt(I);};
 Text(0,'RIFF');V.setUint32(4,36+Frames*PCM_BYTES,true);Text(8,'WAVE');Text(12,'fmt ');V.setUint32(16,16,true);V.setUint16(20,1,true);V.setUint16(22,1,true);
 V.setUint32(24,Policy.sampleRate,true);V.setUint32(28,Policy.sampleRate*PCM_BYTES,true);V.setUint16(32,PCM_BYTES,true);V.setUint16(34,16,true);Text(36,'data');V.setUint32(40,Frames*PCM_BYTES,true);return B;
}
/** One demand-driven decoder and a bounded physical PCM ring. Producer commit
 * callbacks never await this reader; close is independent of a waiting read.
 * workspace is an already leased OPFS DirectoryHandle. metadata.readAt may
 * return only validated same-resource metadata, never fetch arbitrary media.
 */
export function CreateCaptionPcmSource({job:Job,stage:Stage,bytes:Bytes,metadata:Metadata,workspace:Workspace,signal:ParentSignal}){
 const Controller=new AbortController(),Signal=AbortSignal.any([ParentSignal,Controller.signal].filter(Boolean));
 const ReturnJournal=Bytes.retain(),Seekable=Metadata?.access?.seekable===true;
 let Reader;try{Reader=Seekable?null:Bytes.stream({signal:Signal}).getReader();}catch(E){ReturnJournal();throw E;}
 let StreamOffset=0,StreamChunk=null,Token,Starting,Closing,OpenUnconfirmed=false,Released=false,Terminal=null,AfterEvent=0,ThroughFrame=0,PendingInput=null;
 let Origin=null,OriginRational=null,FirstSample=null,LastEnd=null,Epoch=0,Ordinal=0,WindowCount=0,Ring=[],RingBytes=0,EvidenceBytes=0,ObservedSamples=0;
 const Epochs=[];let Current=null,ResolveClock,RejectClock;
 const Clock=new Promise((A,B)=>{ResolveClock=A;RejectClock=B;});Clock.catch(()=>{});
 const Abort=()=>RejectClock(Signal.reason||new DOMException('Canceled','AbortError'));Signal.addEventListener('abort',Abort,{once:true});if(Signal.aborted)Abort();
 const MaxPcmBytes=Policy.maxPcmWindows*Policy.chunkSeconds*Policy.sampleRate*PCM_BYTES;
 async function Request(Action,Fields={}){Signal.throwIfAborted();const R=await Stage(Job,Action,{attempt:Job.captionAttempt||Job.captionSession?.attempt,...Fields});Signal.throwIfAborted();return R;}
 async function Start(){
  if(Starting)return Starting;
  Starting=(async()=>{
   const Access=Seekable?Metadata.access:{seekable:false,knownSize:null};
   if(Seekable&&(!Safe(Access.knownSize)||typeof Metadata.readAt!=='function'))throw Error('caption_source_identity');
   Signal.throwIfAborted();let R;
   const Fingerprint=await CaptionDigest(JSON.stringify(Bytes.snapshot().resourceIdentity??{}));
   for(;;){try{OpenUnconfirmed=true;R=await Stage(Job,'decoderOpen',{attempt:Job.captionAttempt||Job.captionSession?.attempt,sourceFingerprint:Fingerprint,access:Access,...(Metadata?.resample?{resample:Metadata.resample}:{})});break;}catch(E){
    if(!['caption_helper_missing','caption_native_failed','caption_prepare_failed'].includes(E.message))OpenUnconfirmed=false;
    if(E.message!=='caption_busy'&&E.message!=='caption_window_backpressure')throw E;await CaptionAbortableWait(Signal);
   }}
   Token=R.decoderToken;if(typeof Token!=='string')throw Error('caption_decoder_missing');OpenUnconfirmed=false;if(R.error)throw Error(R.cleanupError||R.error);Signal.throwIfAborted();return {decoderToken:Token};
  })();Starting.catch(RejectClock);return Starting;
 }
 async function Input(Requested){
  if(!Requested||typeof Requested.id!=='string'||!Safe(Requested.offset)||!Safe(Requested.length)||!Requested.length)throw Error('caption_worker_protocol');
  const Length=Math.min(Requested.length,Policy.uploadChunkBytes);let Data,Eof=false;
  if(!Seekable){
   if(Requested.offset!==StreamOffset)throw Error('caption_source_range');
   if(!StreamChunk?.length){const R=await Reader.read();Signal.throwIfAborted();if(R.done){if(!Bytes.sealed||StreamOffset!==Bytes.committedLength)throw Error('caption_source_sealed');Data=new Uint8Array();Eof=true;}else{if(!(R.value instanceof Uint8Array)||!R.value.length||R.value.length>Policy.uploadChunkBytes)throw Error('caption_source_budget');StreamChunk=R.value;}}
   if(!Data){Data=StreamChunk.subarray(0,Length);StreamChunk=StreamChunk.subarray(Data.length);StreamOffset+=Data.length;Eof=Bytes.sealed&&StreamOffset===Bytes.committedLength;}
  }else{
   for(;;){
    Signal.throwIfAborted();
    const CheckedRevision=Bytes.revision;
    if(Requested.offset<Bytes.committedLength){const End=Requested.offset+Math.min(Length,Bytes.committedLength-Requested.offset);Data=await Bytes.read(Requested.offset,End,{signal:Signal});Eof=Bytes.sealed&&End===Bytes.committedLength;break;}
    const Overlay=await Metadata.readAt(Requested.offset,Length,{signal:Signal});Signal.throwIfAborted();
    // A commit/seal during metadata lookup must re-enter the checked journal
    // branch; waiting on the newer revision would lose its notification.
    if(Bytes.revision!==CheckedRevision||Requested.offset<Bytes.committedLength)continue;
    if(Overlay?.data?.length){Data=Overlay.data instanceof Uint8Array?Overlay.data:new Uint8Array(Overlay.data);Eof=Overlay.eof===true;break;}
    if(Bytes.sealed){if(Requested.offset!==Bytes.committedLength)throw Error('caption_source_range');Data=new Uint8Array();Eof=true;break;}
    await Bytes.waitForChange(CheckedRevision,{signal:Signal});
   }
  }
  if(!(Data instanceof Uint8Array)||Data.length>Length||!Data.length&&!Eof||Seekable&&Eof&&Requested.offset+Data.length!==Metadata.access.knownSize)throw Error('caption_source_short_read');
  const R=await Request('decoderSupply',{decoderToken:Token,inputRequestId:Requested.id,offset:Requested.offset,data:Encode(Data),eof:Eof});
  if(R.acceptedBytes!==Data.length)throw Error('caption_source_short_read');
 }
 async function RetainFrame(F){
  if(F.sequence!==ThroughFrame+1||F.rate!==Policy.sampleRate||F.channels!==1||F.sampleFormat!=='s16'||F.byteOrder!=='little'||!Safe(F.samples)||!F.samples||F.bytes!==F.samples*PCM_BYTES||!Safe(F.bytes)||F.bytes>MaxPcmBytes)throw Error('caption_worker_protocol');
  const Data=Decode(F.data);if(Data.length!==F.bytes||await CaptionDigest(Data)!==F.sha256)throw Error('caption_window_checksum');
  const Pts={ticks:F.pts,timeBaseNum:F.timeBaseNum,timeBaseDen:F.timeBaseDen};const Seconds=CaptionRationalSeconds(Pts);
  if(Origin===null){OriginRational=Seconds<0?{...Pts}:{ticks:0,timeBaseNum:1,timeBaseDen:1};Origin=CaptionRationalSeconds(OriginRational);}
  const Start=CaptionRationalSample(Pts,OriginRational),End=Start+F.samples;
  if(!Safe(End)||LastEnd!==null&&Start<LastEnd)throw CaptionDecoderError({error:'caption_window_clock',sequence:F.sequence,pts:F.pts,timeBaseNum:F.timeBaseNum,timeBaseDen:F.timeBaseDen,samples:F.samples,startSample:Start,endSample:End,previousEndSample:LastEnd});
  if(!Current||Start!==LastEnd){
   if(Current){Current.closed=true;Epoch++;}
   if(Epochs.length>=Policy.maxWindows)throw Error('caption_result_limit');
   Current={epoch:Epoch,startSample:Start,endSample:End,cursor:Start,closed:false};Epochs.push(Current);
  }else Current.endSample=End;
  const Evidence={sequence:F.sequence,pts:F.pts,timeBaseNum:F.timeBaseNum,timeBaseDen:F.timeBaseDen,samples:F.samples,bytes:F.bytes,sha256:F.sha256,startSample:Start,endSample:End,epoch:Epoch};
  const MetadataBytes=new TextEncoder().encode(JSON.stringify(Evidence)).length;EvidenceBytes+=MetadataBytes;
  if(RingBytes+Data.length>MaxPcmBytes||EvidenceBytes>Policy.maxLedgerBytes)throw Error('caption_window_budget');
  ObservedSamples+=F.samples;if(!Safe(ObservedSamples))throw Error('caption_window_clock');
  Ring.push({...Evidence,data:Data,metadataBytes:MetadataBytes});RingBytes+=Data.length;LastEnd=End;FirstSample??=Start;ThroughFrame=F.sequence;ResolveClock({origin:Origin,sourceOriginRational:{...OriginRational}});
 }
 async function Pump(){
  await Start();
  if(PendingInput){const InputRequest=PendingInput;PendingInput=null;await Input(InputRequest);}
  const Page=await Request('decoderPoll',{decoderToken:Token,afterEvent:AfterEvent,maxEvents:Policy.resultPageItems,maxBytes:Policy.resultPageBytes});
  if(!Array.isArray(Page.events)||Page.events.length>Policy.resultPageItems)throw Error('caption_worker_protocol');
  let Cursor=AfterEvent;
  for(const E of Page.events){
   if(E.eventId!==Cursor+1)throw Error('caption_worker_protocol');Cursor=E.eventId;
   if(E.type==='pcm')await RetainFrame(E);
   else if(E.type==='input'){if(PendingInput)throw Error('caption_worker_protocol');PendingInput=E;}
   else if(E.type==='error')throw CaptionDecoderError(E);
   else if(E.type==='terminal'){
    if(E.error)throw CaptionDecoderError(E);
    if(!E.demuxEnded||!E.decoderFlushed||!E.resamplerFlushed||E.lastFrame!==ThroughFrame||E.outputFrames!==ThroughFrame||E.outputSamples!==ObservedSamples||E.outputBytes!==ObservedSamples*PCM_BYTES)throw Error('caption_worker_protocol');
    Terminal={...E};if(Current)Current.closed=true;
   }else if(E.type!=='opened')throw Error('caption_worker_protocol');
  }
  if(Page.nextEvent!==Cursor)throw Error('caption_worker_protocol');
  if(Cursor>AfterEvent){await Request('decoderAck',{decoderToken:Token,throughEvent:Cursor,throughFrame:ThroughFrame});AfterEvent=Cursor;}
  if(Terminal&&Token){const R=await Stage(Job,'decoderClose',{attempt:Job.captionAttempt||Job.captionSession?.attempt,decoderToken:Token});if(!R.closed)throw Error('caption_busy');Token=null;}
  if(Page.error&&!Terminal)throw Error(Page.error);
  if(!Page.events.length)await CaptionAbortableWait(Signal);
 }
 async function MakeWindow(E,CoreStart,CoreEnd,InputStart,InputEnd,Repair={},Preview=false){
  Signal.throwIfAborted();if(!Preview&&++WindowCount>Policy.maxWindows)throw Error('caption_window_limit');
  const Frames=InputEnd-InputStart,Size=WAV_BYTES+Frames*PCM_BYTES;
  if(!Safe(Frames)||!Frames||Size>Policy.maxWindowBytes||RingBytes+Size>MaxPcmBytes)throw Error('caption_window_budget');
  const Parts=[WavHeader(Frames)],Evidence=[];let Position=InputStart;
  for(const F of Ring){if(F.epoch!==E.epoch||F.endSample<=InputStart||F.startSample>=InputEnd)continue;
   const A=Math.max(InputStart,F.startSample),B=Math.min(InputEnd,F.endSample);if(A!==Position)throw Error('caption_window_clock');
   Parts.push(F.data.subarray((A-F.startSample)*PCM_BYTES,(B-F.startSample)*PCM_BYTES));const {data,metadataBytes,...Facts}=F;Evidence.push(Facts);Position=B;
  }
  if(Position!==InputEnd)throw Error('caption_window_clock');
  const Handle=await Workspace.getFileHandle(Preview?'caption-pcm-preview.wav':'caption-pcm-window.wav',{create:true}),Writer=await Handle.createWritable();
  try{for(const P of Parts){Signal.throwIfAborted();await Writer.write(P);}await Writer.close();}catch(E){await Writer.abort().catch(()=>{});throw E;}
  const File=await Handle.getFile();if(File.size!==Size)throw Error('caption_window_checksum');
  const First=Evidence[0],Last=Evidence.at(-1),SourceEvidence=[{kind:'pcm-frame-range',epoch:E.epoch,firstSequence:First.sequence,lastSequence:Last.sequence,frames:Evidence.length,
   samples:Evidence.reduce((N,F)=>N+F.samples,0),bytes:Evidence.reduce((N,F)=>N+F.bytes,0),startSample:First.startSample,endSample:Last.endSample,
   inputStartSample:InputStart,inputEndSample:InputEnd,inputSamples:Frames,firstPts:{ticks:First.pts,timeBaseNum:First.timeBaseNum,timeBaseDen:First.timeBaseDen},lastPts:{ticks:Last.pts,timeBaseNum:Last.timeBaseNum,timeBaseDen:Last.timeBaseDen},factsSha256:await CaptionDigest(JSON.stringify(Evidence))}];
  const Hash=await CaptionDigest(File),Descriptor={descriptorVersion:2,...(Preview?{purpose:'preview'}:{ordinal:Ordinal++}),epoch:E.epoch,codec:'pcm-s16le',container:'wav',profile:'pcm-s16-wav-16000-mono-v1',bytes:File.size,sha256:Hash,
   coreStartSample:CoreStart,coreEndSample:CoreEnd,inputStartSample:InputStart,inputEndSample:InputEnd,trimStartSamples:0,trimEndSamples:0,
   decode:{expectedFrames:Frames,trimStartSamples:0,trimEndSamples:0},sourceOrigin:{...OriginRational},sourceEvidence:SourceEvidence,...Repair};
  if(new TextEncoder().encode(JSON.stringify(Descriptor)).length>Policy.maxLedgerBytes)throw Error('caption_result_limit');
  const Value={id:await CaptionDigest(JSON.stringify(Descriptor)),...Descriptor};
  return Preview?{preview:ValidateCaptionPreview(Value),file:File}:{window:ValidateCaptionWindow(Value),file:File};
 }
 async function Next({onPreview:OnPreview}={}){
  try{
   await Start();
   for(;;){
    Signal.throwIfAborted();const E=Epochs.find(E=>E.cursor<E.endSample);
    if(E){
     const End=E.cursor+Policy.coreSeconds*Policy.sampleRate,Context=Policy.contextSeconds*Policy.sampleRate;
     if(E.closed||E.endSample>=End+Context){const ActualEnd=Math.min(End,E.endSample),Value=await MakeWindow(E,E.cursor,ActualEnd,Math.max(E.startSample,E.cursor-Context),Math.min(E.endSample,ActualEnd+Context));E.cursor=ActualEnd;return Value;}
     if(OnPreview&&E.endSample-Math.max(E.previewEnd??E.startSample,E.cursor)>=CaptionPreviewPolicy.intervalSamples){
      const Start=Math.max(E.cursor,E.startSample,E.endSample-CaptionPreviewPolicy.maxSamples);E.previewEnd=E.endSample;
      await OnPreview(await MakeWindow(E,Start,E.endSample,Start,E.endSample,{},true));
     }
    }
    if(Terminal){if(!FirstSample&&FirstSample!==0)throw Error('caption_no_audio');
     // Logical demux drain is not producer seal. Wait only for the producer;
     // never force unused trailer bytes through an already drained decoder.
     while(!Bytes.sealed)await Bytes.waitForChange(Bytes.revision,{signal:Signal});return null;
    }
    await Pump();
   }
  }catch(E){RejectClock(E);throw E;}
 }
 async function Release(){
  if(Released)return;Controller.abort(new DOMException('Caption decoder released','AbortError'));
  Closing??=(async()=>{
   try{await Starting;}catch{ /* Open may fail before obtaining a token. */ }
   if(Token){const R=await Stage(Job,'decoderClose',{attempt:Job.captionAttempt||Job.captionSession?.attempt,decoderToken:Token});if(!R.closed)throw Error('caption_busy');Token=null;}
   if(OpenUnconfirmed){await Stage(Job,'quiesce',{attempt:Job.captionAttempt||Job.captionSession?.attempt,controlRevision:Job.captionSession?.controlRevision??Job.captionStatus?.controlRevision??0});OpenUnconfirmed=false;}
   await Reader?.cancel().catch(()=>{});Reader?.releaseLock();StreamChunk=null;Ring=[];RingBytes=0;EvidenceBytes=0;await Metadata?.release?.();ReturnJournal();Signal.removeEventListener('abort',Abort);Released=true;
  })();
  try{await Closing;}catch(E){Closing=null;throw E;}
 }
 return {start:Start,next:Next,
  async repair(Boundary,ParentId,Attempt){
   const E=Epochs.find(E=>E.startSample<Boundary&&E.endSample>Boundary);if(!E)throw Error('caption_window_epoch');
   const Half=Policy.chunkSeconds*Policy.sampleRate/2,Context=Policy.contextSeconds*Policy.sampleRate,Shift=(Attempt-1)*Context,Start=Math.max(E.startSample,Boundary-Half+Shift),End=Math.min(E.endSample,Boundary+Half+Shift);
   return MakeWindow(E,Math.min(Boundary,Start+Context),Math.max(Boundary,End-Context),Start,End,{repairOf:ParentId,repairAttempt:Attempt});
  },
  releaseBefore(Sample){const Before=Sample-Policy.chunkSeconds*Policy.sampleRate/2;while(Ring.length&&Ring[0].endSample<=Before){const F=Ring.shift();RingBytes-=F.data.length;EvidenceBytes-=F.metadataBytes;}},
  timeline:()=>({sourceOrigin:Origin,sourceOriginRational:OriginRational&&{...OriginRational},spans:UnionCaptionSpans(Epochs.map(E=>({epoch:E.epoch,startSample:E.startSample,endSample:E.endSample}))),reason:Bytes.reason}),
  get clock(){return Clock;},get sourceOrigin(){return Origin;},get sourceOriginRational(){return OriginRational&&{...OriginRational};},get sourceStartSample(){return FirstSample;},get sourceEndSample(){return LastEnd??0;},get reason(){return Bytes.reason;},release:Release};
}
