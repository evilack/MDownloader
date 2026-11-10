import {EncodedAudioPacketSource,Mp4OutputFormat,Output,StreamTarget} from '../vendor/mediabunny-1.65.2.mjs';
import {CaptionPolicy,CaptionDigest,ValidateCaptionWindow,UploadCaptionBytes} from './concurrent-captions-contract.js';
import {UnionCaptionSpans} from './caption-timeline.js';
import {CaptionPreviewPolicy,ValidateCaptionPreview} from './caption-preview.js';

/** Bounded AAC packet context over a live committed capture, never a finite manifest. */
export function CreateCaptionWindowSource({capture,createWindowFile,signal:ParentSignal}){
 const Controller=new AbortController(),Signal=AbortSignal.any([ParentSignal,Controller.signal]);
 const Reader=capture.reader({type:'audio',signal:Signal});
 let Request,Ring=[],RingBytes=0,Epoch=null,EpochStart=null,End=0,PacketEnd=0,TerminalEnd=null,TerminalPackets=null,Cursor=null,Ordinal=0,Ended=false,Boundary=false,Pending=null,Released=false,PreparingToken;
 let ResolveClock,RejectClock;const Clock=new Promise((A,B)=>{ResolveClock=A;RejectClock=B;});Clock.catch(()=>{});
 const Spans=[],Terminals=[];
 let ActiveCandidate,ActiveOutput,ActiveWriter,Releasing,PreviewEnd=null;
 const Check=()=>Signal.throwIfAborted();
 function Add(P){
  if(P.codec!=='aac')throw Error('caption_window_codec');
  if(P.packet.byteLength+RingBytes>CaptionPolicy.maxWindowBytes)throw Error('caption_window_budget');
  if(!P.config||!Number.isSafeInteger(P.config.sampleRate)||P.config.sampleRate<=0)throw Error('caption_window_config');
  Ring.push(P);RingBytes+=P.packet.byteLength;Epoch=P.epoch;EpochStart??=P.startSample;Cursor??=P.startSample;PacketEnd=End=P.endSample;
  ResolveClock({origin:capture.sourceOrigin});
 }
 async function Read(){
  Check();const E=await Reader.next();Check();
  if(E.kind==='eof'){Ended=true;Boundary=true;return;}
  if(E.kind==='boundary'){Boundary=true;return;}
  if(E.kind!=='packet')throw Error('caption_window_clock');
  if(Epoch!==null&&E.epoch!==Epoch){Pending=E;Boundary=true;return;}
  Add(E);
 }
 async function Fill(Target,OnPreview){while(!Boundary&&(!Ring.length||Ring.at(-1).startSample<Target)){
  await Read();
  // Guard packet must already exist; once final support is present, final wins.
  if(OnPreview&&!Boundary&&Ring.at(-1)?.startSample<Target){
   const Supported=Ring.at(-2)?.endSample;
   if(Supported!==undefined&&Supported-Math.max(PreviewEnd??EpochStart,Cursor)>=CaptionPreviewPolicy.intervalSamples){
    const Start=Math.max(Cursor,EpochStart,Supported-CaptionPreviewPolicy.maxSamples);
    let V;try{V=await Window(Start,Supported,Start,Supported,undefined,true);}catch(E){if(E.message!=='caption_window_backpressure')throw E;PreviewEnd=Supported;}
    if(V){PreviewEnd=V.preview.inputEndSample;await OnPreview(V);}
   }
  }
 }}
 async function Advance(){
  if(!Boundary||Cursor<End)return;
  if(Ended)return;
  // Repairs for the previous core have completed before next() is called.
  Ring=[];RingBytes=0;EpochStart=null;Epoch=null;Cursor=null;Boundary=false;TerminalEnd=null;TerminalPackets=null;PreviewEnd=null;
  if(Pending){const P=Pending;Pending=null;Add(P);}else await Read();
 }
 async function WriteCandidate(Packets){
  Check();const Handle=await createWindowFile();Check();const Writer=await Handle.createWritable();ActiveWriter=Writer;
  if(Signal.aborted){await Writer.abort().catch(()=>{});Check();}let Size=0;
  const Target=new WritableStream({async write(C){Size=Math.max(Size,C.position+C.data.byteLength);if(Size+RingBytes>CaptionPolicy.maxWindowBytes)throw Error('caption_window_budget');await Writer.write(C);},close:()=>Writer.close(),abort:E=>Writer.abort(E)});
  const Media=new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(Target,{chunked:true,chunkSize:CaptionPolicy.uploadChunkBytes})}),Audio=new EncodedAudioPacketSource('aac');ActiveOutput=Media;Media.addAudioTrack(Audio);
  try{await Media.start();for(const [I,P]of Packets.entries()){Check();await Audio.add(P.packet.clone({timestamp:P.captureTimestamp-Packets[0].captureTimestamp}),I?undefined:{decoderConfig:P.config});}Audio.close();await Media.finalize();}
  catch(E){await Media.cancel().catch(()=>{});await Writer.abort().catch(()=>{});throw E;}
  const File=await Handle.getFile();return {file:File,hash:await CaptionDigest(File)};
 }
 async function Candidate(Packets){const Task=WriteCandidate(Packets);ActiveCandidate=Task;try{return await Task;}finally{ActiveCandidate=null;ActiveOutput=null;ActiveWriter=null;}}
 async function Window(CoreStart,CoreEnd,InputStart,InputEnd,Repair,Preview=false){
  if(!Request)throw Error('caption_state');Check();
  const ContextPackets=Ring.filter(P=>P.endSample>InputStart&&P.startSample<InputEnd),Last=ContextPackets.at(-1);
  if(!Last||ContextPackets[0].startSample>InputStart||Last.endSample<InputEnd)throw Error('caption_window_clock');
  const At=Ring.indexOf(Last),Guard=Ring[At+1],Terminal=Boundary&&InputEnd===End&&!Guard;
  const Packets=Terminal&&TerminalPackets?TerminalPackets:Guard?[...ContextPackets,Guard]:ContextPackets;
  if(!Guard&&!Boundary)throw Error('caption_window_guard');
  const PhysicalSeconds=Packets.reduce((N,P)=>N+P.packet.duration,0);
  if(PhysicalSeconds>CaptionPolicy.chunkSeconds+2*CaptionPolicy.contextSeconds)throw Error('caption_window_budget');
  const {file:File,hash:Hash}=await Candidate(Packets),Begin=await Request('prepareEncodedBegin',{bytes:File.size,sha256:Hash,...Repair,...(Preview?{purpose:'preview'}:{})});PreparingToken=Begin.prepareToken;
  if(!Number.isSafeInteger(Begin.offset)||Begin.offset<0||Begin.offset>File.size)throw Error('caption_upload_order');
  if(Begin.offset<File.size)await UploadCaptionBytes(File.slice(Begin.offset),async F=>{const R=await Request('prepareEncodedAppend',{prepareToken:PreparingToken,...F,offset:Begin.offset+F.offset});return {...R,offset:R.offset-Begin.offset};},Signal);
  const Facts=await Request('prepareEncodedSeal',{prepareToken:PreparingToken});
  if(Facts.prepareToken!==PreparingToken||Facts.inputSha256!==Hash||Facts.rate!==CaptionPolicy.sampleRate||Facts.channels!==1||Facts.sampleFormat!=='s16'||!Number.isSafeInteger(Facts.decodedFrames)||Facts.decodedFrames<1||!/^[a-f0-9]{64}$/.test(Facts.factsSha256||''))throw Error('caption_window_clock');
  // B=Q(p0-origin) assigns local decoded sample zero to the ONE global grid.
  // N is measured by decode; packet durations are never a decoded-count oracle.
  const Base=Packets[0].startSample,N=Facts.decodedFrames,PhysicalEnd=Base+N;
  if(Preview){
   InputEnd=CoreEnd=Math.min(InputEnd,PhysicalEnd);InputStart=CoreStart=Math.max(InputStart,Base);
   if(InputEnd-Math.max(PreviewEnd??EpochStart,Cursor)<CaptionPreviewPolicy.intervalSamples||InputEnd<=InputStart){await Request('prepareEncodedRelease',{prepareToken:PreparingToken});PreparingToken=null;return null;}
  }
  if(Terminal&&!Preview){
   const SupportedEnd=TerminalEnd??Math.min(PacketEnd,PhysicalEnd);
   if(SupportedEnd>PhysicalEnd)throw Error('caption_window_clock');
   if(SupportedEnd<Cursor||SupportedEnd<CoreStart)throw Error('caption_window_clock');
   InputEnd=Math.min(InputEnd,SupportedEnd);CoreEnd=Math.min(CoreEnd,SupportedEnd);
   const Fact={epoch:Epoch,packetEndSample:PacketEnd,physicalEndSample:PhysicalEnd,captionEndSample:SupportedEnd,factsSha256:Facts.factsSha256};
   if(!Repair){if(TerminalEnd===null)Terminals.push(Fact);TerminalEnd=End=SupportedEnd;TerminalPackets=Packets;}
  }
  if(InputStart<Base||InputEnd>PhysicalEnd)throw Error('caption_window_guard');
  if(CoreEnd===CoreStart&&Terminal&&!Repair){await Request('prepareEncodedRelease',{prepareToken:PreparingToken});PreparingToken=null;return null;}
  if(CoreEnd<=CoreStart||InputEnd<CoreEnd)throw Error('caption_window_clock');
  const Before=InputStart-Base,After=N-Before-(InputEnd-InputStart),First=Packets[0];
  const Evidence=Packets.reduce((Out,P)=>{if(Out.at(-1)?.descriptorId!==P.descriptorId)Out.push({kind:'hls-segment',descriptorId:P.descriptorId,path:P.path,sourceSequence:P.sourceSequence,epoch:P.epoch,...P.evidence});return Out;},[]);
  Evidence.push({kind:'prepared-aac',localZeroSample:Base,decodedFrames:N,factsSha256:Facts.factsSha256,inputSha256:Hash,terminal:Terminal,packetEndSample:PacketEnd,physicalEndSample:PhysicalEnd});
  const Value={descriptorVersion:2,...(Preview?{purpose:'preview'}:{ordinal:Ordinal++}),epoch:Epoch,codec:'aac',container:'m4a',profile:'aac-prepared-pcm-v1',bytes:File.size,sha256:Hash,configHash:First.configHash,initHash:First.initHash,
   coreStartSample:CoreStart,coreEndSample:CoreEnd,inputStartSample:InputStart,inputEndSample:InputEnd,trimStartSamples:Before,trimEndSamples:After,
   decode:{expectedFrames:N,trimStartSamples:Before,trimEndSamples:After},preparationFactsSha256:Facts.factsSha256,sourceEvidence:Evidence,
   sourceOrigin:capture.sourceOriginRational,sourceTimeBase:{num:1,den:First.timeResolution,normalizedOriginSeconds:capture.sourceOrigin},...Repair};
  const Descriptor={...Value,id:await CaptionDigest(JSON.stringify(Value))},Validated=Preview?ValidateCaptionPreview(Descriptor):ValidateCaptionWindow(Descriptor),Token=PreparingToken;PreparingToken=null;
  return {...(Preview?{preview:Validated}:{window:Validated}),file:File,prepareToken:Token};
 }
 return {
  bindPreparation(F){if(Request)throw Error('caption_state');Request=F;},
  async next({onPreview:OnPreview}={}){try{
   await Advance();if(Ended&&Cursor!==null&&Cursor>=End)return null;
   if(Cursor===null)await Fill(0);if(Cursor===null)throw Error('caption_no_audio');
   const Context=CaptionPolicy.contextSeconds*CaptionPolicy.sampleRate,NormalEnd=Cursor+CaptionPolicy.coreSeconds*CaptionPolicy.sampleRate;
   await Fill(NormalEnd+Context,OnPreview);
   const CoreEnd=Math.min(NormalEnd,End),InputEnd=Math.min(CoreEnd+Context,End),InputStart=Math.max(EpochStart,Cursor-Context);
   if(CoreEnd<=Cursor){await Advance();return Ended?null:this.next({onPreview:OnPreview});}
   const V=await Window(Cursor,CoreEnd,InputStart,InputEnd);
   if(!V){await Advance();return Ended?null:this.next({onPreview:OnPreview});}
   Cursor=V.window.coreEndSample;Spans.push({epoch:Epoch,startSample:V.window.coreStartSample,endSample:Cursor});if(Spans.length>CaptionPolicy.maxWindows)throw Error('caption_window_limit');return V;
  }catch(E){RejectClock(E);throw E;}},
  async repair(BoundarySample,ParentId,Attempt){
   const Half=CaptionPolicy.chunkSeconds*CaptionPolicy.sampleRate/2,Context=CaptionPolicy.contextSeconds*CaptionPolicy.sampleRate;
   const Start=Math.max(EpochStart,BoundarySample-Half),Finish=Math.min(End,BoundarySample+Half);
   return Window(Math.min(BoundarySample,Start+Context),Math.max(BoundarySample,Finish-Context),Start,Finish,{repairOf:ParentId,repairAttempt:Attempt});
  },
  releaseBefore(Sample){if(TerminalPackets)return;const Before=Sample-CaptionPolicy.chunkSeconds*CaptionPolicy.sampleRate/2;while(Ring.length&&Ring[0].endSample<=Before)RingBytes-=Ring.shift().packet.byteLength;},
  timeline(){return {spans:UnionCaptionSpans(Spans),sourceOrigin:capture.sourceOrigin,sourceOriginRational:capture.sourceOriginRational,reason:capture.reason,terminalSupport:Terminals};},
  get sourceOrigin(){return capture.sourceOrigin;},get sourceEndSample(){return Cursor||0;},get clock(){return Clock;},get reason(){return capture.reason;},
  release(){if(Releasing)return Releasing;Released=true;Controller.abort(new DOMException('Canceled','AbortError'));Reader.release();
   Releasing=(async()=>{const Task=ActiveCandidate;await ActiveOutput?.cancel().catch(()=>{});await ActiveWriter?.abort().catch(()=>{});await Task?.catch(()=>{});
    Ring=[];RingBytes=0;TerminalPackets=null;RejectClock(Signal.reason);})();return Releasing;},
 };
}
