import test from 'node:test';import assert from 'node:assert/strict';
import{RevealPickedMedia,ExplorerHost,ConnectExplorer}from'../extension/lib/explorer-bridge.js';
test('direct folder reveal sends only registered identity/fingerprint and never opens a substitute page',async t=>{
 const sent=[],file=new Blob(['media']),folder={name:'saved',queryPermission:async()=> 'granted',getFileHandle:async name=>{assert.equal(name,'saved.mp4');return{getFile:async()=>file};}};
 globalThis.indexedDB={open(){const r={result:{close(){},transaction(){const tx={objectStore:()=>({get(){const op={result:folder};queueMicrotask(()=>tx.oncomplete());return op;}})};return tx;}}};queueMicrotask(()=>r.onsuccess());return r;}};
 let mode='ok';globalThis.chrome={runtime:{connectNative(host){if(mode==='missing')throw Error('not registered');let receive;return{onMessage:{addListener(f){receive=f;}},onDisconnect:{addListener(){}},disconnect(){},postMessage(message){sent.push({host,message});queueMicrotask(()=>receive(mode==='cancel'?{ok:false,code:'canceled'}:{ok:true}));}};}},tabs:{create:()=>assert.fail('must not open a substitute tab')}};t.after(()=>{delete globalThis.chrome;delete globalThis.indexedDB;});
 const location={folder:'55555555-5555-5555-5555-555555555555',name:'saved.mp4'};await RevealPickedMedia(location);assert.equal(sent[0].host,ExplorerHost);assert.deepEqual(Object.keys(sent[0].message).sort(),['action','filename','folderKey','folderName','sampleHash','size']);assert.equal(sent[0].message.size,5);
 mode='missing';await assert.rejects(RevealPickedMedia(location),{key:'explorer_bridge_required'});mode='cancel';await RevealPickedMedia(location);
});

test('native connection stays open until its reply and reports missing-host disconnects',async t=>{
 let receive,disconnect,closed=0;const runtime={connectNative(){return{onMessage:{addListener(f){receive=f;}},onDisconnect:{addListener(f){disconnect=f;}},postMessage(message){assert.equal(message.action,'ping');},disconnect(){closed++;}};}};
 globalThis.chrome={runtime};t.after(()=>delete globalThis.chrome);
 const pending=ConnectExplorer();assert.equal(closed,0);receive({ok:true,protocol:1});assert.deepEqual(await pending,{connected:true});assert.equal(closed,1);
 const missing=ConnectExplorer();runtime.lastError={message:'Specified native messaging host not found.'};disconnect();await assert.rejects(missing,{key:'explorer_bridge_required'});
});
test('a saved-file read failure is never reported as an unregistered Explorer host',async t=>{
 const file={size:5,slice(){throw new DOMException('file changed','NotReadableError');}},folder={name:'saved',queryPermission:async()=> 'granted',getFileHandle:async()=>({getFile:async()=>file})};
 globalThis.indexedDB={open(){const r={result:{close(){},transaction(){const tx={objectStore:()=>({get(){const op={result:folder};queueMicrotask(()=>tx.oncomplete());return op;}})};return tx;}}};queueMicrotask(()=>r.onsuccess());return r;}};
 globalThis.chrome={runtime:{sendNativeMessage:()=>assert.fail('file failed before host call')}};t.after(()=>{delete globalThis.indexedDB;delete globalThis.chrome;});
 await assert.rejects(RevealPickedMedia({folder:'55555555-5555-5555-5555-555555555555',name:'saved.mp4'}),{name:'NotReadableError'});
});
