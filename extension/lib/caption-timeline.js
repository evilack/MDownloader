import {CaptionProcessingPolicy as Policy} from '../data/caption-runtime-metadata.js';

const Integer=N=>Number.isSafeInteger(N)&&N>=0;
/** Canonical coverage is an epoch-labelled union, never a bounding interval. */
export function CaptionSpans(Value){
 const Values=Array.isArray(Value)?Value:Value?[{epoch:Value.epoch??0,...Value}]:[];
 if(Values.length>Policy.maxWindows)throw Error('caption_result_limit');
 return Values.map(S=>{
  if(!S||!Integer(S.epoch)||!Integer(S.startSample)||!Integer(S.endSample)||S.endSample<=S.startSample)throw Error('caption_coverage');
  return {epoch:S.epoch,startSample:S.startSample,endSample:S.endSample};
 });
}
export function UnionCaptionSpans(Value){
 const Sorted=CaptionSpans(Value).sort((A,B)=>A.epoch-B.epoch||A.startSample-B.startSample||A.endSample-B.endSample),Out=[];
 for(const S of Sorted){const P=Out.at(-1);if(P&&P.epoch===S.epoch&&S.startSample<=P.endSample)P.endSample=Math.max(P.endSample,S.endSample);else Out.push({...S});}
 // Epochs cannot claim the same physical samples. A change may touch an edge.
 const Physical=[...Out].sort((A,B)=>A.startSample-B.startSample);
 for(let I=1;I<Physical.length;I++)if(Physical[I].startSample<Physical[I-1].endSample)throw Error('caption_coverage');
 return Out;
}
export function IntersectCaptionSpans(A,B){
 const Left=UnionCaptionSpans(A),Right=UnionCaptionSpans(B),Out=[];
 for(const X of Left)for(const Y of Right){if(X.epoch!==Y.epoch)continue;const Start=Math.max(X.startSample,Y.startSample),End=Math.min(X.endSample,Y.endSample);if(End>Start)Out.push({epoch:X.epoch,startSample:Start,endSample:End});}
 return UnionCaptionSpans(Out);
}
export function CaptionSpanLength(Value){
 const N=UnionCaptionSpans(Value).reduce((N,S)=>N+S.endSample-S.startSample,0);if(!Number.isSafeInteger(N))throw Error('caption_coverage');return N;
}
export function CaptionCovers(Available,Expected){return CaptionSpanLength(IntersectCaptionSpans(Available,Expected))===CaptionSpanLength(Expected);}
export function CaptionRationalSeconds(Value){
 if(!Value||!Number.isSafeInteger(Value.ticks)||!Number.isSafeInteger(Value.timeBaseNum)||Value.timeBaseNum<=0||!Number.isSafeInteger(Value.timeBaseDen)||Value.timeBaseDen<=0)throw Error('caption_window_clock');
 const N=Value.ticks*Value.timeBaseNum/Value.timeBaseDen;if(!Number.isFinite(N))throw Error('caption_window_clock');return N;
}
/** Preserve the first frame's exact rational; round only the final difference. */
export function CaptionRationalSample(Pts,Origin,Rate=Policy.sampleRate){
 CaptionRationalSeconds(Pts);CaptionRationalSeconds(Origin);
 const N=(BigInt(Pts.ticks)*BigInt(Pts.timeBaseNum)*BigInt(Origin.timeBaseDen)-BigInt(Origin.ticks)*BigInt(Origin.timeBaseNum)*BigInt(Pts.timeBaseDen))*BigInt(Rate);
 const D=BigInt(Pts.timeBaseDen)*BigInt(Origin.timeBaseDen);
 if(N<0n)throw Error('caption_window_clock');
 const Sample=Number((2n*N+D)/(2n*D));if(!Integer(Sample))throw Error('caption_window_clock');return Sample;
}
/** Mux copied spans are in source-clock seconds AFTER explicit track shift.
 * Raw unchanged bytes have composition zero; their audio end bounds cues only.
 */
export function CaptionFinalTimeline({spans,sourceOrigin,sourceOriginRational,timing,trackShift=0}){
 const Source=UnionCaptionSpans(spans);if(!Source.length)throw Error('caption_no_audio');
 if(!Number.isFinite(sourceOrigin)||!Number.isFinite(trackShift))throw Error('caption_window_clock');
 const Origin=sourceOriginRational||{ticks:Math.round(sourceOrigin*Policy.sampleRate),timeBaseNum:1,timeBaseDen:Policy.sampleRate};
 CaptionRationalSeconds(Origin);
 let Expected,Start,End,Shift=trackShift;
 if(timing){
  if(!Number.isFinite(timing.start)||!Number.isFinite(timing.outputEnd)||timing.outputEnd<=timing.start)throw Error('caption_window_clock');
  Start=timing.start;End=timing.outputEnd;
  if(timing.trackShift!==undefined){if(!Number.isFinite(timing.trackShift))throw Error('caption_window_clock');Shift=timing.trackShift;}
  const Copied=timing.copiedAudioSpans||[{start:timing.audioStart,end:timing.audioEnd}];
  if(!Array.isArray(Copied)||Copied.length>Policy.maxWindows)throw Error('caption_coverage');
  const Selected=[];
  for(const C of Copied){
   if(!Number.isFinite(C.start)||!Number.isFinite(C.end)||C.end<=C.start)throw Error('caption_window_clock');
   const A=Math.round((C.start-sourceOrigin-Shift)*Policy.sampleRate),B=Math.round((C.end-sourceOrigin-Shift)*Policy.sampleRate);
   if(!Number.isSafeInteger(A)||!Number.isSafeInteger(B))throw Error('caption_window_clock');
   for(const S of Source){const X=Math.max(S.startSample,A),Y=Math.min(S.endSample,B);if(Y>X)Selected.push({epoch:S.epoch,startSample:X,endSample:Y});}
  }
  Expected=UnionCaptionSpans(Selected);
 }else{
  Shift=0;Start=0;End=Math.max(...Source.map(S=>sourceOrigin+S.endSample/Policy.sampleRate));Expected=Source;
 }
 if(!Expected.length||End<=Start)throw Error('caption_no_audio');
 return {expectedCoverage:Expected,outputStart:Start,outputEnd:End,audioBoundOnly:!timing,
  mapping:Expected.map(S=>({epoch:S.epoch,validStartSample:S.startSample,validEndSample:S.endSample,sourceOrigin:{...Origin},trackShift:{ticks:Math.round(Shift*Policy.sampleRate),timeBaseNum:1,timeBaseDen:Policy.sampleRate},shiftApplied:false}))};
}
