import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CreateCandidateDownloadActions} from '../extension/candidate-download.js';
import {CreateCandidateRow} from '../extension/candidate-row.js';
import {Translate} from '../extension/lib/i18n.js';

class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.events={};this.classList={add(){},toggle(){}};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key] ?? null;}
 addEventListener(key,handler){this.events[key]=handler;}
}
function fixture(t,send,wait=async()=>{},current=()=>true,makeOptions=()=>assert.fail('job controls must not open download options')) {
 globalThis.document={createElement:tag=>new Element(tag)};
 const messages=[],announcements=[];
 globalThis.chrome={runtime:{sendMessage:async message=>{messages.push(message);return send ? send(message) : {ok:true,data:{state:'started'}};}}};
 t.after(()=>{delete globalThis.document;delete globalThis.chrome;});
 const actions=CreateCandidateDownloadActions(value=>announcements.push(value),()=>{},wait,makeOptions);
 const candidate={name:'broadcast.m3u8',format:'M3U8',live:true};
 const button=actions.CreateDownloadButton(candidate,{tabId:8,scanId:'scan',candidateId:0},current);
 const entry=CreateCandidateRow(candidate,{thumbnail:{control:new Element('button')},download:button});
 return {button,entry,messages,announcements,actions};
}
const Live={requestId:'live-job',state:'active',live:true,hls:true,snapshotAvailable:true,bytesReceived:1000};

test('a live candidate replaces download with stop/save and controls its job even on Shift-click',async t=>{
 const h=fixture(t,undefined,()=>assert.fail('a job control does not depend on a current scan'));
 h.entry.update(Live);
 assert.equal(h.button.disabled,false);
 assert.equal(h.button.title,Translate('view_action_finish'));
 assert.equal(h.button.getAttribute('aria-label'),Translate('view_action_finish'));
 assert.equal(h.button.children[0].src,'icons/stop-save.png');
 await h.button.events.click({shiftKey:true});
 assert.deepEqual(h.messages,[{type:'control',requestId:'live-job',action:'finish'}]);
 assert.equal(h.button.disabled,true,'an accepted stop must stay locked until the worker changes state');
 h.entry.update({...Live,bytesReceived:2000});
 await h.button.events.click({});
 assert.equal(h.messages.length,1,'a stale active snapshot must not resend stop');
 h.entry.update({...Live,state:'complete'});
 assert.equal(h.button.disabled,false);
 assert.equal(h.button.title,Translate('view_download'));
 assert.equal(h.button.children[0].src,'icons/download.png');
});

test('ordinary active, paused and starting downloads become cancel rather than stop/save',async t=>{
 const h=fixture(t);
 for(const [index,fields] of [{hls:true,snapshotAvailable:true},{downloadId:3},{youtube:true,snapshotAvailable:true},{state:'paused',downloadId:3},{state:'starting'},
  {youtube:true,waiting:true,live:false}].entries()) {
  const job={requestId:'ordinary-'+index,state:'active',bytesReceived:100,...fields};
  h.entry.update(job);
  assert.equal(h.button.disabled,false);
  assert.equal(h.button.title,Translate('view_action_cancel'));
  assert.equal(h.button.children[0].src,'icons/cancel.png');
  await h.button.events.click({});
  assert.deepEqual(h.messages.at(-1),{type:'control',requestId:job.requestId,action:'cancel'});
  h.entry.update({...job,state:'canceled'});
  assert.equal(h.button.title,Translate('view_download'));
  assert.equal(h.button.disabled,false);
 }
});

test('live stop/save obeys the same readiness and transition guards as the manager',async t=>{
 const h=fixture(t);
 for(const fields of [{snapshotAvailable:false},{muxing:true},{saving:true},{downloadId:2},{pendingAction:'finish'},{state:'starting'}]) {
  h.entry.update({...Live,...fields});
  assert.equal(h.button.title,Translate('view_action_finish'));
  assert.equal(h.button.disabled,true,JSON.stringify(fields));
  await h.button.events.click({});
 }
 assert.equal(h.messages.length,0);
 h.entry.update(Live);
 assert.equal(h.button.disabled,false);
});

test('enqueue reply cannot restore the download label over a live job snapshot',async t=>{
 const accepted=Promise.withResolvers(),sent=Promise.withResolvers();
 const h=fixture(t,async message=>{sent.resolve();return accepted.promise;});
 const click=h.button.events.click({});
 await sent.promise;
 h.entry.update(Live);
 accepted.resolve({ok:true,data:{state:'started'}});
 await click;
 assert.equal(h.button.disabled,false);
 assert.equal(h.button.title,Translate('view_action_finish'));
 assert.equal(h.button.children[0].src,'icons/stop-save.png');
});

test('control failure unlocks the correct action and a later click targets the newest job',async t=>{
 let failed=true;
 const h=fixture(t,async()=>failed ? {ok:false,error:{key:'job_busy'}} : {ok:true});
 h.entry.update(Live);
 await h.button.events.click({});
 assert.equal(h.button.disabled,false);
 assert.equal(h.button.title,Translate('view_action_finish'));
 assert.ok(h.announcements.length);
 failed=false;
 h.entry.update({...Live,requestId:'newest-job',live:false});
 await h.button.events.click({});
 assert.deepEqual(h.messages.at(-1),{type:'control',requestId:'newest-job',action:'cancel'});
});

test('visible running jobs remain controllable while their candidate scan generation changes',async t=>{
 const h=fixture(t,undefined,()=>assert.fail('control must not wait for scanning'),()=>false);
 h.entry.update(Live);
 await h.button.events.click({});
 assert.deepEqual(h.messages,[{type:'control',requestId:'live-job',action:'finish'}]);
});

test('another candidate preparing download options does not block a running job control',async t=>{
 const opened=Promise.withResolvers(),selection=Promise.withResolvers();
 const h=fixture(t,undefined,async()=>{},()=>true,()=>({openInline:async()=>{opened.resolve();return selection.promise;}}));
 const other=h.actions.CreateDownloadButton({format:'M3U8'},{candidateId:1},()=>true,()=>({container:{},dispose(){}}));
 h.entry.update(Live);
 const preparing=other.events.click({shiftKey:true});
 await opened.promise;
 await h.button.events.click({});
 selection.resolve(null);await preparing;
 assert.deepEqual(h.messages,[{type:'control',requestId:'live-job',action:'finish'}]);
});
