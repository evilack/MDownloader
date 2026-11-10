import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateCaptionExecution} from '../extension/lib/caption-execution.js';
import {CreateCaptionWindowMerger} from '../extension/lib/caption-window-merge.js';
import {CaptionCueRecord} from '../extension/lib/caption-timing-correction.js';
const Id='12345678-1234-1234-1234-123456789abc';
const Options={engine:'faster-whisper',model:'base',language:'auto',formats:['vtt','srt'],recognition:{}};
function Harness({decodeError=false,collision=false,inferenceGate,copyGate,inferenceResult}={}){
 const Files=new Map(),Calls=[],Events=[];let DecodeError=decodeError,Collision=collision;
 const Backend=async M=>{
  Calls.push(M);if(M.action==='cancelExecution')return {canceled:true};
  assert.equal(M.action,'execute');const Key=M.area+':'+M.path;
  switch(M.operation){
   case 'usage':return {bytes:0,free:100*1024**3};
   case 'probe':return {executionProtocol:2,persistentReady:true,engineReady:true,converterReady:true,wordTimestampsVersion:1};
   case 'list':return {entries:[]};
   case 'move':{Files.set(M.area+':'+M.target,Files.get(M.area+':'+M.source));Files.delete(M.area+':'+M.source);return {moved:true};}
   case 'stat':return {exists:Files.has(Key),size:Files.get(Key)?.length||0,isDirectory:false};
   case 'write':{const B=Buffer.from(M.data,'base64'),Old=M.truncate?Buffer.alloc(0):Files.get(Key)||Buffer.alloc(0);assert.equal(M.offset,Old.length);Files.set(Key,Buffer.concat([Old,B]));return {offset:Old.length+B.length};}
   case 'read':{const B=Files.get(Key);if(!B)throw Error('caption_source_missing');const Part=B.subarray(M.offset,M.offset+M.maxBytes);return {data:Part.toString('base64'),offset:M.offset+Part.length,done:M.offset+Part.length===B.length};}
   case 'decode':if(DecodeError){DecodeError=false;throw Error('caption_prepare_failed');}return {files:M.trim?[{path:M.output+'/part-0.wav',frames:M.trim.frames,rate:16000}]:[{path:M.output+'/part-0.wav',frames:16000,rate:16000},{path:M.output+'/part-1.wav',frames:16000,rate:16000}]};
   case 'sessionOpen':return {sessionId:M.sessionId};
   case 'sessionInfer':{await inferenceGate;const B=Buffer.from(JSON.stringify(inferenceResult||{language:'ko',segments:[[0,0.5,'안녕하세요']],words:[[0,0.5,'안녕하세요',0,.9]]}));Files.set('jobs:'+M.output,B);return {path:M.output,bytes:B.length};}
   case 'copyExclusive':await copyGate;if(Collision){Collision=false;throw Error('caption_output_exists');}return {name:M.name};
   case 'sessionClose':return {closed:true};
   case 'remove':for(const K of Files.keys())if(K===Key||K.startsWith(Key+'/'))Files.delete(K);return {removed:true};
   default:throw Error('unsupported fake primitive '+M.operation);
  }
 };
 const Execution=CreateCaptionExecution({request:Backend,emit:E=>Events.push(E)});
 const Request=(action,Fields={})=>Execution.request({action,jobId:Id,attempt:1,...Fields});
 const Until=async Phase=>{for(let I=0;I<100;I++){const S=await Request('status');if(S.phase===Phase)return S;if(S.phase==='failed')throw Error(S.error);await new Promise(R=>setImmediate(R));}throw Error('phase not reached '+Phase);};
 return {Execution,Request,Until,Files,Calls,Events,Backend};
}
test('extension sequences decode and individual inference, serializes results and chooses collision names',async()=>{
 const H=Harness({collision:true});await H.Request('begin');await H.Request('append',{offset:0,data:btoa('media')});await H.Request('prepare');await H.Until('audio-ready');
 await H.Request('start',{options:Options});await H.Until('recognized');
 const Vtt=await H.Request('readResult',{format:'vtt',offset:0});const Text=Buffer.from(Vtt.data,'base64').toString();
 assert.match(Text,/00:00:01\.000 --> 00:00:01\.500/);assert.match(Text,/안녕하세요/);
 const Saved=await H.Request('saveResult',{videoPath:'C:/Videos/movie.mp4',formats:['vtt']});assert.deepEqual(Saved.outputs,['movie.generated (1).vtt']);
 assert.deepEqual(H.Calls.filter(C=>C.operation==='copyExclusive').map(C=>C.name),['movie.generated.vtt','movie.generated (1).vtt']);
 assert.equal(H.Calls.filter(C=>C.operation==='sessionInfer').length,2);assert.ok(H.Calls.every(C=>['execute','cancelExecution'].includes(C.action)));
 assert.ok(!H.Calls.some(C=>C.fallbackPath||C.formats||C.mapping));
});
test('extension owns fallback after failed preparation; native sees a separate explicit decode',async()=>{
 const H=Harness({decodeError:true});await H.Request('begin');await H.Request('prepare');await H.Until('preparation-failed');
 await H.Request('start',{options:Options,fallbackPath:'C:/Videos/final.mp4',offset:50});await H.Until('recognized');
 const Decodes=H.Calls.filter(C=>C.operation==='decode');assert.equal(Decodes.length,2);assert.deepEqual(Decodes[1].source,{external:'C:/Videos/final.mp4'});
 const Text=Buffer.from((await H.Request('readResult',{format:'vtt',offset:0})).data,'base64').toString();assert.match(Text,/00:00:00\.000/);
});
test('cancel prevents further inference and a stale attempt cannot read a successor',async()=>{
 const H=Harness();await H.Request('begin');await H.Request('cancel');await assert.rejects(H.Request('prepare'),/caption_canceled/);
 assert.equal(H.Calls.filter(C=>C.operation==='sessionInfer').length,0);
 await H.Request('begin',{attempt:2});await assert.rejects(H.Request('status'),/caption_stale_attempt/);
 await assert.rejects(H.Request('start',{options:Options,sourcePath:'C:/Videos/video.mp4'}),/caption_stale_attempt/);
});
test('explicit retry of saved media after cancellation uses a fresh execution scope',async()=>{
 const H=Harness();await H.Request('begin');await H.Request('cancel');
 await H.Request('start',{options:Options,sourcePath:'C:/Videos/video.mp4'});await H.Until('recognized');
 const Canceled=H.Calls.find(C=>C.action==='cancelExecution').scope,Active=H.Calls.find(C=>C.operation==='sessionOpen').scope;assert.notEqual(Canceled,Active);
 await H.Request('complete');assert.equal((await H.Request('status')).phase,'complete');
});
test('duplicate start is admitted once while inference is active',async()=>{
 let Release;const H=Harness({inferenceGate:new Promise(R=>Release=R)});await H.Request('begin');await H.Request('prepare');await H.Until('audio-ready');
 await H.Request('start',{options:Options});await H.Until('recognizing');await H.Request('start',{options:Options});
 assert.equal(H.Calls.filter(C=>C.operation==='sessionInfer').length,1);Release();await H.Until('recognized');assert.equal(H.Calls.filter(C=>C.operation==='sessionOpen').length,1);
});
test('window inference is commanded by extension and unknown coverage cannot be finalized',async()=>{
 const H=Harness();const Data=Buffer.from('compressed AAC'),Sha=Buffer.from(await crypto.subtle.digest('SHA-256',Data)).toString('hex'),Window={id:Sha,epoch:0,inputStartSample:0,inputEndSample:16000,coreStartSample:0,coreEndSample:16000,bytes:Data.length,sha256:Sha,codec:'aac'};
 await H.Request('openConcurrent',{options:Options,sourceFingerprint:Sha});await H.Request('beginWindow',{window:Window});await H.Request('appendWindow',{windowId:Window.id,offset:0,data:Data.toString('base64')});await H.Request('sealWindow',{windowId:Window.id,bytes:Data.length,sha256:Sha});
 let Page;for(let I=0;I<100;I++){Page=await H.Request('windowResults',{cursor:0,limit:64});if(Page.items.length)break;await new Promise(R=>setImmediate(R));}
 assert.equal(Page.items[0].windowId,Window.id);assert.equal(Page.items[0].resultRef,true);
 await H.Request('ackWindows',{windowIds:[Window.id],committedSamples:16000});await H.Request('sealConcurrent',{sourceEndSample:16000,reason:'eof'});
 await H.Until('windowed-ready');const Cue=JSON.stringify({epoch:0,startSample:0,endSample:8000,text:'안녕하세요',windowId:Window.id,revision:1,cueIndex:0,firstWordIndex:0,lastWordIndex:0,sourceStartSample:0,sourceEndSample:8000})+'\n';await H.Request('appendFinalCues',{offset:0,data:Buffer.from(Cue).toString('base64'),done:true});
 const Mapping=[{epoch:0,validStartSample:0,validEndSample:32000,sourceOrigin:{ticks:0,timeBaseNum:1,timeBaseDen:1},trackShift:{ticks:0,timeBaseNum:1,timeBaseDen:1},shiftApplied:false}];
 await assert.rejects(H.Request('finalizeResult',{mapping:Mapping,outputStart:0,outputEnd:2,formats:['vtt'],expectedCoverage:{startSample:0,endSample:32000}}),/caption_coverage/);
 await H.Request('finalizeResult',{mapping:[{...Mapping[0],validEndSample:16000}],outputStart:0,outputEnd:1,formats:['vtt'],expectedCoverage:{startSample:0,endSample:16000}});assert.equal((await H.Request('status')).phase,'recognized');
 assert.ok(H.Calls.some(C=>C.operation==='remove'&&C.path.endsWith(Window.id+'/input.media')));
});
test('late save cannot overwrite a successor attempt',async()=>{
 let Release;const H=Harness({copyGate:new Promise(R=>Release=R)});await H.Request('start',{options:Options,sourcePath:'C:/video.mp4'});await H.Until('recognized');
 const Saving=H.Request('saveResult',{videoPath:'C:/video.mp4',formats:['vtt']});while(!H.Calls.some(C=>C.operation==='copyExclusive'))await new Promise(R=>setImmediate(R));
 await assert.rejects(H.Request('begin',{attempt:2}),/caption_busy/);Release();await Saving;await H.Request('begin',{attempt:2});assert.deepEqual((await H.Request('status',{attempt:2})).outputs,{});
});
for(const Case of [
 {name:'overlapping words',segments:[[0,.6,'A'],[.5,.9,' B']],words:[[0,.6,'A',0,.9],[.5,.9,' B',1,.9]],warning:true,times:[/00:00:00\.000 --> 00:00:00\.550/,/00:00:00\.550 --> 00:00:00\.900/]},
 {name:'reversed zero-duration prefix',segments:[[.2,.5,'「A']],words:[[.5,.5,'「',0,.9],[.2,.4,'A',0,.9]],times:[/00:00:00\.200 --> 00:00:00\.400/]},
 {name:'reversed zero-duration trailing punctuation',segments:[[.1,.4,'A!']],words:[[.2,.4,'A',0,.9],[.1,.1,'!',0,.9]],times:[/00:00:00\.200 --> 00:00:00\.400/]},
])test(Case.name+' provenance finalizes and saves without a failed phase',async()=>{
 const H=Harness({inferenceResult:{language:'en',segments:Case.segments,words:Case.words}}),Data=Buffer.from('audio'),Sha=Buffer.from(await crypto.subtle.digest('SHA-256',Data)).toString('hex');
 const Window={id:Sha,epoch:0,inputStartSample:0,inputEndSample:16000,coreStartSample:0,coreEndSample:16000,bytes:Data.length,sha256:Sha,codec:'aac'};
 await H.Request('openConcurrent',{options:Options,sourceFingerprint:Sha});await H.Request('beginWindow',{window:Window});await H.Request('appendWindow',{windowId:Sha,offset:0,data:Data.toString('base64')});await H.Request('sealWindow',{windowId:Sha,bytes:Data.length,sha256:Sha});
 let Page;for(let I=0;I<100;I++){Page=await H.Request('windowResults',{cursor:0,limit:64});if(Page.items.length)break;await new Promise(R=>setImmediate(R));}
 const Ref=Page.items[0],Part=await H.Request('readWindowResult',{windowId:Sha,offset:0}),Hypothesis=JSON.parse(Buffer.from(Part.data,'base64').toString()),Merger=CreateCaptionWindowMerger();Merger.accept(Hypothesis);const Final=Merger.seal();if(Case.warning)assert.ok(Final.warningCount>0);
 await H.Request('ackWindows',{windowIds:[Sha],committedSamples:16000});await H.Request('sealConcurrent',{sourceEndSample:16000,reason:'eof'});await H.Until('windowed-ready');
 const Ledger=Final.cues.map(C=>JSON.stringify(CaptionCueRecord(C))).join('\n')+'\n';await H.Request('appendFinalCues',{offset:0,data:Buffer.from(Ledger).toString('base64'),done:true});
 await H.Request('finalizeResult',{mapping:[{epoch:0,validStartSample:0,validEndSample:16000,sourceOrigin:{ticks:0,timeBaseNum:1,timeBaseDen:1},trackShift:{ticks:0,timeBaseNum:1,timeBaseDen:1},shiftApplied:false}],outputStart:0,outputEnd:1,formats:['vtt'],expectedCoverage:{startSample:0,endSample:16000}});
 const Text=Buffer.from((await H.Request('readResult',{format:'vtt',offset:0})).data,'base64').toString();for(const Pattern of Case.times)assert.match(Text,Pattern);
 await H.Request('saveResult',{videoPath:'C:/Videos/final.mp4',formats:['vtt']});await H.Request('complete');assert.equal((await H.Request('status')).phase,'complete');assert.ok(H.Events.every(E=>E.phase!=='failed'));assert.equal(Ref.resultRef,true);
});
test('disconnect releases completed session claims and a fresh status reloads interrupted state',async()=>{
 const H=Harness();await H.Request('begin');H.Execution.disconnect();assert.equal(H.Execution.busy(),false);const State=await H.Request('status');assert.equal(State.phase,'failed');assert.equal(State.error,'caption_source_missing');
});
