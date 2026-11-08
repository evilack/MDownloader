import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{BindDownloadLocation}from'../extension/options-download-location.js';import{InitializeLocale}from'../extension/lib/i18n.js';
class Node{value='';hidden=false;disabled=false;textContent='';handlers=new Map();addEventListener(type,handler){this.handlers.set(type,handler);}setCustomValidity(v){this.validity=v;}reportValidity(){}async fire(type){return this.handlers.get(type)?.({preventDefault(){}});}}
async function setup(t,beforePick){
 const data={downloadFolder:'',pickedDownloadFolder:''},handles=new Map();let permission='granted',fail=false;const handle={name:'Selected videos',queryPermission:async()=>permission};
 globalThis.chrome={storage:{local:{set:async values=>{if(fail)throw Error('write failed');Object.assign(data,values);}}}};globalThis.window={showDirectoryPicker:async()=>handle};
 globalThis.indexedDB={open(){const request={};request.result={close(){},createObjectStore(){},transaction(){const tx={objectStore:()=>({get(key){const op={result:handles.get(key)};queueMicrotask(()=>tx.oncomplete());return op;},add(value,key){handles.set(key,value);const op={result:key};queueMicrotask(()=>tx.oncomplete());return op;}})};return tx;}};queueMicrotask(()=>request.onsuccess());return request;}};
 t.mock.method(globalThis,'fetch',async url=>new Response(await readFile(url)));await InitializeLocale('en');
 const nodes=new Map();globalThis.document={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);}};
 t.after(()=>{for(const k of['chrome','window','document','indexedDB'])delete globalThis[k];});
 await BindDownloadLocation('', '',beforePick);const get=id=>nodes.get('#'+id);return{data,handles,handle,get,setPermission:p=>permission=p,setFail:v=>fail=v,async reload(){nodes.clear();await BindDownloadLocation(data.downloadFolder,data.pickedDownloadFolder);}};
}
test('canceling helper setup never opens the picker or changes the saved folder',async t=>{
 const s=await setup(t,()=>false);window.showDirectoryPicker=()=>assert.fail('canceled setup must not open a directory picker');
 s.data.downloadFolder='existing';s.data.pickedDownloadFolder='existing-key';await s.get('pick-download-folder').fire('click');
 assert.equal(s.data.downloadFolder,'existing');assert.equal(s.data.pickedDownloadFolder,'existing-key');assert.equal(s.handles.size,0);assert.equal(s.get('pick-download-folder').disabled,false);
});
test('select then save and reload preserves the selected directory instead of defaulting',async t=>{
 const s=await setup(t);await s.get('pick-download-folder').fire('click');const key=s.data.pickedDownloadFolder;assert.ok(key);assert.equal(s.get('download-folder').value,'');
 await s.get('download-folder-form').fire('submit');assert.equal(s.data.pickedDownloadFolder,key);assert.equal(s.get('picked-download-folder').hidden,false);
 await s.reload();assert.equal(s.get('picked-download-folder').hidden,false);assert.match(s.get('picked-download-folder').textContent,/Selected videos/);await s.get('download-folder-form').fire('submit');assert.equal(s.data.pickedDownloadFolder,key);
});
test('explicit default reset and nonempty relative path each switch location atomically',async t=>{
 const s=await setup(t);await s.get('pick-download-folder').fire('click');assert.equal(s.get('use-default-download-folder').hidden,false);
 await s.get('use-default-download-folder').fire('click');assert.deepEqual(s.data,{downloadFolder:'',pickedDownloadFolder:''});assert.equal(s.get('picked-download-folder').hidden,true);
 await s.get('pick-download-folder').fire('click');s.get('download-folder').value='Videos/New';await s.get('download-folder-form').fire('submit');assert.deepEqual(s.data,{downloadFolder:'Videos/New',pickedDownloadFolder:''});
});
test('revoked access or a failed settings write never silently clears the selected directory',async t=>{
 const s=await setup(t);await s.get('pick-download-folder').fire('click');const key=s.data.pickedDownloadFolder;s.setPermission('prompt');await s.get('download-folder-form').fire('submit');assert.equal(s.data.pickedDownloadFolder,key);assert.match(s.get('download-folder-status').textContent,/access/i);
 s.setPermission('granted');s.setFail(true);await s.get('use-default-download-folder').fire('click');assert.equal(s.data.pickedDownloadFolder,key);assert.equal(s.get('picked-download-folder').hidden,false);assert.equal(s.get('save-download-folder').disabled,false);
});
test('canceling a later picker preserves the existing selection and re-enables controls',async t=>{
 const s=await setup(t);await s.get('pick-download-folder').fire('click');const key=s.data.pickedDownloadFolder;globalThis.window.showDirectoryPicker=async()=>{throw new DOMException('Canceled','AbortError');};
 await s.get('pick-download-folder').fire('click');assert.equal(s.data.pickedDownloadFolder,key);assert.equal(s.get('picked-download-folder').hidden,false);assert.equal(s.get('save-download-folder').disabled,false);
});
test('a missing restored handle requires access and stays selected until explicitly reset',async t=>{
 const s=await setup(t);await s.get('pick-download-folder').fire('click');const key=s.data.pickedDownloadFolder;s.handles.delete(key);await s.reload();
 await s.get('download-folder-form').fire('submit');assert.equal(s.data.pickedDownloadFolder,key);assert.match(s.get('download-folder-status').textContent,/access/i);
 await s.get('use-default-download-folder').fire('click');assert.equal(s.data.pickedDownloadFolder,'');assert.equal(s.get('save-download-folder').disabled,false);
});
