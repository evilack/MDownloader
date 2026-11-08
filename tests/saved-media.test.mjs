import test from 'node:test';import assert from 'node:assert/strict';
import{SavedMediaMime,LocalMediaUrl,FileFingerprint}from'../extension/lib/saved-media.js';
test('media types and local URLs reject inherited extensions and encode filename URL delimiters',()=>{
 assert.equal(SavedMediaMime('saved.MP4'),'video/mp4');for(const n of['x.html','x.constructor','x.__proto__'])assert.equal(SavedMediaMime(n),undefined);
 assert.equal(LocalMediaUrl('C:\\A B\\x#?.mp4'),'file:///C:/A%20B/x%23%3F.mp4');assert.equal(LocalMediaUrl('\\\\server\\share\\x.mp4'),'file://server/share/x.mp4');assert.throws(()=>LocalMediaUrl('../x.mp4'));assert.throws(()=>LocalMediaUrl('C:/x.html'));
});
test('folder binding fingerprint reads at most128KiB without overlapping small-file bytes',async()=>{
 const b=new Blob(['sample']);const r=await FileFingerprint(b);assert.equal(r.size,6);assert.equal(r.sampleHash.length,64);
 const calls=[];await FileFingerprint({size:16*1024**3,slice(start,end=this.size){calls.push([start,end]);return new Blob([new Uint8Array(end-start)]);}});assert.equal(calls.reduce((n,[a,b])=>n+b-a,0),131072);
});

test('saved media supports existing audio/video families even when a codec may not play in Chrome',()=>{
 for(const[name,mime]of Object.entries({'saved.flac':'audio/flac','saved.opus':'audio/ogg','saved.weba':'audio/webm','saved.mkv':'video/x-matroska','saved.m4v':'video/mp4','saved.mov':'video/quicktime'})){assert.equal(SavedMediaMime(name),mime);assert.match(LocalMediaUrl('C:/Saved/'+name),/^file:/);}
});
