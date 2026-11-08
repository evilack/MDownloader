import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NormalizeWatchPlayer, ReceiveSabrTracks} from '../extension/features/youtube/sabr.js';
const Id = '-XHx839rSc8';
test('requested finish drains writes and returns partial, cancel and writer failure never do',{timeout:5000},async()=>{
 for(const mode of ['finish','cancel','write-failure']){
  const stop=new AbortController(),cancel=new AbortController();let controllers=[],closed=0,aborted=0,writes=0;
  const createStream=()=>({on(){},async abort(){for(const c of controllers)c.error(Error('Stream aborted'));},start(){const stream=()=>new ReadableStream({start(c){controllers.push(c);c.enqueue(new Uint8Array([1]));}});return{videoStream:stream(),audioStream:stream()};}});
  const promise=ReceiveSabrTracks(NormalizeWatchPlayer(raw(),Id,{}),{video:134,audio:140},{createStream,stopSignal:stop.signal,signal:cancel.signal,createWriter:async()=>({async write(){writes++;if(mode==='write-failure'){stop.abort();throw Error('disk-full');}},async close(){closed++;},async abort(){aborted++;}})});
  void promise.catch(()=>{});while(writes<2)await new Promise(r=>setTimeout(r,0));
  if(mode==='cancel'){cancel.abort();stop.abort();}else stop.abort();
  if(mode==='finish'){const result=await promise;assert.equal(result.partial,true);assert.deepEqual(result.bytes,{video:1,audio:1});assert.equal(closed,2);}
  else{await assert.rejects(promise);assert.equal(closed,0);assert.equal(aborted,2);}
 }
});
const raw = () => ({videoDetails: {videoId: Id, title: 'Fixture', lengthSeconds: '2'}, playabilityStatus: {status: 'OK'},
 streamingData: {serverAbrStreamingUrl: 'https://r1.googlevideo.com/videoplayback?sabr=1', adaptiveFormats: [{itag:134, mimeType:'video/mp4; codecs="avc1.4d401e"', qualityLabel:'360p', bitrate:1, approxDurationMs:'2000'}, {itag:140, mimeType:'audio/mp4; codecs="mp4a.40.2"', audioQuality:'AUDIO_QUALITY_MEDIUM', bitrate:1, approxDurationMs:'2000'}]},
 playerConfig: {mediaCommonConfig: {mediaUstreamerRequestConfig: {videoPlaybackUstreamerConfig:'AA=='}}}});

