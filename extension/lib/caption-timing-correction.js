/** Output subtitle correction; never changes decoded PCM or its source clock. */
export function CorrectCaptionOverlaps(Input){
 const Cues=[];let warnings=0;
 for(const Original of Input){
  const Cue={...Original},Previous=Cues.at(-1);
  if(Previous&&Previous.epoch===Cue.epoch&&Cue.startSample<Previous.endSample){
   const Low=Math.max(Previous.startSample+1,Cue.startSample),High=Math.min(Previous.endSample,Cue.endSample-1);warnings++;
   if(Low<=High){const Boundary=Math.max(Low,Math.min(High,Math.round((Previous.endSample+Cue.startSample)/2)));Previous.endSample=Boundary;Cue.startSample=Boundary;}
   else{
    const Parts=[...(Previous.parts||[{...Previous}]),...(Cue.parts||[{...Cue}])];
    Cues[Cues.length-1]={...Previous,startSample:Math.min(Previous.startSample,Cue.startSample),endSample:Math.max(Previous.endSample,Cue.endSample),text:Parts.map(P=>P.text).join('\n'),parts:Parts};continue;
   }
  }
  Cues.push(Cue);
 }
 return {cues:Cues,warnings};
}
export function CaptionCueRecord(Cue){
 const Keys=['startSample','endSample','text','epoch','windowId','revision','cueIndex','firstWordIndex','lastWordIndex','sourceStartSample','sourceEndSample'];
 return {...Object.fromEntries(Keys.filter(K=>Cue[K]!==undefined).map(K=>[K,Cue[K]])),...(Cue.parts?{parts:Cue.parts.map(CaptionCueRecord)}:{})};
}
/** Validate selected text against immutable inference, including partial words. */
export function CaptionCueSource(Cue,Hypothesis){
 const Original=Hypothesis.cues[Cue.cueIndex];if(!Original)throw Error('caption_result_conflict');
 if(Cue.firstWordIndex!==undefined||Cue.lastWordIndex!==undefined){
  const A=Cue.firstWordIndex,B=Cue.lastWordIndex;
  if(!Array.isArray(Hypothesis.words)||!Number.isSafeInteger(A)||!Number.isSafeInteger(B)||A<0||B<A||B>=Hypothesis.words.length)throw Error('caption_result_conflict');
  const Words=Hypothesis.words.slice(A,B+1);if(Words.some(W=>W.segmentIndex!==Cue.cueIndex))throw Error('caption_result_conflict');
  return {startSample:Math.min(...Words.map(W=>W.startSample)),endSample:Math.max(...Words.map(W=>W.endSample)),text:Words.map(W=>W.text).join('').trim(),keys:Words.map((_,I)=>'word:'+(A+I))};
 }
 return {...Original,text:Original.text.trim(),keys:['cue:'+Cue.cueIndex]};
}
