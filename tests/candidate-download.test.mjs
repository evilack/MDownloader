import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CreateCandidateDownloadActions} from '../extension/candidate-download.js';

function harness(t, selection, wait=async()=>{}, format='M3U8') {
 class Node { constructor(){this.events={};this.classList={add(){}};} addEventListener(n,fn){this.events[n]=fn;} replaceChildren(){} setAttribute(){} }
 globalThis.document={createElement:()=>new Node()};
 const sent=[]; globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async m=>{sent.push(m);return {ok:true,data:m.type==='youtubeQualities'?[{quality:{videoId:'abcdefghijk',selection:{videoFormatId:'best'}}}]:{state:'started'}};}}};
 t.after(()=>{delete globalThis.document;delete globalThis.chrome;});
 let opened=0,closed=0; const options={open:async()=>{opened++;return selection;},close:()=>closed++};
 const actions=CreateCandidateDownloadActions(()=>{},()=>{},wait,()=>options);
 return {actions,sent,button:actions.CreateDownloadButton({format},{tabId:1,scanId:'scan',candidateId:1},()=>true),opened:()=>opened,closed:()=>closed};
}
test('Shift-click opens download options and sends selected quality and subtitles to enqueue',async t=>{
 const selection={quality:{url:'https://cdn.test/low.m3u8'},subtitleOptions:{trackIds:['track'],translation:{enabled:false}}};
 const h=harness(t,selection);await h.button.events.click({shiftKey:true});
 assert.equal(h.opened(),1);assert.equal(h.sent.length,1);assert.equal(h.sent[0].variantUrl,selection.quality.url);assert.deepEqual(h.sent[0].subtitleOptions,selection.subtitleOptions);assert.equal(h.button.disabled,false);
});
test('normal click keeps quick download without creating an options dialog',async t=>{
 const h=harness(t,null);await h.button.events.click({shiftKey:false});assert.equal(h.opened(),0);assert.equal(h.sent[0].type,'enqueue');assert.equal(h.sent[0].subtitleOptions,undefined);
});
test('normal YouTube click resolves its first quality without showing download options',async t=>{
 const h=harness(t,null,undefined,'YOUTUBE');await h.button.events.click({shiftKey:false});assert.equal(h.opened(),0);assert.equal(h.sent[1].quality.selection.videoFormatId,'best');
});
test('canceling options never enqueues a download',async t=>{
 const h=harness(t,null);await h.button.events.click({shiftKey:true});assert.equal(h.opened(),1);assert.equal(h.sent.length,0);h.actions.CloseQuality();assert.equal(h.closed(),1);
});
test('waits for a scan before opening options and prevents simultaneous requests',async t=>{
 const pending=Promise.withResolvers(),h=harness(t,null,()=>pending.promise);const first=h.button.events.click({shiftKey:true});await h.button.events.click({shiftKey:true});assert.equal(h.opened(),0);pending.resolve();await first;assert.equal(h.opened(),1);assert.equal(h.actions.IsBusy(),false);
});
test('WebRTC sends its server quality without treating it as a variant URL',async t=>{
 const selection={quality:{name:'source',session:'session'},subtitleOptions:{trackIds:[],translation:{enabled:false}}},h=harness(t,selection,undefined,'WEBRTC');
 await h.button.events.click({shiftKey:true});assert.deepEqual(h.sent[0].quality,{name:'source',session:'session'});assert.equal(h.sent[0].variantUrl,undefined);
});
test('scheduled YouTube quality preserves the scheduled request without inventing subtitle options',async t=>{
 const quality={scheduled:true,videoId:'abcdefghijk'},h=harness(t,{quality:{scheduled:true,quality}},undefined,'YOUTUBE');
 await h.button.events.click({shiftKey:true});assert.deepEqual(h.sent[0].quality,quality);assert.equal(h.sent[0].subtitleOptions,undefined);
});
