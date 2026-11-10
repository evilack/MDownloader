import {CaptionAbortableWait,UploadCaptionBytes} from './concurrent-captions-contract.js';
import {CreateConcurrentCaptionRunner} from './concurrent-captions-runner.js';
export async function CaptionStage(Job,Action,Fields={})
{
 const Attempt=Job.captionSession?.attempt||Job.captionAttempt;
 const Result=await chrome.runtime.sendMessage({type:'captionStage',action:Action,controlRevision:Job.captionSession?.controlRevision??Job.captionStatus?.controlRevision??0,...(Job.captionSession?.retryToken?{retryToken:Job.captionSession.retryToken}:{}),...(Attempt?{attempt:Attempt}:{}),...Fields,requestId:Job.requestId});
 if(!Result?.ok){if(Result.error==='caption_canceled')throw new DOMException('Caption processing canceled','AbortError');throw new Error(typeof Result?.error==='string'&&/^caption_[a-z_]+$/.test(Result.error)?Result.error:'caption_prepare_failed');}return Result.data;
}
const Request=CaptionStage;
async function Busy(Job,Action,Fields,Signal){for(;;){try{return await Request(Job,Action,Fields);}catch(ErrorValue){if(ErrorValue.message!=='caption_busy')throw ErrorValue;await CaptionAbortableWait(Signal);}}}
export const ConcurrentCaptions=CreateConcurrentCaptionRunner({stage:CaptionStage});
export async function PrepareCaptionBlob(Job,File,Signal,{early:Early=false}={})
{
 if(!Job.localCaptions?.enabled||Job.snapshot)return false;
 const CaptionSignal=ConcurrentCaptions.signal(Job,Signal);
 try{
  CaptionSignal.throwIfAborted();ConcurrentCaptions.bind(Job,Signal);await ConcurrentCaptions.attempt(Job,CaptionSignal);await Busy(Job,'begin',{},CaptionSignal);
  await UploadCaptionBytes(File,Fields=>Request(Job,'append',Fields),CaptionSignal);
  await Request(Job,'prepare');
  for(;;){
   CaptionSignal.throwIfAborted();const State=await Request(Job,'status');
   if(State.phase==='audio-ready')break;
   if(State.phase==='canceled')throw new DOMException('Canceled','AbortError');
   if(['failed','preparation-failed'].includes(State.phase))throw new Error(State.error||'caption_prepare_failed');
   await CaptionAbortableWait(CaptionSignal);
  }
  Job.captionPrepared=true;Job.captionSession.prepared=true;if(Early)await ConcurrentCaptions.earlyReady(Job,CaptionSignal);return true;
 }catch(ErrorValue){
  if(Signal?.aborted)await Request(Job,'cancel').catch(()=>{});
  else await Request(Job,'failure',{code:ErrorValue.message}).catch(()=>{});
  Job.captionPrepared=false;Job.captionPreparationError=ErrorValue;if(Job.captionSession)Job.captionSession.error=ErrorValue;throw ErrorValue;
 }
}
export async function FinishCaptionSave(Job,File,Signal)
{
 if(!Job.localCaptions?.enabled||Job.snapshot||Signal?.aborted)return;
 if(Job.captionPipeline==='staged'){await Request(Job,'saved');return;}
 try{
  if(Job.pickedDownloadFolder&&!Job.captionPrepared){if(!await PrepareCaptionBlob(Job,File,Signal))return;}
  await Request(Job,'saved');
 }catch{await Request(Job,'failure').catch(()=>{});}
}
export async function CaptionTiming(Job,OutputStart,{clipped:Clipped=false,signal:Signal}={})
{
 if(Job.snapshot||!Job.captionPreparation)return;
 await Job.captionPreparation;
 Signal?.throwIfAborted();
 // The output session first captures the completed final media. Its normal
 // preparation path then replaces a legacy full-audio input if clipping needs
 // it, so failures here do not strand an unowned completed temporary file.
 if(Clipped){if(Job.captionSession)Job.captionSession.finalInputClipped=true;return;}
 if(Job.captionPrepared&&Job.captionMode!=='early-audio')await Request(Job,'timing',{offset:Job.captionAudioStart+(Job.captionAudioShift||0)-OutputStart});
}
export async function ResetCaptionPreparation(Job)
{
 if(Job.snapshot)return;await Job.captionPreparation;Job.captionPrepared=false;
 await ConcurrentCaptions.cancel(Job.requestId);
 if(Job.localCaptions?.enabled)await Request(Job,'failure').catch(()=>{});
}
