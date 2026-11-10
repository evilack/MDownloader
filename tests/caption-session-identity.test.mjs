import test from 'node:test';
import assert from 'node:assert/strict';
import {ResolveCaptionOptions} from '../extension/lib/local-captions-settings.js';
import {CreateCaptionService} from '../extension/lib/local-captions-service.js';
import {CreateConcurrentCaptionRunner} from '../extension/lib/concurrent-captions-runner.js';
import {ReleaseCaptionOutputSession} from '../extension/lib/caption-output-session.js';

// chrome.storage reorders dictionary keys, including nested recognition options.
const Stored=Value=>Array.isArray(Value)?Value.map(Stored):Value&&typeof Value==='object'
 ? Object.fromEntries(Object.keys(Value).sort().map(Key=>[Key,Stored(Value[Key])])):Value;
const Ready={connected:true,executionProtocol:2,engineReady:true,converterReady:true,modelManagement:true,
 modelDownloadVersion:3,captionTranslationVersion:1,recognitionOptionsVersion:1,captionPackageVersion:5,
 captionConcurrencyVersion:1,captionFinalizeVersion:2,captionWindowVersion:2,avDecodeStreamVersion:1};
function Fixture(t,Changed=false){
 globalThis.chrome={runtime:{onMessage:{addListener(){}}}};
 t.after(()=>{delete globalThis.chrome;});
 const Id=crypto.randomUUID(),Root='chrome-extension://'+'a'.repeat(32)+'/',Calls=[];
 const Job={requestId:Id,state:'active',captionPipeline:'staged',localCaptions:ResolveCaptionOptions({enabled:true,
  engine:'faster-whisper',model:'large-v3-turbo',container:true,formats:[],language:'auto',recognition:{cpuThreads:8,beamSize:5}})};
 const Durable=Stored(Job);if(Changed)Durable.localCaptions.model='tiny';
 const Api={runtime:{id:'a'.repeat(32),getURL:P=>Root+P},storage:{session:{get:async()=>({captionBrowserSession:true})}}};
 const Service=CreateCaptionService(Api,{readJob:async()=>Durable,updateJob:async()=>{},listJobs:async()=>[],native:{request:async()=>Ready}});
 const Runner=CreateConcurrentCaptionRunner({stage:async(J,Action,Fields)=>{
  Calls.push(Action);
  if(Action==='capabilities')return Service.handle({type:'captionStage',requestId:Id,action:Action},{id:Api.runtime.id,url:Root+'hls-runner.html'});
  if(Action==='beginAttempt')return {attempt:1};
  return {};
 }});
 t.after(async()=>{await Runner.release(Id);await ReleaseCaptionOutputSession(Id);});
 return {Job,Durable,Runner,Calls};
}
test('storage property ordering cannot block concurrent recognition before saving',async t=>{
 const F=Fixture(t);
 assert.notEqual(JSON.stringify(F.Job.localCaptions),JSON.stringify(F.Durable.localCaptions));
 await F.Runner.earlyReady(F.Job,new AbortController().signal);
 assert.ok(F.Calls.includes('recognizeEarly'));
 assert.equal(F.Job.captionMode,'early-audio');
});
test('a real per-download setting difference still rejects the capability response',async t=>{
 const F=Fixture(t,true);
 await assert.rejects(F.Runner.earlyReady(F.Job,new AbortController().signal),/caption_session_conflict/);
 assert.equal(F.Calls.includes('recognizeEarly'),false);
});
test('a concurrent startup failure is reported while download is still active',async t=>{
 const Calls=[],Job={requestId:crypto.randomUUID(),state:'active',captionPipeline:'staged',localCaptions:{enabled:true}};
 globalThis.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async M=>{
  Calls.push(M);return M.action==='capabilities'?{ok:false,error:'caption_helper_missing'}:{ok:true,data:{}};
 }}};
 const {CreateCaptionJournal,StartCommittedCaptions}=await import('../extension/lib/caption-committed-input.js');
 const {ConcurrentCaptions}=await import('../extension/lib/local-captions-runner.js');
 const Signal=new AbortController().signal,Journal=CreateCaptionJournal(Job,'youtube-audio',Signal);
 StartCommittedCaptions(Job,Journal,{},Signal);
 t.after(async()=>{await ReleaseCaptionOutputSession(Job.requestId);await ConcurrentCaptions.release(Job.requestId);delete globalThis.chrome;});
 await Job.captionConcurrentStart;
 assert.equal(Job.state,'active');
 assert.ok(Calls.some(M=>M.action==='failure'&&M.code==='caption_helper_missing'));
});
test('decoder input request IDs remain separate from the owning download ID',async t=>{
 const Id=crypto.randomUUID(),Token=crypto.randomUUID(),Root='chrome-extension://'+'a'.repeat(32)+'/',Calls=[];
 const Job={requestId:Id,state:'active',captionPipeline:'staged',captionAttempt:1,localCaptions:{enabled:true},captionStatus:{attempt:1,mode:'windowed',phase:'recognizing'}};
 const Api={runtime:{id:'a'.repeat(32),getURL:P=>Root+P},storage:{session:{get:async()=>({captionBrowserSession:true})}}};
 const Service=CreateCaptionService(Api,{readJob:async()=>Job,updateJob:async()=>{},listJobs:async()=>[],native:{request:async M=>{Calls.push(M);return {acceptedBytes:1,attempt:1};}}});
 globalThis.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async M=>({ok:true,data:await Service.handle(M,{id:Api.runtime.id,url:Root+'hls-runner.html'})})}};
 t.after(()=>{delete globalThis.chrome;});
 const {CaptionStage}=await import('../extension/lib/local-captions-runner.js');
 const Result=await CaptionStage(Job,'decoderSupply',{decoderToken:Token,inputRequestId:'r1',offset:0,data:'AA==',eof:false});
 assert.equal(Result.acceptedBytes,1);assert.equal(Calls.length,1);
 assert.equal(Calls[0].jobId,Id);assert.equal(Calls[0].requestId,'r1');
 const Fields={type:'captionStage',requestId:Id,action:'decoderSupply',attempt:1,decoderToken:Token,inputRequestId:'r1',offset:0,data:'AA==',eof:false};
 await assert.rejects(Service.handle({...Fields,inputRequestId:'invalid'},{id:Api.runtime.id,url:Root+'hls-runner.html'}),/caption_invalid/);
 await assert.rejects(Service.handle({...Fields,attempt:2},{id:Api.runtime.id,url:Root+'hls-runner.html'}),/caption_stale_attempt/);
 assert.equal(Calls.length,1,'rejected input cannot reach the executor');
 await CaptionStage(Job,'decoderSupply',{...Fields,requestId:'r9'});
 assert.equal(Calls[1].jobId,Id,'operation fields cannot replace the owning job ID');
});
