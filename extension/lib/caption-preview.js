import {CaptionPolicy as Policy,CaptionDigest} from './concurrent-captions-contract.js';
import {LiveCaptionLimits} from './live-caption-output.js';

// Application cadence and selected PCM bounds, independent of final windows.
export const CaptionPreviewPolicy=Object.freeze({intervalSamples:2*Policy.sampleRate,maxSamples:8*Policy.sampleRate});
const Int=N=>Number.isSafeInteger(N)&&N>=0;
const Hash=S=>typeof S==='string'&&/^[a-f0-9]{64}$/.test(S);
export function ValidateCaptionPreview(V){
 if(!V||V.purpose!=='preview'||!Hash(V.id)||!Hash(V.sha256)||!Int(V.epoch)||!Int(V.inputStartSample)||!Int(V.inputEndSample)||V.inputEndSample<=V.inputStartSample||V.inputEndSample-V.inputStartSample>CaptionPreviewPolicy.maxSamples||!Int(V.bytes)||!V.bytes||V.bytes>Policy.maxWindowBytes||!['pcm-s16le','aac'].includes(V.codec)||!V.decode||!Int(V.decode.expectedFrames)||!Int(V.decode.trimStartSamples)||!Int(V.decode.trimEndSamples)||V.decode.expectedFrames> (Policy.chunkSeconds+2*Policy.contextSeconds)*Policy.sampleRate||V.decode.expectedFrames!==V.decode.trimStartSamples+V.inputEndSample-V.inputStartSample+V.decode.trimEndSamples||V.ordinal!==undefined||V.repairOf!==undefined)throw Error('caption_invalid');
 if(V.codec==='pcm-s16le'&&(V.bytes!==44+2*(V.inputEndSample-V.inputStartSample)||V.decode.trimStartSamples||V.decode.trimEndSamples))throw Error('caption_window_clock');
 if(V.codec==='aac'&&(!Hash(V.preparationFactsSha256)||V.profile!=='aac-prepared-pcm-v1'))throw Error('caption_window_clock');
 if(new TextEncoder().encode(JSON.stringify(V)).length>Policy.maxLedgerBytes)throw Error('caption_result_limit');
 return V;
}

/** Ephemeral app workflow; native receives only existing file/decode/infer calls.
 * A failed/ambiguous command retains its source and reservation until cancel
 * confirms scope quiescence. No ASR request is replayed or recovered here. */
