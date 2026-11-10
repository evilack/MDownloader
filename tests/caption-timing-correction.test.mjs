import test from 'node:test';
import assert from 'node:assert/strict';
import {CorrectCaptionOverlaps,CaptionCueSource,CaptionCueRecord} from '../extension/lib/caption-timing-correction.js';
test('overlapping subtitle times are corrected and warned without changing original inference',()=>{
 const source=[{startSample:0,endSample:20,text:'first',epoch:0},{startSample:10,endSample:30,text:'second',epoch:0}];
 const corrected=CorrectCaptionOverlaps(source);assert.equal(corrected.warnings,1);assert.equal(corrected.cues[0].endSample,corrected.cues[1].startSample);assert.deepEqual(source.map(C=>[C.startSample,C.endSample]),[[0,20],[10,30]]);
 assert.deepEqual(corrected.cues.map(C=>C.text),['first','second']);assert.equal(CorrectCaptionOverlaps(corrected.cues).warnings,0);
});
test('indivisible one-sample overlaps retain both texts and their source records',()=>{
 const result=CorrectCaptionOverlaps([{startSample:0,endSample:1,text:'first',epoch:0,windowId:'a'},{startSample:0,endSample:1,text:'second',epoch:0,windowId:'b'}]);
 assert.equal(result.warnings,1);assert.equal(result.cues.length,1);assert.equal(result.cues[0].text,'first\nsecond');assert.deepEqual(CaptionCueRecord(result.cues[0]).parts.map(C=>C.windowId),['a','b']);
});
test('partial sentence provenance uses only the selected contiguous original words',()=>{
 const hypothesis={cues:[{startSample:0,endSample:30,text:' Hello world again'}],words:[{startSample:0,endSample:10,text:' Hello',segmentIndex:0},{startSample:10,endSample:20,text:' world',segmentIndex:0},{startSample:20,endSample:30,text:' again',segmentIndex:0}]};
 const source=CaptionCueSource({cueIndex:0,firstWordIndex:1,lastWordIndex:2},hypothesis);assert.equal(source.text,'world again');assert.equal(source.startSample,10);assert.equal(source.endSample,30);assert.deepEqual(source.keys,['word:1','word:2']);
 assert.throws(()=>CaptionCueSource({cueIndex:0,firstWordIndex:1,lastWordIndex:3},hypothesis),/caption_result_conflict/);
});
