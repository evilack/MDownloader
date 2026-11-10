import {CaptionPolicy} from './concurrent-captions-contract.js';

// A bounded view of current recognition, independent of final subtitle files.
export const LiveCaptionLimits=Object.freeze({cues:64,bytes:32768,text:4096});
const Size=Value=>new TextEncoder().encode(JSON.stringify(Value)).length;
// Keep the authoritative merger intact. Whole cues crossing a replacement cut
// are omitted rather than split into invented word timestamps.
export function ComposeLiveCaptionView(State,Preview,Previous){
 const Spans=State.committedSpans||[],Authoritative=State.cues||[],Frontier=State.sourceEndSample||0;
 const Intersects=(C,S)=>C.epoch===S.epoch&&C.startSample<S.endSample&&C.endSample>S.startSample;
 const Cut=Preview&&{epoch:Preview.epoch,startSample:Preview.inputStartSample,endSample:Preview.inputEndSample};
 // Retain earlier preview speech outside the rolling replacement range until
 // a final core processes it. The frontier also retracts provisional speech
 // when the authoritative result is silent; it does not depend on final cues.
 const Retained=(Previous?.cues||[]).filter(C=>C.provisional===true&&C.startSample>=Frontier&&(!Preview||C.epoch===Preview.epoch)&&(!Cut||!Intersects(C,Cut))&&!Authoritative.some(A=>Intersects(C,A)));
 const Tail=Preview?Preview.cues.filter(C=>!Spans.some(S=>Intersects(C,S))):[];
 const Cues=[...Authoritative.filter(C=>!Cut||!Intersects(C,Cut)||Spans.some(S=>S.epoch===C.epoch&&S.startSample<=C.startSample&&S.endSample>=C.endSample)),...Retained];
 for(const C of Tail)if(!Cues.some(A=>A.epoch===C.epoch&&A.startSample<C.endSample&&A.endSample>C.startSample))Cues.push({...C,provisional:true});
 Cues.sort((A,B)=>A.startSample-B.startSample||A.endSample-B.endSample);
 const Value={...State,cues:Cues,committedSpans:[...Spans],language:State.language&&State.language!=='und'?State.language:Preview?.language||State.language};
 if(Size(Value)>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');return Value;
}
export function BuildLiveCaptionSnapshot(State,Revision,Finished=false){
 const Cues=State.cues||[],Spans=State.committedSpans||[];
 const Value={revision:Revision,language:String(State.language||'und').slice(0,64),finished:Finished,truncated:Cues.length>LiveCaptionLimits.cues,cues:[]};
 for(const Cue of Cues.slice(-LiveCaptionLimits.cues)){
  let Text=Cue.text.slice(0,LiveCaptionLimits.text);
  if(Text.length<Cue.text.length){if(/[\uD800-\uDBFF]$/.test(Text))Text=Text.slice(0,-1);Value.truncated=true;}
  Value.cues.push({startSample:Cue.startSample,endSample:Cue.endSample,epoch:Cue.epoch,text:Text,provisional:!Spans.some(S=>S.epoch===Cue.epoch&&S.startSample<=Cue.startSample&&S.endSample>=Cue.endSample)});
 }
 while(Size(Value)>LiveCaptionLimits.bytes&&Value.cues.length){Value.cues.shift();Value.truncated=true;}
 return ValidateLiveCaptionSnapshot(Value);
}
export function ValidateLiveCaptionSnapshot(Value){
 if(!Value||!Number.isSafeInteger(Value.revision)||Value.revision<1||typeof Value.language!=='string'||Value.language.length>64||typeof Value.finished!=='boolean'||typeof Value.truncated!=='boolean'||!Array.isArray(Value.cues)||Value.cues.length>LiveCaptionLimits.cues||Size(Value)>LiveCaptionLimits.bytes)throw Error('caption_invalid');
 let Previous=-1;
 const Cues=Value.cues.map(C=>{
  if(!C||!Number.isSafeInteger(C.startSample)||C.startSample<0||C.startSample<Previous||!Number.isSafeInteger(C.endSample)||C.endSample<=C.startSample||!Number.isSafeInteger(C.epoch)||C.epoch<0||typeof C.text!=='string'||C.text.length>LiveCaptionLimits.text||typeof C.provisional!=='boolean')throw Error('caption_invalid');
  Previous=C.startSample;return {startSample:C.startSample,endSample:C.endSample,epoch:C.epoch,text:C.text,provisional:C.provisional};
 });
 return {revision:Value.revision,language:Value.language,finished:Value.finished,truncated:Value.truncated,cues:Cues};
}
