import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReceiveYoutubeFile} from '../extension/features/youtube/direct.js';
const url='https://r1.googlevideo.com/videoplayback';
test('direct VOD uses ordered bounded ranges and commits only its exact full length',async()=>{
 const data=new Uint8Array([1,2,3,4,5,6,7]),output=[],ranges=[];let committed=false;
 const result=await ReceiveYoutubeFile({url,contentLength:7},{chunkBytes:3,hasPermission:async()=>true,createWriter:async()=>({write:async chunk=>output.push(...chunk),close:async()=>{committed=true;},abort:async()=>{}}),fetch:async request=>{const match=/bytes=(\d+)-(\d+)/.exec(request.headers.get('range'));const start=+match[1],end=Math.min(+match[2],6);ranges.push([start,end]);if(start)assert.equal(request.headers.get('if-range'),'"v1"');return new Response(data.slice(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/7`,'content-type':'video/mp4',etag:'"v1"'}});}});
 assert.equal(result.bytes,7);assert.equal(committed,true);assert.deepEqual(output,[...data]);assert.deepEqual(ranges,[[0,2],[3,5],[6,6]]);
});
test('multipart reception rejects missing or weak validators and cancels rejected response bodies',async()=>{
 for(const etag of [undefined,'W/"v1"']){
  let closed=0,cancelled=0;
  await assert.rejects(ReceiveYoutubeFile({url},{chunkBytes:1,hasPermission:async()=>true,createWriter:async()=>({write:async()=>{},close:async()=>closed++,abort:async()=>{}}),fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();},cancel(){cancelled++;}}),{status:206,headers:{'content-range':'bytes 0-0/2',...(etag?{etag}:{})}})}),{code:'youtube_session_changed'});
  assert.equal(closed,0);assert.equal(cancelled,1);
 }
 let cancelled=0;
 await assert.rejects(ReceiveYoutubeFile({url,contentLength:4},{chunkBytes:1,hasPermission:async()=>true,createWriter:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}}),fetch:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();},cancel(){cancelled++;}}),{status:206,headers:{'content-range':'bytes 0-0/2',etag:'"v1"'}})}),{code:'youtube_session_changed'});
 assert.equal(cancelled,1);
});
test('permission denial and changed ranges never commit a file',async()=>{
 let fetched=0,closed=0,aborted=0;const options={hasPermission:async()=>false,createWriter:async()=>({write:async()=>{},close:async()=>closed++,abort:async()=>aborted++}),fetch:async()=>{fetched++;return new Response(new Uint8Array([1]),{status:206,headers:{'content-range':'bytes 1-1/2'}});}};
 await assert.rejects(ReceiveYoutubeFile({url},options),{code:'youtube_permission_denied'});assert.equal(fetched,0);
 await assert.rejects(ReceiveYoutubeFile({url},{...options,hasPermission:async()=>true}),{code:'youtube_session_changed'});assert.equal(closed,0);assert.equal(aborted,1);
});
