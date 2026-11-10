import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadAuthorizedYoutubePlayer} from '../extension/features/youtube/watch-player.js';
import {ValidateWatchPlaybackUrl} from '../extension/features/youtube/sabr.js';
const Id='Wv8sBV0MEfQ',Page='https://www.youtube.com/watch?v='+Id;
test('observed authorized transport retains every signed source parameter and exact host',()=>{
 const source='https://rr1.googlevideo.com/videoplayback?id=member&sig=signed&n=original';
 assert.equal(ValidateWatchPlaybackUrl(source,source.replace('n=original','n=played')+'&cpn=session'),source.replace('n=original','n=played')+'&cpn=session');
 for(const url of [source.replace('id=member','id=other'),source.replace('sig=signed','sig=other'),source.replace('rr1.googlevideo.com','evil.example'),source+'&unexpected=1'])assert.throws(()=>ValidateWatchPlaybackUrl(source,url));
});
test('authorized player capture targets only the resolved source document',async()=>{
 let request;const player={videoDetails:{videoId:Id},playabilityStatus:{status:'OK'}};
 const result=await ReadAuthorizedYoutubePlayer({tabId:7,documentId:'source',page:Page,url:Page},{executeScript:async value=>{request=value;return [{result:{player,clientVersion:'2.test'}}];}});
 assert.equal(result.player,player);assert.deepEqual(request.target,{tabId:7,documentIds:['source']});assert.equal(request.world,'MAIN');assert.deepEqual(request.args,[Id,Page]);
});
test('capture reads only a visible matching authorized finite player and never requests account cookies',async()=>{
 const saved={location:globalThis.location,document:globalThis.document,ytcfg:globalThis.ytcfg};
 const player={videoDetails:{videoId:Id},playabilityStatus:{status:'OK'},streamingData:{},playerConfig:{},captions:{}};
 try{
  globalThis.location={href:Page,origin:'https://www.youtube.com'};globalThis.document={visibilityState:'visible',querySelector:()=>({getPlayerResponse:()=>player}),get cookie(){assert.fail('cookies must not be read');}};globalThis.ytcfg={get:()=> '2.test'};
  const read=()=>ReadAuthorizedYoutubePlayer({tabId:7,documentId:'source',page:Page,url:Page},{executeScript:async request=>[{result:request.func(...request.args)}]});
  assert.equal((await read()).player.videoDetails.videoId,Id);
  player.playabilityStatus.status='LOGIN_REQUIRED';assert.equal(await read(),null);
  player.playabilityStatus.status='OK';player.videoDetails.videoId='wrong';assert.equal(await read(),null);
  player.videoDetails.videoId=Id;globalThis.document.visibilityState='hidden';assert.equal(await read(),null);
 }finally{for(const [key,value] of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
