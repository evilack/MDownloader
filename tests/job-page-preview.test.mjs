import test from 'node:test';import assert from 'node:assert/strict';
import {PreviewJob,JobThumbnails,CaptureJobPreview} from '../extension/jobs.js';
import {PreviewSourceKey} from '../extension/lib/job-preview-cache.js';
import {ReadCandidateThumbnail} from '../extension/detection.js';
const Id='33333333-3333-3333-3333-333333333333',Page='https://www.youtube.com/watch?v=FACJInvEmY8';
test('job preview shares the pinned thumbnail and capture without depending on the current popup scan',async t=>{
 const job={requestId:Id,state:'active',youtube:true,youtubeSource:true},item={id:4,url:Page,format:'YOUTUBE',page:Page,previewPage:Page,documentId:'pinned-doc',singleStream:true};
 const source={format:'YOUTUBE',pageCandidate:{tabId:77,item}},calls=[];let registered=true,writes=0;
 globalThis.chrome={storage:{local:{get:async key=>({[key]:registered?job:undefined})},session:{get:async key=>{assert.equal(key,PreviewSourceKey(Id),'must not read current scan');return{[key]:source};}}},
  scripting:{executeScript:async args=>{calls.push(args);if(args.args.length===4)return[{documentId:'pinned-doc',result:'data:video/webm;base64,clip'}];return[{documentId:'pinned-doc',result:[{id:4,still:'data:image/jpeg;base64,thumbnail',duration:739,resolution:{width:854,height:480}}]}];}}};
 globalThis.caches={match:async()=>undefined,open:async()=>({put:async()=>{writes++;},keys:async()=>[]})};
 t.after(()=>{delete globalThis.chrome;delete globalThis.caches;});
 const preview=await PreviewJob(Id);assert.equal(preview.format,'YOUTUBE');assert.equal(preview.url,undefined);assert.ok(preview.still);assert.equal(calls.length,1);
 const remapped=await ReadCandidateThumbnail(77,{...item,id:99});assert.equal(remapped.id,99);assert.equal(remapped.still,preview.still);assert.equal(calls.length,1);
 const [thumb]=await JobThumbnails([Id]);assert.equal(thumb.still,preview.still);assert.equal(calls.length,1,'manager reuses bound frame instead of capturing again');
 assert.equal(await CaptureJobPreview(Id),'data:video/webm;base64,clip');assert.deepEqual(calls.at(-1).target,{tabId:77,documentIds:['pinned-doc']});assert.equal(calls.at(-1).args[2],Page);assert.equal(calls.at(-1).args[0][0].pagePlayer,true);
 registered=false;assert.deepEqual(await JobThumbnails([Id]),[{id:Id}]);await assert.rejects(CaptureJobPreview(Id),{key:'job_not_found'});assert.equal(writes,2);
 await assert.rejects(JobThumbnails(['invalid']),{key:'job_invalid_request'});
});
test('completed picked-folder jobs retain local-file preview precedence',async t=>{
 globalThis.chrome={storage:{local:{get:async key=>({[key]:{youtube:true,requestId:Id,state:'complete',pickedDownloadFolder:'folder',filename:'movie.mp4'}})},session:{get:async key=>({[key]:{format:'YOUTUBE',pageCandidate:{tabId:77,item:{url:Page}}}})}}};t.after(()=>delete globalThis.chrome);
 assert.deepEqual((await PreviewJob(Id)).localFile,{folder:'folder',name:'movie.mp4'});
});
