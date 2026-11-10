import test from 'node:test';import assert from 'node:assert/strict';
globalThis.chrome={runtime:{onMessage:{addListener(){}}}};
const {ConcurrentCaptions}=await import('../extension/lib/local-captions-runner.js');
const {FinalizeCaptionInput}=await import('../extension/lib/caption-output-pipeline.js');
const {CaptionOutputSession,ReleaseCaptionOutputSession}=await import('../extension/lib/caption-output-session.js');
function Fixture(t,{cached=false,error='caption_seam_unresolved',receipt=false,closeError=false}={}){
 const Failure=Error(error),Job={requestId:crypto.randomUUID(),state:'active',captionPipeline:'staged',captionMode:'windowed',captionCommittedInput:true,localCaptions:{enabled:true},captionSession:{attempt:1,...(cached?{error:Failure}:{})}},Calls=[];
 const Session=CaptionOutputSession(Job);if(receipt)Session.receipts.media={filename:'already-saved.mp4'};
 let recognized=false;
 globalThis.chrome={runtime:{sendMessage:async M=>{
  Calls.push(M.action);let data={};
  if(M.action==='append')data.offset=M.offset+atob(M.data).length;
  if(M.action==='recognize')recognized=true;
  if(M.action==='status')data={phase:recognized?'recognized':'audio-ready',resultRevision:recognized?1:0};
  if(M.action==='readResult'){const Text='WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n';data={offset:Text.length,done:true,data:btoa(Text)};}
  return {ok:true,data};
 }}};
 for(const Method of ['resumeFinalization','resumeRecognition'])t.mock.method(ConcurrentCaptions,Method,async()=>null);
 t.mock.method(ConcurrentCaptions,'bind',()=>{});t.mock.method(ConcurrentCaptions,'signal',(_J,S)=>S);t.mock.method(ConcurrentCaptions,'attempt',async()=>2);
 t.mock.method(ConcurrentCaptions,'finalize',async()=>{if(Job.captionMode==='postprocess')return null;throw Failure;});
 t.mock.method(ConcurrentCaptions,'fallback',async()=>{Calls.push('fallback');if(closeError)throw Error('caption_busy');Job.captionSession.error=null;Job.captionSession.attempt=2;});
 t.after(async()=>{await ReleaseCaptionOutputSession(Job.requestId);delete globalThis.chrome;});
 return {Job,Calls};
}
for(const cached of [false,true])test('only a confirmed seam failure uses completed media in a fresh attempt '+(cached?'(cached)':'(finalize)'),async t=>{
 const F=Fixture(t,{cached}),Media=new Blob(['completed media']),S=await FinalizeCaptionInput(F.Job,Media,new AbortController().signal);
 assert.equal(S.phase,'recognized');assert.ok(F.Calls.indexOf('fallback')<F.Calls.indexOf('begin'));
 assert.ok(F.Calls.includes('recognize'));assert.equal(F.Job.captionMode,'postprocess');
});
test('other failures and a saved output do not silently restart recognition',async t=>{
 for(const Options of [{error:'caption_window_clock'},{receipt:true}]){
  const F=Fixture(t,Options);await assert.rejects(FinalizeCaptionInput(F.Job,new Blob(['completed']),new AbortController().signal));assert.equal(F.Calls.includes('fallback'),false);
 }
});
for(const error of ['caption_window_guard','stream_capture_clock_overlap'])test(`confirmed ${error} finishes from the completed HLS output without user intervention`,async t=>{
 const F=Fixture(t,{cached:true,error});F.Job.captionCommittedInput=false;F.Job.captionSourceInfo={windowed:true};
 const media=new Blob(['complete selected HLS output']);CaptionOutputSession(F.Job).rawFile=media;F.Job.captionFinalTiming={start:-0.04644444444444444,outputEnd:32};
 const result=await FinalizeCaptionInput(F.Job,media,new AbortController().signal);
 assert.equal(result.phase,'recognized');assert.ok(F.Calls.includes('fallback'));assert.ok(F.Calls.includes('recognize'));assert.equal(F.Job.captionMode,'postprocess');
});
test('window recovery requires the same owned completed HLS file and no saved receipts',async t=>{
 for(const options of [{unowned:true},{receipt:true},{empty:true}]){
  const F=Fixture(t,{cached:true,error:'caption_window_guard',receipt:options.receipt});F.Job.captionCommittedInput=false;F.Job.captionSourceInfo={windowed:true};F.Job.captionFinalTiming={duration:32};
  const media=new Blob(options.empty?[]:['complete']);if(!options.unowned)CaptionOutputSession(F.Job).rawFile=media;
  await assert.rejects(FinalizeCaptionInput(F.Job,media,new AbortController().signal),/caption_window_guard/);assert.equal(F.Calls.includes('fallback'),false);
 }
});
test('failed quiescence and cancellation cannot start the replacement upload',async t=>{
 const F=Fixture(t,{closeError:true});await assert.rejects(FinalizeCaptionInput(F.Job,new Blob(['completed']),new AbortController().signal),/caption_busy/);assert.equal(F.Calls.includes('begin'),false);
 const G=Fixture(t),C=new AbortController();C.abort();await assert.rejects(FinalizeCaptionInput(G.Job,new Blob(['completed']),C.signal));assert.equal(G.Calls.includes('fallback'),false);
});
test('a replacement attempt waits for the old window failure report',async t=>{
 globalThis.chrome={runtime:{onMessage:{addListener(){}}}};
 const {CreateConcurrentCaptionRunner}=await import('../extension/lib/concurrent-captions-runner.js');
 const {CaptionOptionsKey}=await import('../extension/lib/local-captions-settings.js');
 const Job={requestId:crypto.randomUUID(),localCaptions:{enabled:true}},Reported=Promise.withResolvers(),Tail=Promise.withResolvers();let Attempts=0;
 const Runner=CreateConcurrentCaptionRunner({stage:async(_Job,Action)=>{
  if(Action==='capabilities')return {jobOptionsKey:CaptionOptionsKey(Job.localCaptions),connected:true,executionProtocol:2,engineReady:true,converterReady:true,modelManagement:true,modelDownloadVersion:3,captionTranslationVersion:1,recognitionOptionsVersion:1,captionPackageVersion:7,captionConcurrencyVersion:1,captionFinalizeVersion:2,captionWindowVersion:2};
  if(Action==='beginAttempt')return {attempt:++Attempts};
  if(Action==='openConcurrent'||Action==='status')return {credit:1,phase:'queued'};
  if(Action==='failure'){Reported.resolve();await Tail.promise;}
  return {};
 }});
 t.after(async()=>{Tail.resolve();await Runner.release(Job.requestId);await ReleaseCaptionOutputSession(Job.requestId);delete globalThis.chrome;});
 const Signal=new AbortController().signal;
 await Runner.windowed(Job,{next:async()=>{throw Error('caption_seam_unresolved');},release:async()=>{}},Signal,'fixture');
 await Reported.promise;
 const Recovery=Runner.fallback(Job,'caption_seam_unresolved',Signal);
 await new Promise(R=>setImmediate(R));assert.equal(Attempts,1,'old failure report must settle before beginAttempt');
 Tail.resolve();await Recovery;assert.equal(Attempts,2);
});
