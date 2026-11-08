import test from 'node:test';
import assert from 'node:assert/strict';
import {FindMedia} from '../extension/detection.js';

test('YouTube candidates use the current page video title rather than a fixed filename',async t=>{
 const Page='https://www.youtube.com/watch?v=FACJInvEmY8';
 globalThis.document={title:'실제 동영상 제목 - YouTube',querySelector:()=>null,querySelectorAll:()=>[]};
 globalThis.location={href:Page};globalThis.window={document,performance:{getEntriesByType:()=>[]},length:0};
 globalThis.chrome={scripting:{executeScript:async({func})=>[{documentId:'current-document',result:func()}]}};
 t.after(()=>{for(const key of['document','location','window','chrome'])delete globalThis[key];});
 for(const [Title,Expected] of[
  ['실제 동영상 제목 - YouTube','실제 동영상 제목.mp4'],
  ['(12) LIVE: 오늘의 방송 - YouTube','LIVE: 오늘의 방송.mp4'],
  ['<img src=x onerror=alert(1)> & "제목" - YouTube','<img src=x onerror=alert(1)> & "제목".mp4'],
  ['다음 동영상 - YouTube','다음 동영상.mp4'],
  ['YouTube','YouTube-FACJInvEmY8.mp4'],
  ['', 'YouTube-FACJInvEmY8.mp4'],
 ]){
  document.title=Title;const Result=await FindMedia(7);
  assert.equal(Result.items[0].name,Expected);assert.equal(Result.items[0].url,Page);
 }
});
