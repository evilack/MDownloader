import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateYoutubeTrackStore} from '../extension/features/youtube/track-store.js';
test('snapshots freeze only committed immutable chunks and survive subsequent append',async()=>{
 let unblock;const pending=new Promise(r=>unblock=r);let hold=false;
 const files=new Map();const dir={async getFileHandle(name){let bytes;return{async createWritable(){return{async write(chunk){if(hold)await pending;bytes=new Uint8Array(chunk);},async close(){files.set(name,new Blob([bytes]));},async abort(){}};},async getFile(){return files.get(name);}};}};
 const store=CreateYoutubeTrackStore(dir),v=await store.writer('video'),a=await store.writer('audio');
 await v.write(new Uint8Array([1]));await a.write(new Uint8Array([2]));const first=store.snapshot();
 hold=true;const writing=v.write(new Uint8Array([3]));await new Promise(r=>setTimeout(r,0));assert.equal(store.snapshot().video.size,1);
 unblock();await writing;assert.deepEqual([...new Uint8Array(await first.video.arrayBuffer())],[1]);assert.equal(store.snapshot().video.size,2);
});
