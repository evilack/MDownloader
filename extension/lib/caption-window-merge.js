import {CaptionPolicy} from './concurrent-captions-contract.js';
import {UnionCaptionSpans,CaptionSpanLength} from './caption-timeline.js';
import {CorrectCaptionOverlaps} from './caption-timing-correction.js';
const Text=C=>C.text.normalize('NFKC').trim().replace(/\s+/gu,' ');
const WordText=C=>Text(C).toLowerCase().replace(/\p{P}/gu,'');
const Same=(A,B)=>(A.wordIndex!==undefined&&B.wordIndex!==undefined?WordText(A)!==''&&WordText(A)===WordText(B):Text(A)===Text(B))&&Math.max(A.startSample,B.startSample)<Math.min(A.endSample,B.endSample);
const Inside=(C,A,B)=>C.startSample>A&&C.endSample<B;
const Intersects=(C,A,B)=>C.endSample>A&&C.startSample<B;
const Ordered=Cues=>Cues.every((C,Index)=>!Index||C.startSample>=Cues[Index-1].startSample);
function Anchors(Left,Right){
 const Matches=[];
 for(const [aIndex,a] of Left.entries())for(const [bIndex,b] of Right.entries())if(Same(a,b))Matches.push({a,b,aIndex,bIndex});
 // Word anchors must be an unambiguous, order-preserving one-to-one match.
 // Identical repeated words at distinct times are never globally deduplicated.
 return Matches.filter(M=>M.a.wordIndex===undefined||!Matches.some(N=>N!==M&&(N.aIndex===M.aIndex||N.bIndex===M.bIndex||(N.aIndex-M.aIndex)*(N.bIndex-M.bIndex)<0)));
}
function AlignedWords(H){
 const Values=[];
 for(const [SegmentIndex,Segment] of H.cues.entries()){
  const Words=H.words.map((W,I)=>({...W,wordIndex:I})).filter(W=>W.segmentIndex===SegmentIndex);let Pending='',PendingStart=null,PendingEnd=null,FirstPending=null,Previous=null;
  if(Segment.text.trim()&&!Words.length)throw Error('caption_alignment_missing');
  for(const W of Words){
   if(!Number.isSafeInteger(W.startSample)||!Number.isSafeInteger(W.endSample)||W.startSample<0||W.endSample<W.startSample||typeof W.text!=='string')throw Error('caption_result_timestamp');
   if(W.endSample===W.startSample){Pending+=W.text;PendingStart=Math.min(PendingStart??W.startSample,W.startSample);PendingEnd=Math.max(PendingEnd??W.endSample,W.endSample);FirstPending??=W.wordIndex;continue;}
   const Value={...W,text:Pending+W.text,startSample:Math.min(PendingStart??W.startSample,W.startSample),sourceStartSample:Math.min(PendingStart??W.startSample,W.startSample),sourceEndSample:Math.max(PendingEnd??W.endSample,W.endSample),firstWordIndex:FirstPending??W.wordIndex,lastWordIndex:W.wordIndex,windowId:H.windowId,revision:H.revision,cueIndex:SegmentIndex,epoch:H.diagnostics.epoch};
   Pending='';PendingStart=null;PendingEnd=null;FirstPending=null;Values.push(Value);Previous=Value;
  }
  if(Pending){if(!Previous)throw Error('caption_alignment_missing');Previous.text+=Pending;Previous.lastWordIndex=Words.at(-1).wordIndex;Previous.endSample=Math.max(Previous.endSample,PendingEnd);Previous.sourceStartSample=Math.min(Previous.sourceStartSample,PendingStart);Previous.sourceEndSample=Math.max(Previous.sourceEndSample,PendingEnd);}
 }
 if(H.words.some(W=>!Number.isSafeInteger(W.segmentIndex)||W.segmentIndex<0||W.segmentIndex>=H.cues.length))throw Error('caption_result_invalid');
 return Values;
}
function Assemble(Values){
 const Result=[];
 for(const Value of Values){
  const Previous=Result.at(-1);
  if(!Value.parts&&!Previous?.parts&&Value.wordIndex!==undefined&&Previous?.wordIndex!==undefined&&Value.windowId===Previous.windowId&&Value.revision===Previous.revision&&Value.cueIndex===Previous.cueIndex&&Value.firstWordIndex===Previous.lastWordIndex+1){Previous.text+=Value.text;Previous.endSample=Math.max(Previous.endSample,Value.endSample);Previous.sourceStartSample=Math.min(Previous.sourceStartSample,Value.sourceStartSample??Value.startSample);Previous.sourceEndSample=Math.max(Previous.sourceEndSample,Value.sourceEndSample??Value.endSample);Previous.lastWordIndex=Value.lastWordIndex;}
  else Result.push({...Value,sourceStartSample:Value.sourceStartSample??Value.startSample,sourceEndSample:Value.sourceEndSample??Value.endSample});
 }
 return Result.map(C=>({...C,text:C.text.trim()}));
}
/** Prefer real aligned words. Subtitle ambiguity/overlap is corrected by core
 * ownership with a warning, never promoted to a failed recognition job. */
