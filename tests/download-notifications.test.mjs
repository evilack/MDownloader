import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateDownloadNotifications, ShouldNotifyCompletion} from '../extension/lib/download-notifications.js';
const root='chrome-extension://'+'a'.repeat(32)+'/',popup={contextType:'POPUP',documentId:'popup-doc',documentUrl:root+'popup.html'},panel={contextType:'SIDE_PANEL',documentId:'panel-doc',documentUrl:root+'sidepanel.html'};
test('completion visibility matches the side-panel/popup/item matrix',()=>{
 const shown={'popup-doc':{visible:true,requestIds:['one']}};
 for(const [contexts,views,id,expected]of[[[],{},'one',true],[[popup],{},'one',true],[[popup],shown,'one',false],[[popup],shown,'other',true],[[panel],{},'one',false],[[panel,popup],shown,'other',false],[[],shown,'one',true],[[{...popup,contextType:'TAB'}],shown,'one',true],[[popup],{'popup-doc':{visible:false,requestIds:['one']}},'one',true]])assert.equal(ShouldNotifyCompletion(id,contexts,views,root),expected);
});
function fixture(t){
 const local={notifyDownloadComplete:true,notifyScheduledStart:true},session={},items=new Map(),sent=[];let contexts=[],granted=true,fail=false;
 const area=data=>({get:async keys=>keys==null?{...data}:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),getKeys:async()=>Object.keys(data),set:async v=>Object.assign(data,v),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}});
 globalThis.chrome={storage:{local:area(local),session:area(session)},runtime:{id:'a'.repeat(32),getURL:p=>root+p,getContexts:async()=>contexts},permissions:{contains:async()=>granted},downloads:{search:async({id})=>items.has(id)?[items.get(id)]:[]},notifications:{getPermissionLevel:async()=>granted?'granted':'denied',create:async(id,options)=>{if(fail)throw Error('OS unavailable');sent.push({id,...options});return id;}}};t.after(()=>delete globalThis.chrome);
 const controller=()=>CreateDownloadNotifications({waitForUi:async()=>{},initializeLocale:async()=>{}});const api=controller();
 async function change(id,next){const oldValue=local['job:'+id];if(next)local['job:'+id]={requestId:id,filename:id+'.mp4',...next};else delete local['job:'+id];await api.storageChanged({['job:'+id]:{oldValue,newValue:local['job:'+id]}},'local');}
 return{local,session,items,sent,api,controller,change,setContexts:v=>contexts=v,setGranted:v=>granted=v,setFailure:v=>fail=v};
}
test('picked-folder completion notifies once, including after worker restart',async t=>{
 const f=fixture(t);await f.change('one',{state:'active',pickedDownloadFolder:'folder'});await f.change('one',{state:'complete',pickedDownloadFolder:'folder',bytesReceived:30});assert.equal(f.sent.length,1);assert.equal(f.sent[0].message,'one.mp4');
 await f.controller().storageChanged({'job:one':{newValue:f.local['job:one']}},'local');assert.equal(f.sent.length,1);
});
test('suppression is consumed and does not become a stale alert when the panel closes',async t=>{
 const f=fixture(t);f.setContexts([panel]);await f.change('one',{state:'complete',pickedDownloadFolder:'folder'});f.setContexts([]);await f.api.storageChanged({'job:one':{newValue:f.local['job:one']}},'local');assert.equal(f.sent.length,0);
});
test('only live authenticated popup connections suppress represented requests, even without sender documentId',async t=>{
 const f=fixture(t);f.setContexts([popup]);let incoming,disconnect;const port=sender=>({name:'mdownloader-notification-view',sender,onMessage:{addListener(F){incoming=F;}},onDisconnect:{addListener(F){disconnect=F;}},postMessage(){}});
 assert.equal(f.api.connectView(port({id:chrome.runtime.id,url:'https://evil.test'})),false);
 assert.equal(f.api.connectView(port({id:chrome.runtime.id,url:root+'popup.html'})),true);incoming({visible:true,requestIds:['one','two'],serial:1});
 await f.change('one',{state:'complete',pickedDownloadFolder:'folder'});assert.equal(f.sent.length,0);disconnect();await f.change('two',{state:'complete',pickedDownloadFolder:'folder'});assert.equal(f.sent.length,1);assert.equal(f.sent[0].message,'two.mp4');
});
test('scheduled metadata/zero bytes do not alert; actual first bytes alert once even with the panel open',async t=>{
 const f=fixture(t);f.setContexts([panel]);await f.change('one',{state:'active',scheduled:true,waiting:true,bytesReceived:0});await f.change('one',{state:'active',scheduled:true,waiting:false,bytesReceived:0});assert.equal(f.sent.length,0);
 await f.change('one',{state:'active',scheduled:true,waiting:false,bytesReceived:10});await f.change('one',{state:'active',scheduled:true,waiting:false,bytesReceived:20});assert.equal(f.sent.length,1);assert.match(f.sent[0].id,/start/);
 await f.change('snapshot',{state:'active',scheduled:true,snapshot:true,waiting:false,bytesReceived:10});assert.equal(f.sent.length,1,'a partial output is not a new scheduled start');
});
test('waiting identity survives legacy jobs clearing waiting before positive progress',async t=>{
 const f=fixture(t);await f.change('one',{state:'active',waiting:true,bytesReceived:0});await f.change('one',{state:'active',waiting:false,bytesReceived:0});await f.change('one',{state:'active',waiting:false,bytesReceived:50});assert.equal(f.sent.length,1);
});
test('native complete before download-ID binding is recovered and duplicate native events ignored',async t=>{
 const f=fixture(t);f.items.set(7,{id:7,byExtensionId:chrome.runtime.id,state:'complete',filename:'C:\\Downloads\\real.mp4',mime:'video/mp4'});await f.api.downloadChanged({id:7,state:{current:'complete'}});assert.equal(f.sent.length,0);
 await f.change('one',{state:'started',downloadId:7});assert.equal(f.sent.length,1);assert.equal(f.sent[0].message,'real.mp4');await f.api.downloadChanged({id:7,state:{current:'complete'}});assert.equal(f.sent.length,1);
});
test('foreign downloads, HTML saves and failed/canceled/interrupted jobs never report success',async t=>{
 const f=fixture(t);for(const state of['active','failed','canceled','interrupted'])await f.change(state,{state,pickedDownloadFolder:'folder'});
 f.items.set(4,{id:4,byExtensionId:'other',state:'complete',filename:'foreign.mp4'});await f.change('foreign',{state:'started',downloadId:4});await f.api.downloadChanged({id:4,state:{current:'complete'}});
 f.items.set(5,{id:5,byExtensionId:chrome.runtime.id,state:'complete',filename:'error.mp4',mime:'text/html'});await f.change('html',{state:'started',downloadId:5});assert.equal(f.sent.length,0);
});
test('disabled/denied options and notification failure do not replay or break later events',async t=>{
 const f=fixture(t);f.local.notifyDownloadComplete=false;await f.change('disabled',{state:'complete',pickedDownloadFolder:'folder'});f.local.notifyDownloadComplete=true;f.setGranted(false);await f.change('denied',{state:'complete',pickedDownloadFolder:'folder'});f.setGranted(true);f.setFailure(true);await f.change('failed-api',{state:'complete',pickedDownloadFolder:'folder'});f.setFailure(false);await f.change('ok',{state:'complete',pickedDownloadFolder:'folder'});assert.equal(f.sent.length,1);
});
test('updating an existing completed history entry is not a fresh completion',async t=>{
 const f=fixture(t);f.local['job:old']={requestId:'old',state:'complete',pickedDownloadFolder:'folder',filename:'old.mp4'};
 await f.change('old',{state:'complete',pickedDownloadFolder:'folder',filename:'renamed.mp4'});assert.equal(f.sent.length,0);
 f.local['job:legacy']={requestId:'legacy',state:'complete',pickedDownloadFolder:'folder',waiting:true,bytesReceived:0};
 await f.change('legacy',{state:'complete',pickedDownloadFolder:'folder',waiting:false,bytesReceived:100});assert.equal(f.sent.length,0);
 f.local['job:native-history']={requestId:'native-history',state:'started',downloadId:19,waiting:true,bytesReceived:0};
 f.items.set(19,{id:19,byExtensionId:chrome.runtime.id,state:'complete',filename:'old-native.mp4',mime:'video/mp4'});
 await f.change('native-history',{state:'started',downloadId:19,waiting:false,bytesReceived:100});assert.equal(f.sent.length,0);
});
