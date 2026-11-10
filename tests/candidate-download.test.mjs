import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CreateCandidateDownloadActions} from '../extension/candidate-download.js';

function harness(t, selection, wait=async()=>{}, format='M3U8') {
 class Node { constructor(){this.events={};this.dataset={};this.classList={add(){},toggle(){}};} addEventListener(n,fn){this.events[n]=fn;} replaceChildren(){} setAttribute(){} }
 globalThis.document={createElement:()=>new Node()};
 const sent=[]; globalThis.chrome={permissions:{request:async()=>true},runtime:{sendMessage:async m=>{sent.push(m);return {ok:true,data:m.type==='youtubeQualities'?[{quality:{videoId:'abcdefghijk',selection:{videoFormatId:'best'}}}]:{state:'started'}};}}};
 t.after(()=>{delete globalThis.document;delete globalThis.chrome;});
 let opened=0,closed=0,disposed=0; const options={open:async()=>{throw Error('Modal must not be used by candidate actions');},openInline:async()=>{opened++;return selection;},close:()=>closed++};
 const actions=CreateCandidateDownloadActions(()=>{},()=>{},wait,()=>options);
 return {actions,sent,button:actions.CreateDownloadButton({format},{tabId:1,scanId:'scan',candidateId:1},()=>true,()=>({container:{},dispose(){disposed++;}})),opened:()=>opened,closed:()=>closed,disposed:()=>disposed};
}
test('Shift-click opens download options and sends selected quality and subtitles to enqueue',async t=>{
 const selection={quality:{url:'https://cdn.test/low.m3u8'},subtitleOptions:{trackIds:['track'],translation:{enabled:false}}};
 const h=harness(t,selection);await h.button.events.click({shiftKey:true});
 assert.equal(h.opened(),1);assert.equal(h.sent.length,1);assert.equal(h.sent[0].variantUrl,selection.quality.url);assert.deepEqual(h.sent[0].subtitleOptions,selection.subtitleOptions);assert.equal(h.button.disabled,true);
});
test('normal click downloads immediately without opening any options',async t=>{
 const h=harness(t,null);await h.button.events.click({shiftKey:false});assert.equal(h.opened(),0);assert.equal(h.sent.length,1);assert.equal(h.sent[0].type,'enqueue');assert.equal(h.sent[0].subtitleOptions,undefined);assert.equal(h.disposed(),0);
});

test('selected HLS live start reaches enqueue with the chosen rendition',async t=>{
 const h=harness(t,{liveStart:'current',quality:{url:'https://cdn.test/live.m3u8'}});
 await h.button.events.click({shiftKey:true});assert.equal(h.sent[0].liveStart,'current');assert.equal(h.sent[0].variantUrl,'https://cdn.test/live.m3u8');
});
test('normal YouTube click resolves its default quality without opening options',async t=>{
 const quality={quality:{videoId:'abcdefghijk',selection:{videoFormatId:'chosen'}}};
 const h=harness(t,{quality},undefined,'YOUTUBE');await h.button.events.click({shiftKey:false});assert.equal(h.opened(),0);assert.equal(h.sent[0].type,'youtubeQualities');assert.equal(h.sent[1].quality.selection.videoFormatId,'best');
});
test('canceling options never enqueues a download',async t=>{
 const h=harness(t,null);await h.button.events.click({shiftKey:true});assert.equal(h.opened(),1);assert.equal(h.sent.length,0);h.actions.CloseQuality();assert.equal(h.closed(),1);
 assert.equal(h.disposed(),1,'inline placement is removed even on cancellation');
 assert.equal(h.button.disabled,false);
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
test('enqueue failure unlocks the download button for retry',async t=>{
 const h=harness(t,null);chrome.runtime.sendMessage=async()=>{throw new Error('enqueue failed');};
 await h.button.events.click({shiftKey:false});assert.equal(h.button.disabled,false);assert.equal(h.actions.IsBusy(),false);
});
test('permission denial unlocks the download button without starting a job',async t=>{
 const h=harness(t,null,undefined,'YOUTUBE');chrome.permissions.request=async()=>false;
 await h.button.events.click({shiftKey:false});assert.equal(h.button.disabled,false);assert.equal(h.sent.length,0);
});
test('a terminal enqueue result unlocks the button before the job feed refreshes',async t=>{
 const h=harness(t,null);
 for(const state of ['failed','canceled','complete']) {
  chrome.runtime.sendMessage=async()=>({ok:true,data:{state}});
  await h.button.events.click({shiftKey:false});assert.equal(h.button.disabled,false,state);
 }
});
