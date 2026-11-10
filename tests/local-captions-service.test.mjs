import test from 'node:test';import assert from 'node:assert/strict';
import {CreateCaptionService,CaptionSenderAllowed} from '../extension/lib/local-captions-service.js';
const Id='12345678-1234-1234-1234-123456789abc',Root='chrome-extension://'+'a'.repeat(32)+'/';
function Fixture(Phase='waiting',NativeRequest=async()=>({})){let Job={requestId:Id,downloadId:1,state:'complete',filename:'video.mp4',localCaptions:{enabled:true,engine:'faster-whisper',model:'tiny',language:'en',formats:['srt']},captionStatus:{phase:Phase}},ReadHook;const Requests=[];
 const Api={runtime:{id:'a'.repeat(32),getURL:P=>Root+P,getPlatformInfo:async()=>({os:'win'})},downloads:{search:async()=>[{id:1,byExtensionId:'a'.repeat(32),filename:'C:/test/video.mp4',state:'complete',exists:true}]}};
 const Service=CreateCaptionService(Api,{native:{request:async M=>{Requests.push(M);return NativeRequest(M);}},readJob:async()=>{const Copy=structuredClone(Job);if(ReadHook){const Hook=ReadHook;ReadHook=null;await Hook();}return Copy;},updateJob:async(_K,F)=>Job=F(Job),listJobs:async()=>[Job]});
 return {Service,Requests,get job(){return Job;},Api,holdNextRead:Hook=>ReadHook=Hook};}
