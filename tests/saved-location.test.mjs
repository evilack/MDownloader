import test from 'node:test';import assert from 'node:assert/strict';
import{ControlJob,SavedLocation}from'../extension/jobs.js';
const Id='44444444-4444-4444-4444-444444444444';
test('picked-folder replay resolves the registered folder and filename, not arbitrary UI paths',async t=>{
 const job={requestId:Id,state:'complete',exists:true,pickedDownloadFolder:'registered-key',filename:'saved.mp4'},opened=[];
 globalThis.chrome={storage:{local:{get:async key=>({[key]:job})}},runtime:{getURL:p=>'chrome-extension://test/'+p},tabs:{create:async v=>opened.push(v)}};t.after(()=>delete globalThis.chrome);
 assert.deepEqual(await SavedLocation(Id),{folder:'registered-key',name:'saved.mp4'});await ControlJob(Id,'play');assert.deepEqual(opened,[{url:'chrome-extension://test/saved-media.html?job='+Id}]);
 job.state='active';await assert.rejects(SavedLocation(Id));job.state='complete';job.exists=false;await assert.rejects(SavedLocation(Id));await assert.rejects(SavedLocation('../path'));
});
test('browser replay opens the completed local media URL without launching its default OS app',async t=>{
 const job={requestId:Id,state:'started',downloadId:7},opened=[];globalThis.chrome={storage:{local:{get:async key=>({[key]:job})}},runtime:{id:'test'},tabs:{create:async v=>opened.push(v)},downloads:{search:async()=>[{id:7,byExtensionId:'test',state:'complete',exists:true,filename:'C:\\Downloads\\영상 #1.mp4'}]}};t.after(()=>delete globalThis.chrome);
 await ControlJob(Id,'play');assert.deepEqual(opened,[{url:'file:///C:/Downloads/%EC%98%81%EC%83%81%20%231.mp4'}]);
});
test('browser-managed completed downloads keep the original native show API',async t=>{
 const job={requestId:Id,state:'started',downloadId:7},shown=[];globalThis.chrome={storage:{local:{get:async key=>({[key]:job})}},runtime:{id:'test',getPlatformInfo:async()=>({os:'win'})},downloads:{search:async()=>[{id:7,byExtensionId:'test',state:'complete',exists:true,filename:'C:/Downloads/saved.mp4'}],show:async id=>shown.push(id)}};t.after(()=>delete globalThis.chrome);
 await ControlJob(Id,'show');assert.deepEqual(shown,[7]);
});

test('Mac picked-folder show opens Downloads without reading handles or invoking a Windows helper',async t=>{
 const job={requestId:Id,state:'complete',exists:true,pickedDownloadFolder:'registered-key',filename:'saved.mp4'};let shown=0;
 globalThis.chrome={storage:{local:{get:async key=>({[key]:job})}},runtime:{getPlatformInfo:async()=>({os:'mac'})},downloads:{showDefaultFolder:async()=>shown++}};t.after(()=>delete globalThis.chrome);
 await ControlJob(Id,'show');assert.equal(shown,1);
});
