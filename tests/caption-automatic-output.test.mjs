import test from 'node:test';
import assert from 'node:assert/strict';
import {PrepareCaptionOutput,SaveCaptionArtifacts} from '../extension/lib/caption-output-pipeline.js';
import {FinishCaptionSave} from '../extension/lib/local-captions-runner.js';
import {CaptionOutputSession,ReleaseCaptionOutputSession} from '../extension/lib/caption-output-session.js';
import {CreateConcurrentCaptionRunner} from '../extension/lib/concurrent-captions-runner.js';
import {CaptionOptionsKey,CaptionOutputName} from '../extension/lib/local-captions-settings.js';

const Files=[];
class Directory{
 constructor(name='root'){this.name=name;this.kind='directory';this.entries=new Map();}
 async*values(){yield*this.entries.values();}
 async getDirectoryHandle(name){if(!this.entries.has(name))this.entries.set(name,new Directory(name));return this.entries.get(name);}
 async removeEntry(name){this.entries.delete(name);}
 async getFileHandle(name){
  if(!this.entries.has(name)){
   let blob=new Blob();const handle={name,kind:'file',getFile:async()=>blob,createWritable:async()=>{let parts=[];return{write:async data=>parts.push(data),close:async()=>{blob=new Blob(parts);},abort:async()=>{parts=[];}};}};
   this.entries.set(name,handle);Files.push(handle);
  }return this.entries.get(name);
 }
}
const Root=new Directory(),Vtt='WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAutomatic speech captions.\n';
for(const [name,container,formats]of [['embedded',true,[]],['SRT',false,['srt']],['VTT',false,['vtt']],['combined',true,['srt','vtt']]]){
 test(`${name} final output saves selected captions automatically without a second file picker`,async t=>{
  const navigation=Object.getOwnPropertyDescriptor(globalThis,'navigator'),calls=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{getDirectory:async()=>Root}}});
  globalThis.chrome={runtime:{sendMessage:async message=>{calls.push(message);if(message.action==='saveArtifact')return{ok:true,data:{outputs:[CaptionOutputName('video (1).mp4',message.format)]}};return{ok:true,data:{}};}}};
  t.after(()=>{delete globalThis.chrome;if(navigation)Object.defineProperty(globalThis,'navigator',navigation);else delete globalThis.navigator;});
  const Job={requestId:crypto.randomUUID(),state:'active',captionPipeline:'staged',filename:'video.mp4',localCaptions:{enabled:true,container,formats},captionStatus:{attempt:1}};
  const Session=CaptionOutputSession(Job);Session.finalizedRecognition={resultRevision:1,language:'en'};Session.originalCaption=Vtt;
  t.after(()=>ReleaseCaptionOutputSession(Job.requestId));
  const signal=new AbortController().signal,prepared=await PrepareCaptionOutput(Job,new Blob(['media']),signal);
  assert.equal(prepared.subtitleTracks.length,container?1:0);assert.deepEqual(prepared.captionArtifacts.map(a=>a.format),formats);
  await SaveCaptionArtifacts(prepared,'video (1).mp4',signal);await FinishCaptionSave(prepared,new Blob(['media']),signal);
  assert.deepEqual(calls.filter(c=>c.action==='saveArtifact').map(c=>c.format),formats);
  assert.equal(calls.filter(c=>c.action==='outputReceipt'&&c.kind==='sidecar').length,formats.length);
  assert.equal(calls.at(-1).action,'saved');assert.equal(Files.some(f=>/\.live-/.test(f.name)),false);
 });
}
test('windowed recognition never starts an unselected live-file writer or blocks sealing on it',async t=>{
 const calls=[],Job={requestId:crypto.randomUUID(),state:'active',pickedDownloadFolder:'existing-folder',localCaptions:{enabled:true,container:true,formats:[]}};
 let sealed,done;const seal=new Promise(resolve=>done=resolve);
 const runner=CreateConcurrentCaptionRunner({stage:async(_job,action)=>{
  calls.push(action);
  if(action==='capabilities')return{jobOptionsKey:CaptionOptionsKey(Job.localCaptions),connected:true,executionProtocol:2,engineReady:true,converterReady:true,modelManagement:true,modelDownloadVersion:3,captionTranslationVersion:1,recognitionOptionsVersion:1,captionPackageVersion:5,captionConcurrencyVersion:1,captionFinalizeVersion:2,captionWindowVersion:2};
  if(action==='beginAttempt')return{attempt:1};if(action==='openConcurrent')return{credit:1};
  if(action==='sealConcurrent')sealed=true;
  if(action==='status'){if(sealed)done();return{phase:sealed?'windowed-ready':'queued',credit:1};}
  assert.ok(!['liveFileCheck','liveFileState'].includes(action),'no unselected live export');return{};
 }});
 t.after(async()=>{await runner.release(Job.requestId);await ReleaseCaptionOutputSession(Job.requestId);});
 await runner.windowed(Job,{next:async options=>{assert.equal(options,undefined,'no unused provisional ASR callback');return null;},release:async()=>{},sourceEndSample:0,reason:'eof'},new AbortController().signal,'source');
 await seal;assert.ok(calls.includes('sealConcurrent'));assert.equal(calls.some(action=>action.startsWith('liveFile')),false);
});
