import test from 'node:test';import assert from 'node:assert/strict';
import{RevealPickedMedia,ExplorerHost}from'../extension/lib/explorer-bridge.js';
test('direct folder reveal sends only registered identity/fingerprint and never opens a substitute page',async t=>{
 const sent=[],file=new Blob(['media']),folder={name:'saved',queryPermission:async()=> 'granted',getFileHandle:async name=>{assert.equal(name,'saved.mp4');return{getFile:async()=>file};}};
 globalThis.indexedDB={open(){const r={result:{close(){},transaction(){const tx={objectStore:()=>({get(){const op={result:folder};queueMicrotask(()=>tx.oncomplete());return op;}})};return tx;}}};queueMicrotask(()=>r.onsuccess());return r;}};
 let mode='ok';globalThis.chrome={runtime:{sendNativeMessage:async(host,message)=>{sent.push({host,message});if(mode==='missing')throw Error('not registered');return mode==='cancel'?{ok:false,code:'canceled'}:{ok:true};}},tabs:{create:()=>assert.fail('must not open a substitute tab')}};t.after(()=>{delete globalThis.chrome;delete globalThis.indexedDB;});
 const location={folder:'55555555-5555-5555-5555-555555555555',name:'saved.mp4'};await RevealPickedMedia(location);assert.equal(sent[0].host,ExplorerHost);assert.deepEqual(Object.keys(sent[0].message).sort(),['action','filename','folderKey','folderName','sampleHash','size']);assert.equal(sent[0].message.size,5);
 mode='missing';await assert.rejects(RevealPickedMedia(location),{key:'explorer_bridge_required'});mode='cancel';await RevealPickedMedia(location);
});
