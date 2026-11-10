import {CaptionProcessingPolicy} from '../data/caption-runtime-metadata.js';
import {CaptionRuntimeReady} from './caption-runtime-contract.js';
import {ValidateCaptionProcessingPolicy} from './caption-processing-policy.js';

// Processing choices are shipped with the extension-owned speech package. They
// are not site exceptions or a second set of native defaults.
export const CaptionPolicy=ValidateCaptionProcessingPolicy(CaptionProcessingPolicy);
export const CaptionModes=Object.freeze({postprocess:'postprocess',early:'early-audio',windowed:'windowed'});
export function CaptionConcurrentReady(Value,Mode=CaptionModes.early){
 if(!CaptionRuntimeReady(Value)||!(Value.captionConcurrencyVersion>=1)||!(Value.captionFinalizeVersion>=1))return false;
 return Mode!==CaptionModes.windowed||Value.captionWindowVersion>=1;
}
export function SelectConcurrentCaptionMode({job,source={},capabilities}){
 if(!job.localCaptions?.enabled||job.snapshot)return {mode:CaptionModes.postprocess,reason:'disabled'};
 if(source.windowed&&CaptionConcurrentReady(capabilities,CaptionModes.windowed))return {mode:CaptionModes.windowed};
 if(source.live||job.live||job.recording)return {mode:CaptionModes.postprocess,reason:'non_finite_source'};
 if(source.discontinuous)return {mode:CaptionModes.postprocess,reason:'discontinuous_source'};
 if(source.audioReady&&CaptionConcurrentReady(capabilities))return {mode:CaptionModes.early};
 return {mode:CaptionModes.postprocess,reason:'concurrent_unavailable'};
}
export function CaptionSample(Seconds){
 const Value=Math.round(Seconds*CaptionPolicy.sampleRate);
 if(!Number.isFinite(Seconds)||!Number.isSafeInteger(Value))throw Error('caption_window_clock');
 return Value;
}
export function ValidateCaptionAttempt(Value){
 if(!Number.isSafeInteger(Value)||Value<1)throw Error('caption_invalid');return Value;
}
export function ValidateCaptionWindow(Window){
 const Integer=Key=>Number.isSafeInteger(Window?.[Key]);
 const V2=Window?.descriptorVersion===2;
 if(!Window||Window.descriptorVersion!==undefined&&![1,2].includes(Window.descriptorVersion)||typeof Window.id!=='string'||!/^[a-f0-9]{64}$/.test(Window.id)||!['aac','pcm-s16le'].includes(Window.codec)||!Integer('epoch')||Window.epoch<0||!V2&&(Window.codec!=='aac'||Window.epoch!==0)||
  !['coreStartSample','coreEndSample','inputStartSample','inputEndSample','bytes'].every(Integer)||
  Window.inputStartSample<0||Window.inputStartSample>Window.coreStartSample||Window.coreStartSample>=Window.coreEndSample||
  Window.coreEndSample>Window.inputEndSample||Window.inputEndSample-Window.inputStartSample>CaptionPolicy.chunkSeconds*CaptionPolicy.sampleRate||
  Window.coreEndSample-Window.coreStartSample>CaptionPolicy.coreSeconds*CaptionPolicy.sampleRate||
  Window.coreStartSample-Window.inputStartSample>CaptionPolicy.contextSeconds*CaptionPolicy.sampleRate||
  Window.inputEndSample-Window.coreEndSample>CaptionPolicy.contextSeconds*CaptionPolicy.sampleRate||
  Window.bytes<=0||Window.bytes>CaptionPolicy.maxWindowBytes||typeof Window.sha256!=='string'||!/^[a-f0-9]{64}$/.test(Window.sha256))throw Error('caption_invalid');
 const TrimLimit=V2&&Window.profile==='aac-prepared-pcm-v1'?(CaptionPolicy.chunkSeconds+2*CaptionPolicy.contextSeconds)*CaptionPolicy.sampleRate:CaptionPolicy.contextSeconds*CaptionPolicy.sampleRate;
 for(const Key of ['trimStartSamples','trimEndSamples'])if(Window[Key]!==undefined&&(!Integer(Key)||Window[Key]<0||Window[Key]>TrimLimit))throw Error('caption_invalid');
 if(!Number.isSafeInteger(Window.inputEndSample-Window.inputStartSample+(Window.trimStartSamples||0)+(Window.trimEndSamples||0)))throw Error('caption_invalid');
 if(Window.repairOf!==undefined&&(typeof Window.repairOf!=='string'||!/^[a-f0-9]{64}$/.test(Window.repairOf)||!Number.isSafeInteger(Window.repairAttempt)||Window.repairAttempt<1||Window.repairAttempt>CaptionPolicy.maxRepairAttempts))throw Error('caption_invalid');
 if(V2){
  if(!Integer('ordinal')||Window.ordinal<0||!Array.isArray(Window.sourceEvidence)||!Window.sourceEvidence.length||new TextEncoder().encode(JSON.stringify(Window)).length>CaptionPolicy.maxLedgerBytes)throw Error('caption_invalid');
  const D=Window.decode,Frames=Window.inputEndSample-Window.inputStartSample;
  if(!D||!Number.isSafeInteger(D.expectedFrames)||!Number.isSafeInteger(D.trimStartSamples)||!Number.isSafeInteger(D.trimEndSamples)||D.trimStartSamples<0||D.trimEndSamples<0||D.expectedFrames-D.trimStartSamples-D.trimEndSamples!==Frames||D.trimStartSamples!==(Window.trimStartSamples||0)||D.trimEndSamples!==(Window.trimEndSamples||0))throw Error('caption_invalid');
  if(Window.profile==='aac-prepared-pcm-v1'){
   if(new TextEncoder().encode(JSON.stringify(Window)).length>CaptionPolicy.resultPageBytes)throw Error('caption_window_budget');
   const E=Window.sourceEvidence.at(-1);
   if(Window.codec!=='aac'||Window.container!=='m4a'||D.expectedFrames>TrimLimit||!/^[a-f0-9]{64}$/.test(Window.configHash||'')||!/^[a-f0-9]{64}$/.test(Window.preparationFactsSha256||'')||E.kind!=='prepared-aac'||E.decodedFrames!==D.expectedFrames||E.factsSha256!==Window.preparationFactsSha256||E.inputSha256!==Window.sha256||E.localZeroSample+D.trimStartSamples!==Window.inputStartSample)throw Error('caption_invalid');
  }
  if(Window.codec==='pcm-s16le'&&(Window.container!=='wav'||Window.profile!=='pcm-s16-wav-16000-mono-v1'||D.expectedFrames!==Frames||D.trimStartSamples||D.trimEndSamples||Window.bytes!==44+Frames*2))throw Error('caption_invalid');
  if(Window.codec==='pcm-s16le'){
   const E=Window.sourceEvidence[0],R=Window.sourceOrigin;
   if(Window.sourceEvidence.length!==1||E.kind!=='pcm-frame-range'||E.epoch!==Window.epoch||!Number.isSafeInteger(E.firstSequence)||E.firstSequence<1||!Number.isSafeInteger(E.lastSequence)||E.lastSequence<E.firstSequence||E.frames!==E.lastSequence-E.firstSequence+1||!Number.isSafeInteger(E.samples)||E.samples<=0||E.bytes!==E.samples*2||E.endSample-E.startSample!==E.samples||E.startSample>Window.inputStartSample||E.endSample<Window.inputEndSample||E.inputStartSample!==Window.inputStartSample||E.inputEndSample!==Window.inputEndSample||E.inputSamples!==Frames||!/^[a-f0-9]{64}$/.test(E.factsSha256||''))throw Error('caption_invalid');
   for(const P of [R,E.firstPts,E.lastPts])if(!P||!Number.isSafeInteger(P.ticks)||!Number.isSafeInteger(P.timeBaseNum)||P.timeBaseNum<1||!Number.isSafeInteger(P.timeBaseDen)||P.timeBaseDen<1)throw Error('caption_invalid');
  }
 }
 return Window;
}
export async function CaptionDigest(Value){
 const Bytes=Value instanceof Blob?await Value.arrayBuffer():typeof Value==='string'?new TextEncoder().encode(Value):Value;
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Bytes)),Byte=>Byte.toString(16).padStart(2,'0')).join('');
}
export function CaptionAbortableWait(Signal,Milliseconds=CaptionPolicy.pollIntervalMs){
 Signal?.throwIfAborted();
 return new Promise((Resolve,Reject)=>{
  const Stop=()=>{clearTimeout(Timer);Signal?.removeEventListener('abort',Stop);Reject(Signal.reason||new DOMException('Canceled','AbortError'));};
  const Timer=setTimeout(()=>{Signal?.removeEventListener('abort',Stop);Resolve();},Milliseconds);
  Signal?.addEventListener('abort',Stop,{once:true});if(Signal?.aborted)Stop();
 });
}
export async function UploadCaptionBytes(File,Send,Signal){
 for(let Offset=0;Offset<File.size;Offset+=CaptionPolicy.uploadChunkBytes){
  Signal?.throwIfAborted();const Bytes=new Uint8Array(await File.slice(Offset,Offset+CaptionPolicy.uploadChunkBytes).arrayBuffer());
  let Binary='';const Block=8192;
  for(let Index=0;Index<Bytes.length;Index+=Block)Binary+=String.fromCharCode(...Bytes.subarray(Index,Index+Block));
  const Result=await Send({offset:Offset,data:btoa(Binary)});
  if(Result.offset!==Offset+Bytes.length)throw Error('caption_upload_order');
 }
}
