import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateCaptionWindowMerger} from '../extension/lib/caption-window-merge.js';
import {CaptionCueSource} from '../extension/lib/caption-timing-correction.js';
const s=n=>Math.round(n*16000);
const h=(id,start,end,coreStart,coreEnd,text,words)=>({windowId:id,revision:1,language:'en',coverage:{epoch:0,startSample:s(start),endSample:s(end)},diagnostics:{epoch:0,coreStartSample:s(coreStart),coreEndSample:s(coreEnd)},cues:[{startSample:s(start+1),endSample:s(end-.1),text}],words:words.map(([a,b,text])=>({startSample:s(a),endSample:s(b),text,segmentIndex:0}))});
test('long sentences merge at real aligned words without requiring a whole sentence inside overlap',()=>{
 const merger=CreateCaptionWindowMerger();
 merger.accept(h('left',0,28,0,26,'Opening a sentence that continues past the boundary.',[[1,2,'Opening'],[23,24,' a sentence'],[24.5,25,' that'],[25,25.5,' continues'],[26,26.5,' past'],[27,27.8,' the boundary.']]));
 const result=merger.accept(h('right',24,54,26,52,'that continues past the boundary. Next sentence.',[[24.5,25,'that'],[25,25.5,' continues'],[26,26.5,' past'],[27,27.8,' the boundary.'],[30,31,' Next sentence.']]));
 assert.equal(result.repair,null);
 const output=merger.seal();assert.equal(output.unresolved,false);
 assert.equal(output.cues.map(c=>c.text).join(' '),'Opening a sentence that continues past the boundary. Next sentence.');
 assert.equal(output.cues.length,2);
});
test('real repeated words remain and punctuation-only variation does not duplicate the boundary word',()=>{
 const merger=CreateCaptionWindowMerger();
 merger.accept(h('left',0,28,0,26,'Yes yes. Continue now!',[[20,21,'Yes'],[22,23,' yes.'],[24.2,24.7,' Continue'],[25,25.5,' now!']]));
 const result=merger.accept(h('right',24,54,26,52,'Continue now. Next.',[[24.2,24.7,'Continue'],[25,25.5,' now.'],[30,31,' Next.']]));
 assert.equal(result.repair,null);
 const text=merger.seal().cues.map(c=>c.text).join(' ');
 assert.match(text,/Yes yes\./);assert.equal((text.match(/Continue/g)||[]).length,1);assert.equal((text.match(/now/g)||[]).length,1);
});
test('ambiguous repeated anchors are corrected with a warning while keeping both utterances',()=>{
 const merger=CreateCaptionWindowMerger();
 merger.accept(h('left',0,28,0,26,'Yes yes',[[24.5,25.5,'Yes'],[25,26,' yes']]));
 const result=merger.accept(h('right',24,54,26,52,'Yes yes',[[24.8,25.8,'Yes'],[25.3,26.3,' yes']]));
 assert.equal(result.repair,null);assert.ok(result.warningCount>0);const output=merger.seal();assert.equal(output.unresolved,false);assert.equal(output.cues.map(C=>C.text).join(' '),'Yes yes');
});
test('zero-duration punctuation and CJK text are preserved within their original sentence',()=>{
 const merger=CreateCaptionWindowMerger();
 merger.accept(h('left',0,28,0,26,'「你好！」',[[1,1,'「'],[1,2,'你'],[2,3,'好'],[3,3,'！」']]));
 const output=merger.seal();assert.equal(output.cues.length,1);assert.equal(output.cues[0].text,'「你好！」');assert.equal(output.cues[0].startSample,s(1));assert.equal(output.cues[0].endSample,s(3));
});
test('a sentence with no positive-duration alignment is rejected without fabricating word times',()=>{
 const merger=CreateCaptionWindowMerger();
 assert.throws(()=>merger.accept(h('left',0,28,0,26,'hello',[[1,1,'hello']])),/caption_alignment_missing/);
});
test('opposite boundary drift cannot discard both estimates of an utterance',()=>{
 const merger=CreateCaptionWindowMerger();
 merger.accept(h('left',0,28,0,26,'hello',[[25.8,26.4,'hello']]));
 const status=merger.accept(h('right',24,54,26,52,'hallo',[[25.6,26.2,'hallo']]));
 assert.equal(status.repair,null);const output=merger.seal();
 assert.equal(output.unresolved,false);assert.ok(output.warningCount>0);assert.equal(output.cues.length,1);assert.equal(output.cues[0].text,'hello');
});
test('reversed zero-duration punctuation preserves the entire original word source bounds',()=>{
 for(const words of [[[1.5,1.5,'「'],[1.2,1.4,'A']],[[1.2,1.4,'A'],[1.1,1.1,'!']]]){
  const merger=CreateCaptionWindowMerger(),H=h('left',0,28,0,26,'punctuation',words);merger.accept(H);const [Cue]=merger.seal().cues,Source=CaptionCueSource(Cue,H);
  assert.equal(Cue.sourceStartSample,Source.startSample);assert.equal(Cue.sourceEndSample,Source.endSample);assert.equal(Cue.text,Source.text);
 }
});
test('reversed start times are corrected as output metadata while retaining original text order',()=>{
 const merger=CreateCaptionWindowMerger();merger.accept(h('left',0,28,0,26,'A B',[[10,12,'A'],[9,11,' B']]));
 const output=merger.seal();assert.equal(output.unresolved,false);assert.equal(output.cues.map(C=>C.text).join(' '),'A B');
 assert.ok(output.warningCount>0);
});
