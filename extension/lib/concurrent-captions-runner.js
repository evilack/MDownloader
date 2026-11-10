import {CaptionPolicy,CaptionModes,SelectConcurrentCaptionMode,CaptionAbortableWait,CaptionSample,CaptionDigest,UploadCaptionBytes,ValidateCaptionWindow} from './concurrent-captions-contract.js';
import {CreateCaptionWindowMerger} from './caption-window-merge.js';
import {CaptionFinalTimeline,UnionCaptionSpans,CaptionCovers} from './caption-timeline.js';
import {CaptionOutputSession} from './caption-output-session.js';
import {BuildLiveCaptionSnapshot,ComposeLiveCaptionView} from './live-caption-output.js';
import {ValidateCaptionPreview} from './caption-preview.js';

const TimelineFailures=new Set(['caption_window_clock','caption_window_codec','caption_window_epoch','caption_window_config','caption_window_budget','caption_seam_unresolved']);
const MayFallback=(E,ErrorValue)=>!E.source?.timeline&&TimelineFailures.has(ErrorValue.message);
export function CreateConcurrentCaptionRunner({stage:Stage}){
 const Entries=new Map();
 function Entry(Job,Signal){
  let Value=Entries.get(Job.requestId);if(Value){Job.captionSession=Value.transport;return Value;}
  const Controller=new AbortController(),Transport=Job.captionSession||{attempt:Job.captionAttempt||Job.captionStatus?.attempt,controlRevision:Job.captionStatus?.controlRevision||0};Value={job:Job,optionsKey:JSON.stringify(Job.localCaptions),controller:Controller,signal:Controller.signal,mode:CaptionModes.postprocess,attempt:Transport.attempt,cursor:0,credit:0,transport:Transport};Job.captionSession=Transport;
  const Abort=()=>{Controller.abort(Signal?.reason||new DOMException('Canceled','AbortError'));if(Value.nativeFailure&&Signal?.reason?.name!=='AbortError')void Fail(Job.requestId,Value.attempt,Value.nativeFailure).catch(()=>{});else void Cancel(Job.requestId).catch(()=>{});};
  Signal?.addEventListener('abort',Abort,{once:true});Value.detach=()=>Signal?.removeEventListener('abort',Abort);Entries.set(Job.requestId,Value);if(Signal?.aborted)Abort();return Value;
 }
 async function Request(E,Action,Fields={}){E.signal.throwIfAborted();const Result=await Stage(E.job,Action,{...(E.attempt?{attempt:E.attempt}:{}),controlRevision:E.transport.controlRevision||0,...Fields});E.signal.throwIfAborted();if(Result?.attempt!==undefined&&Result.attempt!==E.attempt)throw Error('caption_stale_attempt');return Result;}
 async function Busy(E,Action,Fields){for(;;){try{return await Request(E,Action,Fields);}catch(ErrorValue){if(ErrorValue.message!=='caption_busy'&&ErrorValue.message!=='caption_window_backpressure')throw ErrorValue;await CaptionAbortableWait(E.signal);}}}
 async function Attempt(E,Reason){
  E.signal.throwIfAborted();E.pendingAttempt=(E.attempt||0)+1;
  try{
   const Result=await Stage(E.job,'beginAttempt',{previousAttempt:E.attempt||0,controlRevision:E.transport.controlRevision||0,...(Reason?{fallbackReason:Reason}:{})});
   E.signal.throwIfAborted();E.attempt=Result.attempt;E.optionsKey=JSON.stringify(E.job.localCaptions);E.cursor=0;E.liveRevision=0;E.preview=null;E.liveState=null;E.finalResult=null;E.finalization=null;E.recognitionRecovery=null;E.sourceTimeline=null;E.transport.attempt=Result.attempt;E.job.captionAttempt=Result.attempt;
   const Session=CaptionOutputSession(E.job);Session.finalMappingReceipt=null;Session.finalMappingDigest=null;Session.finalMappingResultRevision=null;delete E.job.captionFinalMappingReceipt;return Result.attempt;
  }finally{E.pendingAttempt=null;}
 }
 async function Capabilities(E,Job){
  const Key=JSON.stringify(Job.localCaptions);
  if(E.capabilities?.jobOptionsKey===Key)return E.capabilities;
  const Result=await Request(E,'capabilities');
  // The service probes its trusted stored snapshot. Do not label a response
  // for other settings as this job's capability or reuse a prior selection.
  if(Result.jobOptionsKey!==Key||JSON.stringify(Job.localCaptions)!==Key)throw Error('caption_session_conflict');
  E.capabilities=Result;return Result;
 }
 async function Status(E){const Value=await Request(E,'status');if(['failed','preparation-failed'].includes(Value.phase))throw Error(Value.error||'caption_recognition_failed');if(Value.phase==='canceled')throw new DOMException('Canceled','AbortError');return Value;}
 async function WaitRecognized(E){for(;;){const Value=await Status(E);if(Value.phase==='recognized')return Value;await CaptionAbortableWait(E.signal);}}
 async function Hypothesis(E,Id){
  for(;;){
   const Page=await Request(E,'windowResults',{cursor:E.cursor,limit:CaptionPolicy.resultPageItems});E.cursor=Page.nextCursor;
   if(!Array.isArray(Page.items)||Page.items.length>1||!Number.isSafeInteger(Page.nextCursor)||Page.nextCursor<0)throw Error('caption_result_cursor');
   for(let H of Page.items){
    if(H.resultRef){
     if(!Number.isSafeInteger(H.bytes)||H.bytes>CaptionPolicy.maxWorkerResultBytes)throw Error('caption_result_limit');
     let Offset=0;const Parts=[];for(;;){const P=await Request(E,'readWindowResult',{windowId:H.windowId,offset:Offset}),Bytes=Uint8Array.from(atob(P.data),C=>C.charCodeAt(0));
      if(P.offset!==Offset+Bytes.length||P.offset>H.bytes||!P.done&&!Bytes.length)throw Error('caption_result_invalid');Parts.push(Bytes);Offset=P.offset;if(P.done){if(Offset!==H.bytes)throw Error('caption_result_invalid');break;}}
     const File=new Blob(Parts);if(await CaptionDigest(File)!==H.sha256)throw Error('caption_result_conflict');H=JSON.parse(await File.text());
    }
    if(H.windowId!==Id)throw Error('caption_result_conflict');return H;
   }
   await Status(E);await CaptionAbortableWait(E.signal);
  }
 }
 async function Submit(E,Value){
  const Window=ValidateCaptionWindow(Value.window);if(Value.file.size!==Window.bytes||await CaptionDigest(Value.file)!==Window.sha256)throw Error('caption_window_checksum');let Result;
  for(;;){const S=await Status(E);E.credit=S.credit??E.credit;if(E.credit>0||Value.prepareToken){try{Result=await Busy(E,'beginWindow',{window:Window,...(Value.prepareToken?{prepareToken:Value.prepareToken}:{})});break;}catch(ErrorValue){throw ErrorValue;}}await CaptionAbortableWait(E.signal);}
  const Offset=Result.offset;if(!Number.isSafeInteger(Offset)||Offset<0||Offset>Value.file.size)throw Error('caption_upload_order');
  if(Offset<Value.file.size)await UploadCaptionBytes(Value.file.slice(Offset),async Fields=>{const R=await Request(E,'appendWindow',{windowId:Window.id,...Fields,offset:Offset+Fields.offset});return {...R,offset:R.offset-Offset};},E.signal);
  Result=await Request(E,'sealWindow',{windowId:Window.id,bytes:Window.bytes,sha256:Window.sha256});E.credit=Result.credit;return Hypothesis(E,Window.id);
 }
 async function Ack(E,Value){if(Value.ackWindowIds?.length){const R=await Request(E,'ackWindows',{windowIds:Value.ackWindowIds,committedSamples:Value.committedSamples,committedSpans:Value.committedSpans});E.credit=R.credit;}}
 async function PublishLive(E,Finished=false){
  if(Finished)E.preview=null;
  const State=ComposeLiveCaptionView(E.merger.snapshot(),E.preview,Finished?null:E.liveState),Snapshot=BuildLiveCaptionSnapshot(State,++E.liveRevision,Finished);
  await Request(E,'publishLive',{snapshot:Snapshot});
  E.liveState=structuredClone(State);E.liveFinished=Finished;
 }
 async function Preview(E,Value){
  const V=ValidateCaptionPreview(Value.preview);E.signal.throwIfAborted();
  if(Value.file.size!==V.bytes||await CaptionDigest(Value.file)!==V.sha256)throw Error('caption_window_checksum');
  let Begin;
  try{Begin=await Request(E,'beginPreview',{preview:V,...(Value.prepareToken?{prepareToken:Value.prepareToken}:{})});}
  catch(ErrorValue){if(ErrorValue.message!=='caption_window_backpressure')throw ErrorValue;Begin={accepted:false};}
  if(!Begin.accepted){if(Value.prepareToken)await Request(E,'prepareEncodedRelease',{prepareToken:Value.prepareToken});return;}
  if(Begin.previewId!==V.id||!Number.isSafeInteger(Begin.offset)||Begin.offset<0||Begin.offset>V.bytes)throw Error('caption_upload_order');
  if(Begin.offset<V.bytes)await UploadCaptionBytes(Value.file.slice(Begin.offset),async Fields=>{const R=await Request(E,'appendPreview',{previewId:V.id,...Fields,offset:Begin.offset+Fields.offset});return {...R,offset:R.offset-Begin.offset};},E.signal);
  const H=await Request(E,'sealPreview',{previewId:V.id,bytes:V.bytes,sha256:V.sha256});
  if(H.previewId!==V.id||H.epoch!==V.epoch||H.inputStartSample!==V.inputStartSample||H.inputEndSample!==V.inputEndSample||!Array.isArray(H.cues))throw Error('caption_result_conflict');
  E.preview=H;await PublishLive(E);
 }
 async function WindowLoop(E){
  try{
   for(;;){
    while((await Status(E)).credit===0)await CaptionAbortableWait(E.signal);
    E.signal.throwIfAborted();const Value=await E.source.next({onPreview:V=>Preview(E,V)});if(!Value)break;
    E.preview=null;const H=await Submit(E,Value);let Merge=E.merger.accept(H);await Ack(E,Merge);await PublishLive(E);
    for(let Repair=1;Merge.repair&&Repair<=CaptionPolicy.maxRepairAttempts;Repair++){
     const Window=await E.source.repair(Merge.repair.boundary,Merge.repair.parentId,Repair),Result=await Submit(E,Window);
     Merge=E.merger.repair(Result);await Ack(E,Merge);await PublishLive(E);if(Merge.resolved)break;
    }
    if(Merge.repair)throw Error('caption_seam_unresolved');
    E.source.releaseBefore(Value.window.coreEndSample);
   }
   const Final=E.merger.seal();if(Final.unresolved)throw Error('caption_seam_unresolved');
   await PublishLive(E,true);
   await Ack(E,{ackWindowIds:[],committedSamples:Final.committedSamples});
   // Publish the final absolute frontier as a length even when the last ACK was
   // at the preceding seam. An empty ACK updates progress without re-inference.
   await Request(E,'ackWindows',{windowIds:[],committedSamples:Final.committedSamples,committedSpans:Final.committedSpans});
   const Timeline=E.source.timeline?.()||{spans:Final.coverage,sourceOrigin:E.source.sourceOrigin,sourceOriginRational:E.source.sourceOriginRational};E.sourceTimeline=Timeline;
   await Request(E,'sealConcurrent',{sourceEndSample:E.source.sourceEndSample,reason:E.source.reason,spans:Timeline.spans,sourceOrigin:Timeline.sourceOrigin,sourceOriginRational:Timeline.sourceOriginRational});
   for(;;){const S=await Status(E);if(S.phase==='windowed-ready')break;await CaptionAbortableWait(E.signal);}
   E.finalLedger=Final;
  }catch(ErrorValue){
   E.preview=null;E.liveState=null;
   E.error=E.nativeFailure||ErrorValue;let CloseFailure;
   try{await Quiesce(E);}catch(CloseError){CloseFailure=CloseError;}
   try{await E.source?.release();}catch(CloseError){CloseFailure??=CloseError;}
   if(CloseFailure)E.error=CloseFailure;E.transport.error=E.error;
   if(E.error.name!=='AbortError')await Stage(E.job,'failure',{attempt:E.attempt,code:E.error.message}).catch(()=>{});
  }
 }
 async function Fail(Id,AttemptValue,Reason=Error('caption_helper_missing')){
  const E=Entries.get(Id);if(!E||AttemptValue!==undefined&&AttemptValue!==E.attempt&&AttemptValue!==E.pendingAttempt)return {owned:false};
  E.nativeFailure=Reason;
  E.preview=null;E.liveState=null;
  if(!E.finalized){E.error=Reason;E.transport.error=Reason;E.controller.abort(Reason);}
  await E.source?.release();await E.running;return {owned:true,attempt:E.attempt,finalized:!!E.finalized};
 }
 async function Quiesce(E){for(;;){try{return await Stage(E.job,'quiesce',{...(E.attempt?{attempt:E.attempt}:{}),controlRevision:E.transport.controlRevision||0});}catch(ErrorValue){if(ErrorValue.message!=='caption_busy')throw ErrorValue;await CaptionAbortableWait(undefined);}}}
 async function Cancel(Id){
  const E=Entries.get(Id);if(!E)return;
  if(E.canceling)return E.canceling;
  const Canceling=(async()=>{
  E.preview=null;E.liveState=null;E.controller.abort(new DOMException('Canceled','AbortError'));
  // Cancellation itself is retryable while the native child quiesces.
  for(;;){try{await Stage(E.job,'cancel',E.attempt?{attempt:E.attempt}:{});break;}catch(ErrorValue){if(ErrorValue.message!=='caption_busy')break;await CaptionAbortableWait(undefined);}}
  await E.source?.release();
  await E.running?.catch(()=>{});E.detach();Entries.delete(Id);
  })();E.canceling=Canceling;return Canceling;
 }
 function CanResumeFinalization(Job){const E=Entries.get(Job.requestId);return !!E?.finalization&&E.finalization.attempt===E.attempt&&E.finalization.optionsKey===JSON.stringify(Job.localCaptions);}
 async function ResumeFinalization(Job,Signal){
  if(!CanResumeFinalization(Job))return null;
  const E=Entries.get(Job.requestId),F=E.finalization;Signal?.throwIfAborted();E.job=Job;
  if(!E.finalResult){
   // This read deliberately uses the retry's signal/transport, not the old
   // controller that a lost finalization response may already have aborted.
   const Existing=await Stage(Job,'status',{attempt:E.attempt});Signal?.throwIfAborted();
   if(Existing.attempt!==E.attempt)throw Error('caption_stale_attempt');
   if(Existing.resultRevision&&!Existing.finalizationPending){
    if(!/^[a-f0-9]{64}$/.test(Existing.resultSignature||'')||!Existing.finalMappingReceipt||await CaptionDigest(JSON.stringify(Existing.finalMappingReceipt))!==await CaptionDigest(JSON.stringify(F.expected)))throw Error('caption_result_conflict');
    // Reuse the idempotent finalizer so a lost service follow-up also restores
    // its durable job revision/checkpoint. This never invokes recognition.
    const Recovered=await Stage(Job,'finalizeResult',{attempt:E.attempt,...F.expected});Signal?.throwIfAborted();
    if(Recovered.resultRevision!==Existing.resultRevision||Recovered.resultSignature!==Existing.resultSignature)throw Error('caption_result_conflict');
    E.finalResult=Recovered;E.finalized=true;
   }else{
    // No finalized receipt yet: only already-persisted complete recognition
    // permits retrying finalization on this attempt. A failed ASR is distinct.
    const Complete=Existing.mode===CaptionModes.windowed&&Existing.inputSealed===true&&CaptionCovers(Existing.committedSpans||[],F.expected.expectedCoverage)||
     Existing.mode===CaptionModes.early&&Existing.finalizationPending===true&&Number.isSafeInteger(Existing.rawSourceEndSample)&&F.expected.expectedCoverage.every(S=>S.epoch===0&&S.endSample<=Existing.rawSourceEndSample);
    if(!Complete)throw Error(Existing.error||'caption_state');
   }
  }
  if(E.finalResult){
   // A valid result is independent of cleanup. Preserve it if close fails;
   // the next retry must confirm close before exposing this checkpoint.
   await E.source?.release();Signal?.throwIfAborted();
   const Session=CaptionOutputSession(Job);Session.finalMappingResultRevision=E.finalResult.resultRevision;Job.captionResultRevision=E.finalResult.resultRevision;
  }
  if(E.signal.aborted){E.controller=new AbortController();E.signal=AbortSignal.any([Signal,E.controller.signal].filter(Boolean));}
  E.error=null;E.nativeFailure=null;E.transport.error=null;
  return E.finalResult||null;
 }
 async function RecoverOutputRetry(Job,Signal){
  const E=Entries.get(Job.requestId);if(!E||E.optionsKey!==JSON.stringify(Job.localCaptions))return false;
  if(CanResumeFinalization(Job)){await ResumeFinalization(Job,Signal);return true;}
  Signal?.throwIfAborted();const Existing=await Stage(Job,'status',{attempt:E.attempt});Signal?.throwIfAborted();
  if(Existing.attempt!==E.attempt)throw Error('caption_stale_attempt');
  if(Existing.resultRevision&&!Existing.finalizationPending){
   if(!/^[a-f0-9]{64}$/.test(Existing.resultSignature||'')||!Existing.finalMappingReceipt)throw Error('caption_result_conflict');
   E.finalization={attempt:E.attempt,optionsKey:E.optionsKey,expected:Existing.finalMappingReceipt,recognition:Existing};
   await ResumeFinalization(Job,Signal);return true;
  }
  if(Existing.mode===CaptionModes.early&&Existing.phase==='recognized'&&Existing.finalizationPending===true){
   if(E.mode!==Existing.mode)return false;
   if(E.signal.aborted){E.controller=new AbortController();E.signal=AbortSignal.any([Signal,E.controller.signal].filter(Boolean));}
   E.recognitionRecovery={attempt:E.attempt,optionsKey:E.optionsKey,mode:Existing.mode};
   E.error=null;E.nativeFailure=null;E.transport.error=null;return true;
  }
  if(['queued','loading-model','recognizing'].includes(Existing.phase)&&!E.signal.aborted&&Existing.mode===E.mode){
   E.recognitionRecovery={attempt:E.attempt,optionsKey:E.optionsKey,mode:Existing.mode};
   // The accepted early/postprocess workflow supersedes its former prepare
   // transport error. Actual failure remains observable in WaitRecognized.
   if(E.mode!==CaptionModes.windowed){E.error=null;E.nativeFailure=null;E.transport.error=null;}
   return true;
  }
  return false;
 }
 return {
  bind(Job,Signal){return Entry(Job,Signal);},
  liveView(Id){const E=Entries.get(Id);return E?.liveState?{job:E.job,state:structuredClone(E.liveState),revision:E.liveRevision||0,attempt:E.attempt,controlRevision:E.transport.controlRevision||0,signal:E.signal,finished:!!E.liveFinished}:null;},
  signal(Job,Signal){return AbortSignal.any([Signal,Entry(Job,Signal).signal].filter(Boolean));},
  ownership(Id){const E=Entries.get(Id);return E?{owned:true,attempt:E.attempt,pendingAttempt:E.pendingAttempt,failed:!!E.error,finalized:!!E.finalized}: {owned:false};},
  markFinalized(Job){const E=Entries.get(Job.requestId);if(E)E.finalized=true;},
  fail:Fail,
  canResumeFinalization:CanResumeFinalization,
  resumeFinalization:ResumeFinalization,
  recoverOutputRetry:RecoverOutputRetry,
  async resumeRecognition(Job,Timing,Signal){
   const E=Entries.get(Job.requestId),R=E?.recognitionRecovery;
   if(!R||R.attempt!==E.attempt||R.optionsKey!==JSON.stringify(Job.localCaptions)||R.mode!==E.mode)return null;
   Signal?.throwIfAborted();E.job=Job;E.signal=AbortSignal.any([Signal,E.signal].filter(Boolean));
   // A proven accepted ASR request no longer depends on the old preparation
   // promise. Keep that historical error intact and wait on this request.
   if(R.mode===CaptionModes.early||R.mode===CaptionModes.windowed)return this.finalize(Job,Timing,Signal);
   const Current=await WaitRecognized(E);
   if(Current.finalizationPending||!Current.resultRevision||!/^[a-f0-9]{64}$/.test(Current.resultSignature||'')||!Current.finalMappingReceipt)throw Error('caption_result_conflict');
   E.finalization={attempt:E.attempt,optionsKey:E.optionsKey,expected:Current.finalMappingReceipt,recognition:Current};
   return ResumeFinalization(Job,Signal);
  },
  async attempt(Job,Signal){const E=Entry(Job,Signal);if(!E.attempt)await Attempt(E);return E.attempt;},
  async earlyReady(Job,Signal){
   const E=Entry(Job,Signal);if(E.mode===CaptionModes.windowed||E.mode===CaptionModes.early)return;
   const Selection=SelectConcurrentCaptionMode({job:Job,source:{...Job.captionSourceInfo,windowed:false,audioReady:true},capabilities:await Capabilities(E,Job)});
   if(Selection.mode!==CaptionModes.early){E.transport.reason=Selection.reason;return;}E.transport.reason=null;
   if(!E.attempt)await Attempt(E);E.mode=CaptionModes.early;E.audioTiming={origin:Job.captionAudioStart||0,shift:Job.captionAudioShift||0};
   try{await Busy(E,'recognizeEarly');}catch(ErrorValue){E.error=ErrorValue;E.transport.error=ErrorValue;throw ErrorValue;}Job.captionMode=E.mode;
  },
  async windowed(Job,Source,Signal,Fingerprint){
   const E=Entry(Job,Signal);
   const Selection=SelectConcurrentCaptionMode({job:Job,source:{...Job.captionSourceInfo,windowed:true},capabilities:await Capabilities(E,Job)});
   if(Selection.mode!==CaptionModes.windowed){E.transport.reason=Selection.reason;return false;}E.transport.reason=null;
   if(!E.attempt)await Attempt(E);E.mode=CaptionModes.windowed;E.source=Source;E.merger=CreateCaptionWindowMerger();
   CaptionOutputSession(Job).captionSources.add(Source);
   let Open;try{Open=await Busy(E,'openConcurrent',{sourceFingerprint:await CaptionDigest(Fingerprint),limits:CaptionPolicy});}catch(ErrorValue){E.error=ErrorValue;E.transport.error=ErrorValue;throw ErrorValue;}E.credit=Open.credit;
   E.liveState=ComposeLiveCaptionView(E.merger.snapshot(),null);E.liveFinished=false;
   Source.bindPreparation?.((Action,Fields)=>Fields?.purpose==='preview'?Request(E,Action,Fields):Busy(E,Action,Fields));
   Job.captionMode=E.mode;E.running=WindowLoop(E);return true;
  },
  async finalize(Job,Timing,Signal){
   const E=Entry(Job,Signal);E.job=Job;Job.captionAttempt=E.attempt;if(E.error&&!MayFallback(E,E.error))throw E.error;
   if(E.finalResult){await E.source?.release();return E.finalResult;}
   if(E.mode===CaptionModes.postprocess)return null;
   if(E.mode===CaptionModes.windowed){
    await E.running;
    if(E.error){if(!MayFallback(E,E.error))throw E.error;await this.fallback(Job,E.error.message,Signal);return null;}
    await E.source.clock;
   }
   const S=E.finalization?.recognition||(E.mode===CaptionModes.early?await WaitRecognized(E):E.finalLedger);
   const Shift=E.mode===CaptionModes.windowed?(Job.captionSourceAudioShift||0):E.audioTiming.shift,Origin=E.mode===CaptionModes.windowed?E.source.sourceOrigin:E.audioTiming.origin;
   const Timeline=E.mode===CaptionModes.windowed?E.sourceTimeline:{spans:[{epoch:0,startSample:0,endSample:S.finalSamples}],sourceOrigin:Origin};
   if(!Timing&&E.mode!==CaptionModes.windowed)throw Error('caption_window_clock');
   const Mapping=CaptionFinalTimeline({spans:Timeline.spans,sourceOrigin:Origin,sourceOriginRational:Timeline.sourceOriginRational,timing:Timing,trackShift:Shift});
   const Session=CaptionOutputSession(Job),Receipt={...Mapping,sourceTimeline:Timeline};
   const ReceiptDigest=await CaptionDigest(JSON.stringify(Receipt));
   if(Session.finalMappingDigest&&Session.finalMappingDigest!==ReceiptDigest)throw Error('caption_result_conflict');
   Session.finalMappingReceipt=structuredClone(Receipt);Session.finalMappingDigest=ReceiptDigest;
   Job.captionFinalMappingReceipt=Session.finalMappingReceipt;
   const Expected={mapping:Mapping.mapping,expectedCoverage:Mapping.expectedCoverage,outputStart:Mapping.outputStart,outputEnd:Mapping.outputEnd,audioBoundOnly:Mapping.audioBoundOnly,formats:[...new Set([...Job.localCaptions.formats,'vtt'])].sort()};
   E.finalization={attempt:E.attempt,optionsKey:JSON.stringify(Job.localCaptions),expected:Expected,recognition:S};
   const Existing=await Request(E,'status');
   if(Existing.resultRevision&&!Existing.finalizationPending){
    if(!Existing.finalMappingReceipt||await CaptionDigest(JSON.stringify(Existing.finalMappingReceipt))!==await CaptionDigest(JSON.stringify(Expected)))throw Error('caption_result_conflict');
    Session.finalMappingResultRevision=Existing.resultRevision;Job.captionResultRevision=Existing.resultRevision;E.finalized=true;E.finalResult=Existing;await E.source?.release();return Existing;
   }
   await Request(E,'finalCoverage',{coverage:Mapping.expectedCoverage,committedSpans:E.mode===CaptionModes.windowed?S.committedSpans:UnionCaptionSpans([{epoch:0,startSample:0,endSample:S.finalSamples}])});
   if(E.mode===CaptionModes.windowed){
    const Lines=E.finalLedger.cues.map(C=>JSON.stringify({startSample:C.startSample,endSample:C.endSample,text:C.text,epoch:C.epoch,windowId:C.windowId,revision:C.revision,cueIndex:C.cueIndex})).join('\n');
    const File=new Blob([Lines?Lines+'\n':'']);if(File.size>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');
    if(File.size)await UploadCaptionBytes(File,Fields=>Request(E,'appendFinalCues',{...Fields,done:Fields.offset+Uint8Array.from(atob(Fields.data),C=>C.charCodeAt(0)).length===File.size}),E.signal);
    else await Request(E,'appendFinalCues',{offset:0,data:'',done:true});
   }
   const Result=await Busy(E,'finalizeResult',{...Mapping,formats:[...new Set([...Job.localCaptions.formats,'vtt'])]});
   Session.finalMappingResultRevision=Result.resultRevision;Job.captionResultRevision=Result.resultRevision;E.finalized=true;E.finalResult=Result;await E.source?.release();return Result;
  },
  async fallback(Job,Reason,Signal){
   const E=Entry(Job,Signal);await E.source?.release();await Busy(E,'quiesce');await Attempt(E,Reason);E.mode=CaptionModes.postprocess;E.error=null;E.transport.error=null;E.source=null;E.running=null;E.job.captionMode=E.mode;E.job.captionPrepared=false;return E.attempt;
  },
  async retryRecognition(Job,Signal,Reason){
   Signal?.throwIfAborted();let E=Entry(Job,Signal);E.job=Job;await E.source?.release();await E.running;
   if(E.nativeFailure){E.detach();Entries.delete(Job.requestId);E=Entry(Job,Signal);}
   await Quiesce(E);await Attempt(E,Reason);E.source=null;E.running=null;E.error=null;E.finalized=false;E.finalResult=null;E.transport.error=null;E.transport.reason=Reason||null;E.transport.prepared=false;E.transport.finalInputClipped=false;E.mode=CaptionModes.postprocess;Job.captionMode=E.mode;Job.captionPrepared=false;
  },
  async clipPrepared(Job,Signal){const E=Entry(Job,Signal);if(E.nativeFailure)throw E.nativeFailure;if(E.mode!==CaptionModes.postprocess||!E.transport.prepared)return false;await this.retryRecognition(Job,Signal,'caption_clipped_input');return true;},
  async suspend(Job){const E=Entries.get(Job.requestId);if(!E)return;await Fail(Job.requestId,E.attempt,E.nativeFailure||Error('caption_interrupted'));await Quiesce(E);E.running=null;E.source=null;},
  cancel:Cancel,
  async release(Id){const E=Entries.get(Id);if(!E)return;await E.source?.release();E.detach();Entries.delete(Id);},
 };
}