const Runner={id:'a'.repeat(32),url:Root+'hls-runner.html'},Ui={id:'a'.repeat(32),url:Root+'sidepanel.html'};
test('subtitle timing correction is a warning and never changes recognition to failed',async()=>{
 const F=Fixture('recognizing');F.Api.storage={session:{get:async()=>({captionBrowserSession:true})}};
 await F.Service.handle({type:'captionStage',action:'timingWarnings',requestId:Id,count:2},Runner);
 assert.equal(F.job.captionStatus.phase,'recognizing');assert.equal(F.job.captionStatus.warningCount,2);assert.equal(F.job.captionStatus.warningCode,'caption_timing_adjusted');assert.equal(F.job.captionStatus.lastFailure,undefined);
 await F.Service.onNativeEvent({event:'state',jobId:Id,phase:'recognized',warningCount:1,warningCode:'caption_timing_adjusted'});
 assert.equal(F.job.captionStatus.warningCount,3);
 await F.Service.onNativeEvent({event:'state',jobId:Id,phase:'recognized',warningCount:1,warningCode:'caption_timing_adjusted'});
 assert.equal(F.job.captionStatus.warningCount,3,'repeated state events do not double count warnings');
});
test('a failed decoder keeps bounded facts and its original failure after cancellation',async()=>{
 const F=Fixture('recognizing');F.Api.storage={session:{get:async()=>({captionBrowserSession:true})}};F.job.captionPipeline='staged';F.job.captionStatus.attempt=1;
 await F.Service.handle({type:'captionStage',action:'failure',requestId:Id,attempt:1,code:'caption_av_decode_failed',details:{operation:'select-audio',exceptionType:'AttributeError',errno:22,url:'https://private.invalid/?token=secret',message:'private path'}},Runner);
 assert.equal(F.job.captionStatus.lastFailure.code,'caption_av_decode_failed');
 assert.deepEqual(F.job.captionStatus.lastFailure.details,{operation:'select-audio',exceptionType:'AttributeError',errno:22});
 await F.Service.onNativeEvent({event:'state',jobId:Id,attempt:1,phase:'canceled',error:null});
 assert.equal(F.job.captionStatus.phase,'canceled');assert.equal(F.job.captionStatus.error,null);
 assert.equal(F.job.captionStatus.lastFailure.code,'caption_av_decode_failed');
 assert.doesNotMatch(JSON.stringify(F.job.captionStatus.lastFailure),/private|secret/);
});
test('helper disconnect also preserves its failure when the job is later canceled',async()=>{
 const F=Fixture('recognizing');F.Api.storage={session:{get:async()=>({captionBrowserSession:true})}};F.Api.runtime.sendMessage=async()=>({});F.job.captionPipeline='staged';F.job.captionStatus.attempt=1;
 await F.Service.onNativeEvent({event:'disconnected',jobs:[{jobId:Id,attempt:1}]});
 assert.equal(F.job.captionStatus.lastFailure.code,'caption_helper_missing');
 await F.Service.onNativeEvent({event:'state',jobId:Id,attempt:1,phase:'canceled',error:null});
 assert.equal(F.job.captionStatus.lastFailure.code,'caption_helper_missing');
});
test('native access rejects websites, other extensions and runner spoofing',()=>{
 const F=Fixture();assert.equal(CaptionSenderAllowed({type:'captionProbe'},{id:Ui.id,url:'https://example.com'},F.Api),false);
 assert.equal(CaptionSenderAllowed({type:'captionStage'},{...Runner,tab:{id:1}},F.Api),false);
 assert.equal(CaptionSenderAllowed({type:'captionStage'},Ui,F.Api),false);
});
test('completion never restarts captions canceled while video was downloading',async()=>{
 const F=Fixture('canceled');await F.Service.handle({type:'captionStage',action:'saved',requestId:Id},Runner);assert.equal(F.job.captionStatus.phase,'canceled');assert.equal(F.Requests.length,0);
});
test('failure to connect is separate from the completed video',async()=>{
 const F=Fixture('waiting',async()=>{throw Error('caption_helper_missing');});await F.Service.downloadChanged({id:1,state:{current:'complete'}});assert.equal(F.job.state,'complete');assert.equal(F.job.captionStatus.error,'caption_helper_missing');
});
test('cancellation during result save cannot become complete',async()=>{
 let Release;const F=Fixture('recognizing',async M=>M.action==='saveResult'?new Promise(R=>Release=()=>R({outputs:['video.generated.srt']})):{});
 const Pending=F.Service.onNativeEvent({event:'state',jobId:Id,phase:'recognized',formats:['srt']});
 while(!Release)await new Promise(R=>setImmediate(R));
 const Canceling=F.Service.handle({type:'captionControl',action:'cancel',requestId:Id},Ui);Release();await Canceling;await Pending;assert.equal(F.job.captionStatus.phase,'canceled');
});
test('a canceled staged upload cannot start over from a late runner message',async()=>{
 const F=Fixture('canceled');await assert.rejects(F.Service.handle({type:'captionStage',action:'begin',requestId:Id},Runner));assert.equal(F.Requests.length,0);
});
test('a failed audio preparation falls back to verified completed media',async()=>{
 const F=Fixture('audio-ready',async M=>M.action==='status'?{phase:'failed',error:'caption_prepare_failed'}:{});
 F.job.captionStatus.prepared=true;await F.Service.start(Id);assert.equal(F.Requests.find(M=>M.action==='start')?.sourcePath,'C:/test/video.mp4');assert.equal(F.job.captionStatus.prepared,false);
});
test('an old native progress snapshot cannot overwrite a newer cancel',async()=>{
 const F=Fixture('recognizing');let Release;F.holdNextRead(()=>new Promise(R=>Release=R));
 const Pending=F.Service.onNativeEvent({event:'state',jobId:Id,phase:'recognizing'});while(!Release)await new Promise(R=>setImmediate(R));
 await F.Service.handle({type:'captionControl',action:'cancel',requestId:Id},Ui);Release();await Pending;assert.equal(F.job.captionStatus.phase,'canceled');
});
test('post-save staging failure is retryable and leaves the saved video complete',async()=>{
 const F=Fixture('waiting');F.job.pickedDownloadFolder='folder';await F.Service.handle({type:'captionStage',action:'failure',requestId:Id,code:'caption_helper_missing'},Runner);assert.equal(F.job.state,'complete');assert.equal(F.job.captionStatus.phase,'failed');assert.equal(F.job.captionStatus.error,'caption_helper_missing');
});
test('a missing-model retry can adopt the model the user explicitly selected in settings',async()=>{
 const F=Fixture('failed');F.job.localCaptions.model='';F.Api.storage={local:{get:async()=>({localCaptions:{engine:'whisper.cpp',model:'small'}})}};
 await F.Service.start(Id,true);const Started=F.Requests.find(M=>M.action==='start');assert.equal(Started.options.model,'small');assert.equal(Started.options.engine,'whisper.cpp');
});
test('restaging a picked saved video clears the old prepared audio offset',async()=>{
 let Job={requestId:Id,state:'complete',filename:'video.mp4',pickedDownloadFolder:'folder',localCaptions:{enabled:true,engine:'faster-whisper',model:'tiny',language:'en',formats:['srt']},captionStatus:{phase:'failed',prepared:true,offset:3.5}};const Calls=[];
 const Service=CreateCaptionService({runtime:{id:'a'.repeat(32)},downloads:{search:async()=>[]}},{native:{request:async M=>{Calls.push(M);return {};}},readJob:async()=>Job,updateJob:async(_K,F)=>Job=F(Job),listJobs:async()=>[Job],requireFolder:async()=>({getFileHandle:async()=>({getFile:async()=>new Blob(['saved video'])})})});
 await Service.start(Id,true);assert.ok(Calls.some(M=>M.action==='append'));assert.equal(Calls.find(M=>M.action==='start').offset,0);
});
