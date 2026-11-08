import test from 'node:test';import assert from 'node:assert/strict';
import {CreateSharedThumbnailCache} from '../extension/lib/shared-thumbnail-cache.js';
test('popup and job share a bound thumbnail and concurrent read; navigation and expired/empty entries cannot alias',async()=>{
 let now=0,loads=0,release;const cache=CreateSharedThumbnailCache({now:()=>now,ttl:10,limit:2});const source={tabId:1,documentId:'doc',page:'watch-a',url:'video-a'};
 const load=async()=>{loads++;await new Promise(r=>release=r);return[{id:'candidate',still:'frame-1'}];};
 const a=cache.read(source,load),b=cache.read(source,()=>assert.fail('duplicate capture'));await Promise.resolve();release();assert.equal((await a)[0].still,'frame-1');assert.deepEqual(await b,await a);assert.equal(loads,1);
 assert.equal((await cache.read(source,()=>assert.fail('cached')))[0].still,'frame-1');
 assert.equal((await cache.read({...source,documentId:'new'},async()=>[{still:'new-doc'}]))[0].still,'new-doc');
 assert.equal((await cache.read({...source,page:'watch-b'},async()=>[{still:'new-page'}]))[0].still,'new-page');assert.equal(cache.size(),2);
 now=11;assert.equal((await cache.read(source,async()=>[{still:'refreshed'}]))[0].still,'refreshed');
 const empty={...source,url:'empty'};await cache.read(empty,async()=>[]);assert.equal((await cache.read(empty,async()=>[{still:'retry'}]))[0].still,'retry');
});