test('completion uses each selected format duration instead of rounded page seconds',async()=>{
 const config=NormalizeWatchPlayer(raw(),Id,{});config.duration=623;config.formats[0].approxDurationMs='622567';config.formats[1].approxDurationMs='622853';
 let videoEnd=622567,closed=0,aborted=0;
 const createStream=()=>({videoEndTimeMs:videoEnd,audioEndTimeMs:622853,on(){},abort:async()=>{},start(){const stream=()=>new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();}});return{videoStream:stream(),audioStream:stream(),selectedFormats:{}};}});
 const options={createStream,createWriter:async()=>({write:async()=>{},close:async()=>closed++,abort:async()=>aborted++})};
 const result=await ReceiveSabrTracks(config,{video:134,audio:140},options);assert.deepEqual(result.bytes,{video:1,audio:1});assert.equal(closed,2);
 videoEnd=622000;await assert.rejects(ReceiveSabrTracks(config,{video:134,audio:140},options),{code:'youtube_sabr_receive_failed'});assert.equal(closed,2);assert.equal(aborted,2);
});
test('receiver passes the exact indexed language format instead of resolving its duplicate itag again',async()=>{
 const config=NormalizeWatchPlayer(raw(),Id,{});config.formats.push({...config.formats[1],xtags:'second',language:'en'});const normalized=config.formats.map(f=>({...f}));let selected;
 const createStream=()=>({formats:normalized,videoEndTimeMs:2000,audioEndTimeMs:2000,on(){},abort:async()=>{},start(options){selected=options.audioFormat;const stream=()=>new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();}});return{videoStream:stream(),audioStream:stream(),selectedFormats:{}};}});
 await ReceiveSabrTracks(config,{video:134,audio:140,videoFormatIndex:0,audioFormatIndex:2},{createStream,createWriter:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})});
 assert.equal(selected,normalized[2]);assert.equal(selected.language,'en');
});
test('SABR keeps URL-less formats but requires the exact public video and protocol config', () => {
 const result=NormalizeWatchPlayer(raw(),Id,{clientVersion:'2.test'});
 assert.equal(result.formats.length,2); assert.equal(result.videoId,Id);
 for(const change of [{videoDetails:{videoId:'wrong'}},{playabilityStatus:{status:'LOGIN_REQUIRED'}},{streamingData:{serverAbrStreamingUrl:'https://googlevideo.com.example.org/file'}},{playerConfig:{}}]) assert.throws(()=>NormalizeWatchPlayer({...raw(),...change},Id,{}));
});
test('SABR receive writes each track separately with bounded chunks and never declares empty output complete', async () => {
 const writes={video:[],audio:[]}; let options,aborts=0;
 const createStream=()=>({videoEndTimeMs:2000,audioEndTimeMs:2000,on(){},abort:async()=>aborts++,start(input){options=input;return {videoStream:new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.close();}}),audioStream:new ReadableStream({start(c){c.enqueue(new Uint8Array([3]));c.close();}}),selectedFormats:{videoFormat:{itag:134},audioFormat:{itag:140}}};}});
 const result=await ReceiveSabrTracks(NormalizeWatchPlayer(raw(),Id,{}),{video:134,audio:140},{createStream,createWriter:async kind=>({write:async chunk=>writes[kind].push(...chunk),close:async()=>{},abort:async()=>{}})});
 assert.deepEqual(result.bytes,{video:2,audio:1}); assert.equal(options.maxRetries,0); assert.deepEqual(writes,{video:[1,2],audio:[3]});
 await assert.rejects(ReceiveSabrTracks(NormalizeWatchPlayer(raw(),Id,{}),{video:134,audio:140},{createStream,limit:1,createWriter:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})}),{code:'youtube_sabr_size_limit'});
 assert.ok(aborts>0);
});
test('a normal-session token may pass through pending attestation but rejection stops the receiver', async () => {
 const config={...NormalizeWatchPlayer(raw(),Id,{}),poToken:'AQ=='};
 const createStream=()=>{const listeners={};return {videoEndTimeMs:2000,audioEndTimeMs:2000,on:(name,fn)=>listeners[name]=fn,abort:async()=>{},start:()=>{
  listeners.streamProtectionStatusUpdate({status:2});
  const stream=()=>new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();}});
  return {videoStream:stream(),audioStream:stream(),selectedFormats:{}};
 }};};
 const result=await ReceiveSabrTracks(config,{video:134,audio:140},{createStream,createWriter:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})});
 assert.equal(result.bytes.video,1);
});
test('incomplete tracks stay uncommitted unless keeping a partial prefix was explicitly requested',async()=>{
 for(const keepReceivedOnFailure of [false,true]){
  const actions=[];const stream=()=>new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.close();}});
  const createStream=()=>({videoEndTimeMs:1000,audioEndTimeMs:1000,on(){},abort:async()=>{},start:()=>({videoStream:stream(),audioStream:stream(),selectedFormats:{}})});
  await assert.rejects(ReceiveSabrTracks({...NormalizeWatchPlayer(raw(),Id,{}),duration:100},{video:134,audio:140},{createStream,keepReceivedOnFailure,createWriter:async kind=>({write:async()=>{},close:async()=>actions.push(kind+':commit'),abort:async()=>actions.push(kind+':abort')})}),{code:'youtube_sabr_receive_failed'});
  assert.deepEqual(actions.sort(),keepReceivedOnFailure?['audio:commit','video:commit']:['audio:abort','video:abort']);
 }
});
