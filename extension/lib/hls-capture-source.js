import {ALL_FORMATS,BlobSource,Input,EncodedPacketSink} from '../vendor/mediabunny-1.65.2.mjs';
import {RuntimePolicy} from './runtime-policy.js';
import {CaptionPolicy,CaptionDigest,CaptionSample} from './concurrent-captions-contract.js';
import {HlsRawTimestampOffset,HlsCaptureMapping,HlsCaptureTime,HlsPacketSampleBoundary} from './hls-capture-clock.js';
import {SelectCapturedSnapshot} from './hls-capture-selection.js';

/** Append-only metadata above closed OPFS files. Transfer never waits for a reader. */
export function CreateHlsCaptureSource({getFile,signal:ParentSignal}){
 const Controller=new AbortController(),Signal=ParentSignal?AbortSignal.any([ParentSignal,Controller.signal]):Controller.signal;
 const Tracks=new Map(),Committed=new Map(),Mappings=new Map(),References=new Map(),Readers=new Set(),Waiters=new Set();
 const Bounds=new Map(),SelectionListeners=new Set();
 let SelectionTask,SelectionDirty=false,SelectionError,Snapshot=null;
 let Configured=false,Sealed=false,Reason='eof',Failure,Selected,SelectedSets,Origin,OriginRational,OriginPromise,MetadataBytes=0,DescriptorCount=0,Released=false;
 const Wake=()=>{for(const F of [...Waiters])F();};
 const Check=S=>{S?.throwIfAborted();Signal.throwIfAborted();if(Failure)throw Failure;};
 function Wait(S){Check(S);return new Promise((Resolve,Reject)=>{
  const Done=()=>{Waiters.delete(Done);S?.removeEventListener('abort',Done);Signal.removeEventListener('abort',Done);try{Check(S);Resolve();}catch(E){Reject(E);}};
  Waiters.add(Done);S?.addEventListener('abort',Done,{once:true});Signal.addEventListener('abort',Done,{once:true});
 });}
 async function Ready(Path,S){while(!Committed.has(Path)){Check(S);if(Sealed)throw Error('stream_capture_uncommitted');await Wait(S);}Check(S);return getFile(Path);}
 function Definition(Type){const Values=[...Tracks.values()];return Type==='audio'?(Values.find(T=>T.audio)||Values[0]):Values.find(T=>!T.audio);}
 async function First(Track,D,S){for(;;){Check(S);const Found=Track?.descriptors.find(X=>D===undefined||X.discontinuitySequence===D);if(Found)return Found;if(Sealed||D!==undefined&&Track?.descriptors.some(X=>X.discontinuitySequence>D))throw Error('stream_capture_clock_reference');await Wait(S);}}
 async function Open(Descriptor,S,Owned){
  const Inputs=[],Add=I=>{Inputs.push(I);Owned?.add(I);return I;};
  const Dispose=()=>{for(const I of Inputs){Owned?.delete(I);I.dispose();}};S?.addEventListener('abort',Dispose,{once:true});
  const Make=(File,Init)=>{Check(S);return Add(new Input({formats:ALL_FORMATS,source:new BlobSource(File,{maxCacheSize:RuntimePolicy.Transfer.RemuxReadCacheBytes}),...(Init?{initInput:Init}:{})}));};
  try{
   let Init,InitHash,MetadataDescriptorId=null;
   if(Descriptor.initPath){const File=await Ready(Descriptor.initPath,S);if(File.size>CaptionPolicy.maxWindowBytes)throw Error('caption_window_budget');InitHash=await CaptionDigest(File);Init=Make(File);}
   else{
    // Retain the first finite TS metadata input for this discontinuity while
    // its dependent segment is open. No private SDK state is read or changed.
    const FirstDescriptor=await First(Tracks.get(Descriptor.trackId),Descriptor.discontinuitySequence,S);
    if(FirstDescriptor.id!==Descriptor.id){MetadataDescriptorId=FirstDescriptor.id;Init=Make(await Ready(FirstDescriptor.path,S));}
    InitHash=await CaptionDigest(Descriptor.initIdentity||'no-map');
   }
   const Media=Make(await Ready(Descriptor.path,S),Init),All=await Media.getTracks();Check(S);
   const Reference=await Media.getPrimaryVideoTrack()||All[0];if(!Reference)throw Error('stream_remux_no_packets');
   return {input:Media,container:(await Media.getFormat()).name,initHash:InitHash,metadataDescriptorId:MetadataDescriptorId,firstTimestamp:await Reference.getFirstTimestamp(),rawOffset:await HlsRawTimestampOffset(Media),
    close(){S?.removeEventListener('abort',Dispose);Dispose();}};
  }catch(E){S?.removeEventListener('abort',Dispose);Dispose();throw E;}
 }
 async function ReferenceOffset(D,S,ClosedOnly=false){
  if(References.has(D))return References.get(D);
  const Video=Definition('video'),Ref=Video||Definition('audio');let Index=0;
  for(;;){
   if(!ClosedOnly)await First(Ref,D,S);const List=Ref.descriptors.filter(X=>X.discontinuitySequence===D);
   if(Index>=List.length){if(ClosedOnly)return null;if(Sealed||Ref.descriptors.some(X=>X.discontinuitySequence>D))throw Error('stream_capture_clock_reference');await Wait(S);continue;}
   const Desc=List[Index++];if(ClosedOnly&&!Closed(Desc))return null;const Opened=await Open(Desc,S);
   try{const Track=Video?await Opened.input.getPrimaryVideoTrack():await Opened.input.getPrimaryAudioTrack();if(!Track)continue;
    const Pref=await Track.getFirstTimestamp(),Value=Desc.playlistStart-((Opened.rawOffset??0)+Pref);Check(S);if(!Number.isFinite(Value))throw Error('caption_window_clock');
    const Evidence=Object.freeze({descriptorId:Desc.id,d:D,Lref:Desc.playlistStart,Pref,Rref:Opened.rawOffset,offset:Value});References.set(D,Evidence);return Evidence;
   }finally{Opened.close();}
  }
 }
 async function ReadMapping(Desc,Opened,Track,S,ClosedOnly=false){
  const Config=await Track.getDecoderConfig(),Resolution=await Track.getTimeResolution(),Key=Desc.id+':'+Track.type;
  const Reference=await ReferenceOffset(Desc.discontinuitySequence,S,ClosedOnly);if(!Reference)return null;
  const Value=await HlsCaptureMapping(Desc,{...Opened,referenceOffset:Reference.offset,referenceEvidence:Reference,resolution:Resolution,config:Config});
  const Previous=Mappings.get(Key);if(Previous&&Previous.mappingId!==Value.mappingId)throw Error('stream_capture_clock_conflict');
  if(!Previous){MetadataBytes+=JSON.stringify(Value).length;if(MetadataBytes>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');Mappings.set(Key,Value);}
  return {mapping:Previous||Value,config:Config};
 }
 function Closed(D){return Committed.has(D.path)&&(!D.initPath||Committed.has(D.initPath));}
 async function Measure(D,Type){
  // This task never waits for future reference bytes, sourceOrigin or ASR.
  // Missing closed reference metadata simply leaves this prefix unready.
  if(!await ReferenceOffset(D.discontinuitySequence,Signal,true))return null;
  const Opened=await Open(D,Signal);
  try{
   const Track=Type==='audio'?await Opened.input.getPrimaryAudioTrack():await Opened.input.getPrimaryVideoTrack();
   if(!Track)throw Error('stream_capture_track_missing');
   const Meta=await ReadMapping(D,Opened,Track,Signal,true);if(!Meta)return null;
   const Sink=new EncodedPacketSink(Track);let Start=Infinity,End=-Infinity,Packets=0;
   for(let P=await Sink.getFirstPacket();P;P=await Sink.getNextPacket(P)){
    Check(Signal);const A=HlsCaptureTime(P.timestamp,Meta.mapping),B=A+P.duration;
    if(!Number.isFinite(B)||B<=A)throw Error('caption_window_clock');
    Start=Math.min(Start,A);End=Math.max(End,B);Packets++;
   }
   if(!Packets)throw Error('stream_remux_no_packets');
   return Object.freeze({start:Start,end:End,mappingId:Meta.mapping.mappingId,packets:Packets});
  }finally{Opened.close();}
 }
 function ScheduleSelection(){
  if(Released||SelectionError||!Configured)return;SelectionDirty=true;if(SelectionTask)return;
  SelectionTask=Promise.resolve().then(async()=>{
   try{while(SelectionDirty){
    SelectionDirty=false;Check(Signal);
    let Advanced;
    do{Advanced=false;for(const T of Tracks.values()){
      const I=T.measured||0,D=T.descriptors[I];if(!D||!Closed(D))continue;
      const Value=await Measure(D,T.audio?'audio':'video');if(!Value)continue;
      MetadataBytes+=new TextEncoder().encode(JSON.stringify(Value)).length;if(MetadataBytes>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');
      Bounds.set(D.id,Value);T.measured=I+1;Advanced=true;
    }
    const Next=SelectCapturedSnapshot([...Tracks.values()],Committed,Bounds,Api.audioShift);
    if(Next&&(!Snapshot||Next.progress.count!==Snapshot.progress.count)){
     Snapshot=Next;for(const Notify of SelectionListeners)Notify();
    }
    }while(Advanced);
   }}catch(E){SelectionError=E;}
   finally{SelectionTask=null;}
  });
 }
 async function SourceOrigin(S){
  if(Origin!==undefined)return Origin;
  if(!OriginPromise)OriginPromise=(async()=>{
   while(!Configured)await Wait(Signal);
   const T=Definition('audio');let Index=0;
   for(;;){
    if(Index>=T.descriptors.length){if(!Sealed){await Wait(Signal);continue;}
     // Video-only final output still has a real reference; the caption reader
     // independently reports no audio after exhausting this same selection.
     const Desc=await First(Definition('video'),undefined,Signal),Opened=await Open(Desc,Signal);
     try{const V=await Opened.input.getPrimaryVideoTrack(),{mapping}=await ReadMapping(Desc,Opened,V,Signal);Origin=Math.min(0,HlsCaptureTime(await V.getFirstTimestamp(),mapping));OriginRational={ticks:Math.round(Origin*mapping.resolution),timeBaseNum:1,timeBaseDen:mapping.resolution};return Origin;}finally{Opened.close();}
    }
    const Desc=T.descriptors[Index++],Opened=await Open(Desc,Signal);
    try{const Audio=await Opened.input.getPrimaryAudioTrack();if(!Audio)continue;const {mapping}=await ReadMapping(Desc,Opened,Audio,Signal),P=await new EncodedPacketSink(Audio).getFirstPacket();if(!P)continue;
     Origin=Math.min(0,HlsCaptureTime(P.timestamp,mapping));OriginRational={ticks:Math.round(Origin*mapping.resolution),timeBaseNum:1,timeBaseDen:mapping.resolution};return Origin;
    }finally{Opened.close();}
   }
  })();
  // A reader's cancellation must settle even if the shared origin is waiting.
  return new Promise((Resolve,Reject)=>{const Abort=()=>Reject(S.reason);S?.addEventListener('abort',Abort,{once:true});OriginPromise.then(Resolve,Reject).finally(()=>S?.removeEventListener('abort',Abort));if(S?.aborted)Abort();});
 }
 function Reader({trackId,type,signal},Selection){
  if(Readers.size>=CaptionPolicy.maxQueuedWindows)throw Error('caption_window_budget');
  const Local=new AbortController(),S=signal?AbortSignal.any([signal,Local.signal,Signal]):AbortSignal.any([Local.signal,Signal]);
  let Index=0,Opened,Desc,Track,Sink,Packet,Meta,Pending,Epoch=0,LastEnd=null,LastClock,LastConfig,LastDiscontinuity,Done=false;const Owned=new Set();
  const Close=()=>{Opened?.close();Opened=null;for(const I of Owned)I.dispose();Owned.clear();};
  S.addEventListener('abort',Close,{once:true});
  const Value={
   async next(){
    Check(S);if(Done)return {kind:'eof',reason:Reason,selectedIds:Selection?.[trackId]||Selected?.[trackId]};if(Pending){const P=Pending;Pending=null;if(!Selection&&Sealed&&!SelectedSets.get(trackId).has(P.descriptorId)){Close();Done=true;return {kind:'eof',reason:Reason,selectedIds:Selected[trackId]};}return P;}
    while(!Configured)await Wait(S);const T=trackId?Tracks.get(trackId):Definition(type);if(!T){Done=true;return {kind:'eof',reason:Reason};}trackId=T.id;
    for(;;){
     if(!Selection&&Sealed&&Opened&&!SelectedSets.get(trackId).has(Desc.id)){Close();Done=true;return {kind:'eof',reason:Reason,selectedIds:Selected[trackId]};}
     if(!Opened){
      const Ids=Selection?.[trackId]||Selected?.[trackId],Length=Ids?Ids.length:T.descriptors.length;
      if(Index>=Length){if(Selection||Sealed){Done=true;return {kind:'eof',reason:Reason,selectedIds:Ids};}await Wait(S);continue;}
      Desc=Ids?T.byId.get(Ids[Index++]):T.descriptors[Index++];
      try{Opened=await Open(Desc,S,Owned);}catch(E){if(!Selection&&Sealed&&!SelectedSets.get(trackId).has(Desc.id)){Done=true;return {kind:'eof',reason:Reason,selectedIds:Selected[trackId]};}throw E;}
      Track=type==='video'?await Opened.input.getPrimaryVideoTrack():await Opened.input.getPrimaryAudioTrack();
      if(!Track){Close();if(type==='audio'&&!T.audio)continue;throw Error('stream_capture_track_missing');}
      Meta=await ReadMapping(Desc,Opened,Track,S);Sink=new EncodedPacketSink(Track);Packet=await Sink.getFirstPacket();
     }else Packet=await Sink.getNextPacket(Packet);
     Check(S);if(!Selection&&Sealed&&!SelectedSets.get(trackId).has(Desc.id)){Close();Done=true;return {kind:'eof',reason:Reason,selectedIds:Selected[trackId]};}if(!Packet){Close();continue;}
     const Timestamp=HlsCaptureTime(Packet.timestamp,Meta.mapping),EndTime=HlsCaptureTime(Packet.timestamp+Packet.duration,Meta.mapping),O=type==='audio'?await SourceOrigin(S):Origin;
     // Video-only snapshot readers need no provisional caption origin. Their
     // final mux consumes captureTimestamp; processing samples belong to audio.
     const Codec=await Track.getCodec(),Samples=type==='audio'?HlsPacketSampleBoundary({timestamp:Timestamp,endTimestamp:EndTime,origin:O,mapping:Meta.mapping,sourceSampleRate:Meta.config.sampleRate,codec:Codec,container:Opened.container,previous:LastClock}):null;
     const Start=Samples?.startSample??(O===undefined?null:CaptionSample(Timestamp-O)),End=Samples?.endSample??(O===undefined?null:CaptionSample(EndTime-O));
     if(EndTime<=Timestamp||type==='audio'&&(End<=Start||Start<0))throw Error('caption_window_clock');
     let Boundary;
     if(type==='audio'&&LastEnd!==null){
      if(Start<LastEnd)throw Error('stream_capture_clock_overlap');
      if(Start>LastEnd||LastConfig!==Meta.mapping.configHash||LastDiscontinuity!==Desc.discontinuitySequence){Epoch++;Boundary={kind:'boundary',epoch:Epoch,reason:Start>LastEnd?'gap':LastConfig!==Meta.mapping.configHash?'config':'discontinuity',previousEndSample:LastEnd,nextStartSample:Start,mappingId:Meta.mapping.mappingId};}
     }
     const Event={kind:'packet',packet:Packet,codec:Codec,descriptorId:Desc.id,sourceSequence:Desc.sourceSequence,path:Desc.path,epoch:Epoch,config:Meta.config,configHash:Meta.mapping.configHash,initHash:Opened.initHash,timeResolution:Meta.mapping.resolution,sdkTimestamp:Packet.timestamp,captureTimestamp:Timestamp,startSample:Start,endSample:End,...(Samples?.correctionSamples?{sampleBoundaryCorrection:{samples:Samples.correctionSamples,rawStartSample:Start-Samples.correctionSamples,previousEndSample:LastClock.endSample,previousEndTime:LastClock.endTime,delta:LastClock.endTime-Timestamp,sourceSampleRate:Meta.config.sampleRate,resolution:Meta.mapping.resolution,previousDescriptorId:LastClock.descriptorId}}:{}),mappingId:Meta.mapping.mappingId,evidence:Meta.mapping};
     LastEnd=End;LastClock=type==='audio'?{endSample:End,endTime:EndTime,resolution:Meta.mapping.resolution,sourceSampleRate:Meta.config.sampleRate,descriptorId:Desc.id,configHash:Meta.mapping.configHash,discontinuitySequence:Desc.discontinuitySequence}:null;LastConfig=Meta.mapping.configHash;LastDiscontinuity=Desc.discontinuitySequence;if(Boundary){Pending=Event;return Boundary;}return Event;
    }
   },
   release(){if(Done&&Local.signal.aborted)return;Done=true;Local.abort(new DOMException('Canceled','AbortError'));Close();Readers.delete(Value);},
  };Readers.add(Value);return Value;
 }
 const Api={
  configure(Definitions){if(Configured)throw Error('stream_capture_state');for(const [I,D]of Definitions.entries()){const Id=D.id||'track-'+I;Tracks.set(Id,{...D,id:Id,descriptors:[],byId:new Map()});}Configured=true;Wake();},
  append(TrackId,Descriptors){if(Sealed||!Configured)throw Error('stream_capture_state');const T=Tracks.get(TrackId);if(!T)throw Error('stream_capture_track_missing');
   for(const D of Descriptors){if(T.byId.has(D.id)){if(JSON.stringify(T.byId.get(D.id))!==JSON.stringify(D))throw Error('stream_capture_identity');continue;}
    const Previous=T.descriptors.at(-1);
    if(!D.resourceIdentity||D.trackId!==TrackId||D.ordinal!==T.descriptors.length||!Number.isSafeInteger(D.sourceSequence)||D.sourceSequence<0||!Number.isSafeInteger(D.discontinuitySequence)||D.discontinuitySequence<0||!Number.isFinite(D.playlistStart)||D.playlistStart<0||!Number.isFinite(D.duration)||D.duration<=0||Previous&&(D.sourceSequence!==Previous.sourceSequence+1||D.discontinuitySequence<Previous.discontinuitySequence||D.playlistStart!==Previous.playlistStart+Previous.duration))throw Error('stream_capture_identity');
    MetadataBytes+=new TextEncoder().encode(JSON.stringify(D)).length;if(++DescriptorCount>RuntimePolicy.Transfer.MaxSegments||MetadataBytes>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');
    const Copy=Object.freeze({...D});T.descriptors.push(Copy);T.byId.set(D.id,Copy);
   }Wake();ScheduleSelection();},
  commit(Path,Bytes){if(!Number.isSafeInteger(Bytes)||Bytes<0)throw Error('stream_capture_identity');if(Committed.has(Path)&&Committed.get(Path)!==Bytes)throw Error('stream_capture_identity');Committed.set(Path,Bytes);Wake();ScheduleSelection();},
  snapshot(){return Snapshot;},
  observeSelection(Notify){SelectionListeners.add(Notify);return ()=>SelectionListeners.delete(Notify);},
  async selectCommitted(){
   // Called after transfer workers drain. It waits only for closed-packet
   // measurement; the caption/inference cursor has no role in this barrier.
   Check(Signal);ScheduleSelection();while(SelectionTask)await SelectionTask;
   if(SelectionError)throw SelectionError;return Snapshot;
  },
  freezeSelection(Selection){const Copy={};for(const [Id,T]of Tracks){const Ids=Selection[Id];if(!Array.isArray(Ids)||!Ids.length||new Set(Ids).size!==Ids.length)throw Error('stream_capture_selection');let Last=-1;
    Copy[Id]=Object.freeze(Ids.map(Key=>{const D=T.byId.get(Key);if(!D||D.ordinal<=Last||!Committed.has(D.path)||D.initPath&&!Committed.has(D.initPath))throw Error('stream_capture_selection');Last=D.ordinal;return Key;}));}
   Object.freeze(Copy);const LocalReaders=new Set();let Closed=false;
   return {selectedByTrack:Copy,get sourceOrigin(){return Origin;},get sourceOriginRational(){return OriginRational;},get reason(){return Reason;},get audioShift(){return Api.audioShift;},get shiftApplied(){return false;},reader(Options){if(Closed)throw Error('stream_capture_released');const R=Reader(Options,Copy);LocalReaders.add(R);return R;},release(){Closed=true;for(const R of LocalReaders)R.release();LocalReaders.clear();}};
  },
  seal({reason='eof',selectedByTrack}){if(Sealed)throw Error('stream_capture_state');const View=Api.freezeSelection(selectedByTrack);Selected=View.selectedByTrack;SelectedSets=new Map(Object.entries(Selected).map(([Id,Ids])=>[Id,new Set(Ids)]));View.release();Reason=reason;Sealed=true;Wake();},
  fail(E){Failure=E;Wake();},reader:Options=>Reader(Options),
  get sourceOrigin(){return Origin;},get sourceOriginRational(){return OriginRational;},get audioShift(){const V=Definition('video'),A=Definition('audio');return (V?.presentationTimeOffset||0)-(A?.presentationTimeOffset||0);},get shiftApplied(){return false;},get reason(){return Reason;},
  async release(){if(!Released){Released=true;Controller.abort(new DOMException('Canceled','AbortError'));for(const R of [...Readers])R.release();SelectionListeners.clear();Wake();}await SelectionTask;},
 };return Api;
}
