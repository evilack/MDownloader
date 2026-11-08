import test from 'node:test';import assert from 'node:assert/strict';import {PreviewPassed} from '../tools/lib/preview-acceptance.mjs';
test('native preview acceptance requires moving decoded frames and complete lifetime cleanup',()=>{
 const clean={open:false,players:0,loading:0};const good={url:'https://www.youtube.com/watch?v=FACJInvEmY8',sourceBefore:{page:'https://www.youtube.com/watch?v=FACJInvEmY8',time:1,frames:30,paused:false,adShowing:false},sourceAfter:{time:4,frames:120,paused:false,adShowing:false},previewBefore:{exists:true,ready:4,failed:false,frames:3},previewAfter:{frames:20,failed:false},closed:clean,fastClose:clean,navigation:clean};
 assert.equal(PreviewPassed(good),true);
 for(const[field,value]of[['previewAfter',{...good.previewAfter,failed:true}],['sourceAfter',{...good.sourceAfter,adShowing:true}],['closed',{...clean,loading:1}],['fastClose',{...clean,players:1}],['navigation',{...clean,open:true}],['previewAfter',{frames:3,failed:false}]])assert.equal(PreviewPassed({...good,[field]:value}),false,field);
});
