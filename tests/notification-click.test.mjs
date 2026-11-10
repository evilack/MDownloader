import test from 'node:test';
import assert from 'node:assert/strict';

test('desktop notification clicks reveal their saved file through the background worker',async t=>{
 const id='44444444-4444-4444-4444-444444444444',folderKey='55555555-5555-5555-5555-555555555555';
 const local={},shown=[],cleared=[],native=[];let clicked;
 const passive={addListener(){}},area={get:async key=>({[key]:local[key]}),set:async values=>Object.assign(local,values)};
 globalThis.chrome={
  runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,getPlatformInfo:async()=>({os:'win'}),onConnect:passive,onMessage:passive,
   connectNative(host){let receive;return{onMessage:{addListener(f){receive=f;}},onDisconnect:passive,disconnect(){},postMessage(message){native.push({host,message});queueMicrotask(()=>receive({ok:true}));}};}},
  notifications:{onClicked:{addListener(f){clicked=f;}},clear:async id=>{cleared.push(id);return true;}},
  downloads:{onChanged:passive,search:async({id})=>id===7?[{id:7,byExtensionId:'test',state:'complete',exists:true,filename:'C:/Downloads/영상 #1.mp4'}]:[],show:id=>shown.push(id)},
  permissions:{contains:async()=>true,onRemoved:passive},
  storage:{local:area,session:area,onChanged:passive},
  tabs:{onRemoved:passive,onUpdated:passive,onActivated:passive,create:()=>assert.fail('notification must reveal the file directly')},
  webRequest:{onHeadersReceived:passive,onBeforeRequest:passive},
 };
 const file=new Blob(['media']),folder={name:'Saved videos',queryPermission:async()=> 'granted',getFileHandle:async name=>{assert.equal(name,'영상 #1.mp4');return{getFile:async()=>file};}};
 globalThis.indexedDB={open(){const request={result:{close(){},transaction(){const transaction={objectStore:()=>({get(key){assert.equal(key,folderKey);const operation={result:folder};queueMicrotask(()=>transaction.oncomplete());return operation;}})};return transaction;}}};queueMicrotask(()=>request.onsuccess());return request;}};
 t.after(()=>{delete globalThis.chrome;delete globalThis.indexedDB;});
 await import('../extension/background.js');
 assert.equal(typeof clicked,'function','worker must register the notification click listener at startup');
 await t.test('browser downloads resolve stored IDs even when the notification predates worker startup',async()=>{
  local['job:'+id]={requestId:id,state:'started',downloadId:7};
  await clicked('mdownloader:complete:'+id);
  assert.deepEqual(shown,[7]);assert.deepEqual(cleared,['mdownloader:complete:'+id]);
 });
 await t.test('picked-folder files use the existing native Explorer bridge',async()=>{
  local['job:'+id]={requestId:id,state:'complete',exists:true,pickedDownloadFolder:folderKey,filename:'영상 #1.mp4'};
  await clicked('mdownloader:complete:'+id);
  assert.equal(native.length,1);assert.equal(native[0].message.action,'reveal');assert.equal(native[0].message.folderKey,folderKey);assert.equal(native[0].message.filename,'영상 #1.mp4');
 });
 await t.test('unrelated notifications, deleted jobs and unavailable files open nothing',async()=>{
  const count=cleared.length;
  await clicked('other:complete:'+id);await clicked('mdownloader:invalid:'+id);
  delete local['job:'+id];await clicked('mdownloader:complete:'+id);
  local['job:'+id]={requestId:id,state:'started',downloadId:99};await clicked('mdownloader:complete:'+id);
  local['job:'+id]={requestId:id,state:'active',pickedDownloadFolder:folderKey,filename:'영상 #1.mp4'};await clicked('mdownloader:start:'+id);
  assert.deepEqual(shown,[7]);assert.equal(native.length,1);assert.equal(cleared.length,count);
 });
});