export function CreateCaptionPreviewExecution({check,run,read,write,admission,preparation,infer,append}){
 async function Release(R,P){await preparation.release(R,P.token);if(R.preview===P)R.preview=null;}
 return {async dispatch(R,M){
  if(R.state.mode!=='windowed'||R.state.inputSealed||R.state.resultRevision||['failed','preparation-failed','canceled'].includes(R.state.phase))throw Error('caption_state');
  if(M.action==='beginPreview'){
   const V=ValidateCaptionPreview(M.preview);if(R.preview)throw Error('caption_session_conflict');
   // One awaited callback is the complete preview lane. Final/repair inference
   // already admitted before this opportunity always finishes first.
   if(R.windowTask)await R.windowTask;check(R);
   if([...R.windows.values()].some(W=>['queued','recognizing'].includes(W.phase)))return {accepted:false,attempt:R.state.attempt};
   let P;
   if(M.prepareToken){P=preparation.validate(R,M.prepareToken,V,true);}
   else {if(V.codec!=='pcm-s16le')throw Error('caption_preparation_missing');P=await preparation.reservePreview(R,V);}
   R.preview={window:structuredClone(V),token:P.token,dir:P.dir,offset:M.prepareToken?V.bytes:0,receipts:[],prepared:!!M.prepareToken};
   if(!M.prepareToken)await write(P.dir+'/input.wav',new Uint8Array(),R.scope);
   return {accepted:true,previewId:V.id,offset:R.preview.offset,attempt:R.state.attempt};
  }
  const P=R.preview;if(!P||M.previewId!==P.window.id)throw Error('caption_preview_missing');
  if(M.action==='releasePreview'){
   if(P.started&&!P.completed)throw Error('caption_preview_uncertain');await Release(R,P);return {released:true,attempt:R.state.attempt};
  }
  if(M.action==='appendPreview'){
   if(P.started||P.prepared)throw Error('caption_state');
   return append(R,P,P.dir+'/input.wav',M,P.window.bytes,true);
  }
  if(M.action!=='sealPreview'||P.started||M.bytes!==P.window.bytes||M.sha256!==P.window.sha256||P.offset!==P.window.bytes)throw Error('caption_state');
  if(R.windowTask)await R.windowTask;check(R);
  if(['failed','preparation-failed','canceled'].includes(R.state.phase))throw Error('caption_state');
  const V=P.window;P.started=true;
  // Mark before every awaited command that could still own/read these files.
  await admission(R,Policy.maxWorkerResultBytes+44+2*(V.inputEndSample-V.inputStartSample),true);
  let Audio;
  if(P.prepared)Audio=await preparation.slice(R,V,P.token,true);
  else {
   const B=await read(P.dir+'/input.wav',R.scope,Policy.maxWindowBytes);
   if(B.length!==V.bytes||await CaptionDigest(B)!==V.sha256)throw Error('caption_window_checksum');
   const View=new DataView(B.buffer,B.byteOffset,B.byteLength),Tag=(A,Z)=>String.fromCharCode(...B.subarray(A,Z));
   if(Tag(0,4)!=='RIFF'||View.getUint32(4,true)!==B.length-8||Tag(8,12)!=='WAVE'||Tag(12,16)!=='fmt '||View.getUint32(16,true)!==16||View.getUint16(20,true)!==1||View.getUint16(22,true)!==1||View.getUint32(24,true)!==Policy.sampleRate||View.getUint32(28,true)!==Policy.sampleRate*2||View.getUint16(32,true)!==2||View.getUint16(34,true)!==16||Tag(36,40)!=='data'||View.getUint32(40,true)!==B.length-44)throw Error('caption_window_clock');
   const D=await run(R,'decode',{source:P.dir+'/input.wav',output:P.dir+'/decoded',rate:Policy.sampleRate,chunkSeconds:Policy.chunkSeconds,alignOrigin:false,maxOutputBytes:44+V.decode.expectedFrames*2,minFreeBytes:Policy.minFreeBytes,
    trim:{before:0,frames:V.decode.expectedFrames,expectedFrames:V.decode.expectedFrames}});
   if(D.files?.length!==1||D.files[0].frames!==V.decode.expectedFrames)throw Error('caption_window_clock');Audio=D.files[0].path;
  }
  const H=await infer(R,Audio,'prepared/'+P.token+'/inference',true);check(R);
  let Previous=-1;const Cues=[];
  for(const S of H.segments){
   if(!Array.isArray(S)||!Number.isFinite(S[0])||!Number.isFinite(S[1])||typeof S[2]!=='string')throw Error('caption_result_invalid');
   const A=V.inputStartSample+Math.round(S[0]*Policy.sampleRate),B=V.inputStartSample+Math.round(S[1]*Policy.sampleRate);
   if(!Int(A)||A<Previous||!Int(B)||B<=A)throw Error('caption_result_invalid');Previous=A;
   if(A<V.inputStartSample||B>V.inputEndSample)continue;
   let Text=S[2].slice(0,LiveCaptionLimits.text);if(/[\uD800-\uDBFF]$/.test(Text))Text=Text.slice(0,-1);
   Cues.push({epoch:V.epoch,startSample:A,endSample:B,text:Text,provisional:true});
  }
  const Result={previewId:V.id,epoch:V.epoch,inputStartSample:V.inputStartSample,inputEndSample:V.inputEndSample,language:String(H.language||'und').slice(0,64),cues:Cues.slice(-LiveCaptionLimits.cues),attempt:R.state.attempt};
  while(new TextEncoder().encode(JSON.stringify(Result)).length>LiveCaptionLimits.bytes&&Result.cues.length)Result.cues.shift();
  P.completed=true;await Release(R,P);return Result;
 }};
}
