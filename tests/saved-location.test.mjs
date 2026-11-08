import test from 'node:test';import assert from 'node:assert/strict';
import{ControlJob,SavedLocation}from'../extension/jobs.js';
const Id='44444444-4444-4444-4444-444444444444';
test('the original show action resolves the registered folder and filename, not arbitrary UI paths',async t=>{
 const job={requestId:Id,state:'complete',exists:true,pickedDownloadFolder:'registered-key',filename:'saved.mp4'},opened=[];
 globalThis.chrome={storage:{local:{get:async key=>({[key]:job})}},runtime:{getURL:p=>'chrome-extension://test/'+p},tabs:{create:async v=>opened.push(v)}};t.after(()=>delete globalThis.chrome);
 assert.deepEqual(await SavedLocation(Id),{folder:'registered-key',name:'saved.mp4'});await ControlJob(Id,'show');assert.deepEqual(opened,[{url:'chrome-extension://test/saved-folder.html?job='+Id}]);
 job.state='active';await assert.rejects(SavedLocation(Id));job.state='complete';job.exists=false;await assert.rejects(SavedLocation(Id));await assert.rejects(SavedLocation('../path'));
});
test('browser-managed completed downloads keep the original native show API',async t=>{
 const job={requestId:Id,state:'started',downloadId:7},shown=[];globalThis.chrome={storage:{local:{get:async key=>({[key]:job})}},runtime:{id:'test'},downloads:{search:async()=>[{id:7,byExtensionId:'test',state:'complete',exists:true,filename:'C:/Downloads/saved.mp4'}],show:async id=>shown.push(id)}};t.after(()=>delete globalThis.chrome);
 await ControlJob(Id,'show');assert.deepEqual(shown,[7]);
});