export function CreateCaptionWindowMerger(){
 let Cues=[],Previous=null,Pending=null,Origin=null,End=0,CommittedEnd=0,Language='und',Epoch=null,EpochStart=null,WarningCount=0;
 const SealedSpans=[],OriginalSpans=[];
 const Hypotheses=new Map();
 function Raw(H){
  if(typeof H.windowId!=='string'||!Number.isSafeInteger(H.revision)||!Array.isArray(H.cues)||!H.coverage||!H.diagnostics||!Number.isSafeInteger(H.diagnostics.epoch)||H.diagnostics.epoch<0||H.cues.length>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_invalid');
  const Values=H.cues.map((C,Index)=>{
   if(!Number.isSafeInteger(C.startSample)||!Number.isSafeInteger(C.endSample)||C.startSample<0||C.endSample<=C.startSample||typeof C.text!=='string')throw Error('caption_result_invalid');
   return {...C,windowId:H.windowId,revision:H.revision,cueIndex:Index,epoch:H.diagnostics.epoch};
  });
  const Result=Array.isArray(H.words)?AlignedWords(H):Values;
  const Size=new TextEncoder().encode(JSON.stringify({Cues,Values:Result})).length;if(Size>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');return Result;
 }
 function Committed(){return UnionCaptionSpans([...SealedSpans,...(Epoch!==null&&CommittedEnd>EpochStart?[{epoch:Epoch,startSample:EpochStart,endSample:CommittedEnd}]:[])]);}
 function Status(Ids=[]){
  if(new TextEncoder().encode(JSON.stringify({cues:Cues,hypotheses:[...Hypotheses],originalSpans:OriginalSpans,sealedSpans:SealedSpans,pending:Pending})).length>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');
  const Spans=Committed();return {warningCount:WarningCount,committedEndSample:CommittedEnd,committedSpans:Spans,committedSamples:CaptionSpanLength(Spans),ackWindowIds:Ids,repair:Pending&&{epoch:Epoch,boundary:Pending.boundary,parentId:Pending.left.windowId}};
 }
 function Join(Old,New,Boundary,LeftCoverage,RightCoverage){
  const Start=Math.max(LeftCoverage.startSample,RightCoverage.startSample),Finish=Math.min(LeftCoverage.endSample,RightCoverage.endSample);
  const Matches=Anchors(Old.filter(C=>Inside(C,Start,Finish)),New.filter(C=>Inside(C,Start,Finish)));
  Matches.sort((A,B)=>Math.abs(A.a.endSample-Boundary)-Math.abs(B.a.endSample-Boundary));
  for(const Match of Matches){
   const Cut=Match.a.endSample;
   if(Old.some(C=>C!==Match.a&&C.startSample<Cut&&C.endSample>Cut)||New.some(C=>C!==Match.b&&C.startSample<Match.b.endSample&&C.endSample>Match.b.endSample))continue;
   const Joined=[...Old.filter(C=>C.endSample<=Cut),...New.filter(C=>C.startSample>=Match.b.endSample)];if(Ordered(Joined))return Joined;
  }
  if(Finish>=Start&&!Old.some(C=>Intersects(C,Start,Finish))&&!New.some(C=>Intersects(C,Start,Finish)))return [...Old.filter(C=>C.endSample<=Boundary),...New.filter(C=>C.startSample>=Boundary)];
  // Subtitle overlap/disagreement is recoverable output metadata. Assign each
  // real word to the adjacent core, retain its text, and bound only its display
  // time at the shared boundary. Do not abort recognition or repeat the video.
  WarningCount++;
  const Left=new Set(Old.filter(C=>(C.startSample+C.endSample)/2<Boundary)),Right=new Set(New.filter(C=>(C.startSample+C.endSample)/2>=Boundary));
  const Overlaps=(A,B)=>A.epoch===B.epoch&&A.startSample<B.endSample&&B.startSample<A.endSample;
  // Opposite timing drift can put both estimates on the discarded side. Keep
  // one original sequence whenever the other selected side covers no speech.
  for(const C of Old)if(!Left.has(C)&&![...Right].some(R=>Overlaps(C,R)))Left.add(C);
  for(const C of New)if(!Right.has(C)&&![...Left].some(L=>Overlaps(C,L)))Right.add(C);
  const Clip=(C,IsLeft)=>{const Start=IsLeft?C.startSample:Math.max(C.startSample,Boundary),End=IsLeft?Math.min(C.endSample,Boundary):C.endSample;return {...C,sourceStartSample:C.sourceStartSample??C.startSample,sourceEndSample:C.sourceEndSample??C.endSample,...(End>Start?{startSample:Start,endSample:End}:{})};};
  return [...Old.filter(C=>Left.has(C)).map(C=>Clip(C,true)),...New.filter(C=>Right.has(C)).map(C=>Clip(C,false))];
 }
 return {
  accept(H){
   const Identity=JSON.stringify(H),Existing=Hypotheses.get(H.windowId);if(Existing){if(Existing.identity!==Identity)throw Error('caption_result_conflict');return Status();}
   if(Hypotheses.size>=CaptionPolicy.maxWindows)throw Error('caption_window_limit');
   const New=Raw(H);Hypotheses.set(H.windowId,{revision:H.revision,identity:Identity});Language=H.language||Language;
   const NextEpoch=H.diagnostics.epoch,A=H.diagnostics.coreStartSample,B=H.diagnostics.coreEndSample;
   if(!Number.isSafeInteger(A)||!Number.isSafeInteger(B)||A<0||B<=A||H.coverage.startSample>A||H.coverage.endSample<B)throw Error('caption_coverage');
   OriginalSpans.push({epoch:NextEpoch,startSample:A,endSample:B});
   if(!Previous){Epoch=NextEpoch;EpochStart=A;Origin=A;CommittedEnd=A;End=B;Cues=New;Previous=H;return Status([H.windowId]);}
   if(Pending)throw Error('caption_seam_pending');
   if(NextEpoch!==Epoch){
    if(NextEpoch<=Epoch||A<End)throw Error('caption_window_epoch');
    SealedSpans.push({epoch:Epoch,startSample:EpochStart,endSample:End});
    Epoch=NextEpoch;EpochStart=A;CommittedEnd=A;End=B;Cues=[...Cues,...New];Previous=H;
    if(new TextEncoder().encode(JSON.stringify(Cues)).length>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');return Status([H.windowId]);
   }
   if(H.diagnostics.coreStartSample!==End)throw Error('caption_coverage');
   const Joined=Join(Cues,New,End,Previous.coverage,H.coverage);
   if(Joined){Cues=Joined;CommittedEnd=End;Previous=H;End=H.diagnostics.coreEndSample;return Status([H.windowId]);}
   Pending={left:Previous,right:H,newCues:New,boundary:End};return Status();
  },
  repair(H){
   if(!Pending||H.diagnostics?.epoch!==Epoch||H.repairOf!==Pending.left.windowId)throw Error('caption_state');const Repair=Raw(H);
   const Identity=JSON.stringify(H),Existing=Hypotheses.get(H.windowId);if(Existing&&Existing.identity!==Identity)throw Error('caption_result_conflict');
   if(!Existing&&Hypotheses.size>=CaptionPolicy.maxWindows)throw Error('caption_window_limit');Hypotheses.set(H.windowId,{revision:H.revision,identity:Identity});
   const {boundary:Boundary,right:Right,newCues:New}=Pending,A=H.coverage.startSample,B=H.coverage.endSample;
   const LeftMatches=[],RightMatches=[];
   const Interior=Repair.filter(C=>Inside(C,A,B));
   for(const M of Anchors(Cues.filter(C=>C.endSample<=Boundary),Interior))LeftMatches.push({repair:M.b,original:M.a});
   for(const M of Anchors(New.filter(C=>C.startSample>=Boundary),Interior))RightMatches.push({repair:M.b,original:M.a});
   LeftMatches.sort((X,Y)=>Y.original.endSample-X.original.endSample);RightMatches.sort((X,Y)=>X.original.startSample-Y.original.startSample);
   const L=LeftMatches[0],R=RightMatches[0],Context=CaptionPolicy.contextSeconds*CaptionPolicy.sampleRate;
   // Silence may be an anchor only when both overlapping hypotheses prove the
   // same edge span silent. Edge-touching repair cues never establish safety.
   const LeftSilent=!Cues.some(C=>Intersects(C,A,A+Context))&&!Repair.some(C=>Intersects(C,A,A+Context));
   const RightSilent=!New.some(C=>Intersects(C,B-Context,B))&&!Repair.some(C=>Intersects(C,B-Context,B));
   if((!L&&!LeftSilent)||(!R&&!RightSilent))return {...Status(),ackWindowIds:[H.windowId],resolved:false};
   const From=L?L.repair.endSample:A+Context,To=R?R.repair.startSample:B-Context;
   if(From>Boundary||To<Boundary||From>To||Repair.some(C=>C.startSample<From&&C.endSample>From||C.startSample<To&&C.endSample>To))return {...Status(),ackWindowIds:[H.windowId],resolved:false};
   const OldCut=L?L.original.endSample:From,NewCut=R?R.original.startSample:To;
   if(Cues.some(C=>C.startSample<OldCut&&C.endSample>OldCut)||New.some(C=>C.startSample<NewCut&&C.endSample>NewCut))return {...Status(),ackWindowIds:[H.windowId],resolved:false};
   const Joined=[...Cues.filter(C=>C.endSample<=OldCut),...Repair.filter(C=>C.startSample>=From&&C.endSample<=To),...New.filter(C=>C.startSample>=NewCut)];
   if(!Ordered(Joined))return {...Status(),ackWindowIds:[H.windowId],resolved:false};Cues=Joined;
   CommittedEnd=Boundary;Previous=Right;End=Right.diagnostics.coreEndSample;Pending=null;
   return {...Status([Right.windowId,H.windowId]),resolved:true};
  },
  seal(){if(Pending)return {unresolved:true,...Status()};CommittedEnd=End;const Atomic=CorrectCaptionOverlaps(Cues.map(C=>({...C,sourceStartSample:C.sourceStartSample??C.startSample,sourceEndSample:C.sourceEndSample??C.endSample}))),Corrected=CorrectCaptionOverlaps(Assemble(Atomic.cues));return {unresolved:false,cues:Corrected.cues,coverage:UnionCaptionSpans(OriginalSpans),language:Language,...Status(),warningCount:WarningCount+Atomic.warnings+Corrected.warnings};},
  snapshot(){return {cues:Cues,committedSpans:Committed(),committedEndSample:CommittedEnd,recognitionStartSample:Origin,sourceEndSample:End,pending:!!Pending,language:Language};},
 };
}
