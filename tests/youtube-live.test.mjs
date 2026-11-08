import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateYoutubeClient} from '../extension/features/youtube/client.js';
import {YoutubeQualities} from '../extension/features/youtube/qualities.js';
import {WaitForYoutubeBroadcast} from '../extension/features/youtube/live.js';
import {CreateYoutubeRunner} from '../extension/features/youtube/runner.js';
import {ReloadPlayerInfo} from '../tools/build/youtube-client-entry.mjs';
const id='JXR579POAu4';
test('official player endpoint forwards the exact SABR reload context on the same client',async()=>{
 const context={reloadPlaybackParams:'fixture-context'};let payload;const sent=new Error('request-observed');
 const tube={session:{player:{signature_timestamp:123}},actions:{execute:async(_path,body)=>{payload=body;throw sent;}}};
 await assert.rejects(ReloadPlayerInfo(tube,id,context),error=>error===sent);assert.equal(payload.videoId,id);assert.equal(payload.client,'VISIONOS');assert.deepEqual(payload.playbackContext.reloadPlaybackContext,context);assert.equal(payload.playbackContext.contentPlaybackContext.signatureTimestamp,123);
});
function info(mode){return{basic_info:{id,title:'Broadcast',duration:0,is_live:mode==='live',is_upcoming:mode==='upcoming'},playability_status:{status:mode==='upcoming'?'LIVE_STREAM_OFFLINE':'OK'},streaming_data:{server_abr_streaming_url:'https://r1.googlevideo.com/videoplayback?source=yt_live_broadcast',adaptive_formats:[{itag:134,has_video:true,mime_type:'video/mp4; codecs="avc1.4d401e"',width:640,height:360,bitrate:100},{itag:140,has_audio:true,mime_type:'audio/mp4; codecs="mp4a.40.2"',bitrate:50}]},player_config:{media_common_config:{media_ustreamer_request_config:{video_playback_ustreamer_config:'AA=='}}}};}
function client(value){return CreateYoutubeClient({hasPermission:async()=>true,createInnertube:async()=>({getBasicInfo:async()=>value,session:{player:{decipher:async u=>u}}})});}
test('authorized broadcast source retains live mode when the API omits isLive',async()=>{const value=info('live');value.basic_info.is_live=false;const result=await client(value).DiscoverYoutube({pageUrl:'https://youtu.be/'+id,transport:'sabr'});assert.equal(result.mode,'live');});
test('live callbacks carry initial heartbeat state, updates, and exact server reload context',async()=>{
 const value=info('live');value.page=[{heartbeat_params:{heartbeat_token:'fixture-token',heartbeat_server_data:'first',interval_milliseconds:'5000'}}];let reloaded;
 const c=CreateYoutubeClient({hasPermission:async()=>true,reloadPlayer:async(_tube,videoId,context)=>{reloaded={videoId,context};return value;},createInnertube:async()=>({getBasicInfo:async()=>value,session:{player:{decipher:async u=>u}},actions:{execute:async()=>({data:{heartbeatServerData:'updated',playabilityStatus:{status:'OK'}}})}})});
 const result=await c.DiscoverYoutube({pageUrl:'https://youtu.be/'+id,transport:'sabr'});const resolved=await c.ResolveYoutubeSelection(YoutubeQualities(result)[0].quality);
 assert.deepEqual(resolved.config.heartbeatParams,{heartbeatToken:'fixture-token',heartbeatServerData:'first',intervalMilliseconds:'5000'});
 assert.equal((await resolved.config.callbacks.onCheckHeartbeat({videoId:id})).heartbeatServerData,'updated');
 const context={reloadPlaybackParams:'fixture-reload'};await resolved.config.callbacks.onReloadPlayerResponse(context);assert.deepEqual(reloaded,{videoId:id,context});
});
test('explicit upcoming response creates a waiting choice without SABR URLs or absent formats',async()=>{const result=await client(info('upcoming')).DiscoverYoutube({pageUrl:'https://youtu.be/'+id,transport:'sabr'});assert.equal(result.mode,'upcoming');const [choice]=YoutubeQualities(result);assert.equal(choice.quality.scheduled,true);assert.equal(choice.quality.videoId,id);assert.equal(JSON.stringify(result).includes('googlevideo'),false);});
test('live zero duration resolves an exact AVC/AAC pair while protected WEB remains refused',async()=>{const c=client(info('live'));const result=await c.DiscoverYoutube({pageUrl:'https://youtu.be/'+id,transport:'sabr'});assert.equal(result.mode,'live');const resolved=await c.ResolveYoutubeSelection(YoutubeQualities(result)[0].quality);assert.equal(resolved.config.live,true);const denied=info('upcoming');denied.playability_status.status='LOGIN_REQUIRED';await assert.rejects(client(denied).DiscoverYoutube({pageUrl:'https://youtu.be/'+id,transport:'sabr'}),{code:'youtube_restricted'});});
test('scheduled waiting rechecks pinned identity and chooses fresh available formats at start',async()=>{let calls=0,waits=0;const live=await client(info('live')).DiscoverYoutube({pageUrl:'https://youtu.be/'+id,transport:'sabr'});const c={DiscoverYoutube:async()=>++calls<3?{videoId:id,mode:'upcoming'}:live};const reports=[];const result=await WaitForYoutubeBroadcast(c,{videoId:id,scheduled:true},{signal:new AbortController().signal,report:async r=>reports.push(r),wait:async ms=>{assert.equal(ms,30000);waits++;}});assert.equal(waits,2);assert.equal(result.videoId,id);assert.ok(result.selection.videoFormatId);assert.equal(reports[0].waiting,true);});
test('waiting cancellation or identity change cannot start another broadcast',async()=>{const controller=new AbortController();await assert.rejects(WaitForYoutubeBroadcast({DiscoverYoutube:async()=>({videoId:id,mode:'upcoming'})},{videoId:id,scheduled:true},{signal:controller.signal,report:async()=>{},wait:async()=>controller.abort()}),{name:'AbortError'});await assert.rejects(WaitForYoutubeBroadcast({DiscoverYoutube:async()=>({videoId:'wrong',mode:'live'})},{videoId:id,scheduled:true},{signal:new AbortController().signal,report:async()=>{},wait:async()=>{}}),{key:'youtube_session_changed'});});

test('canceling a queued broadcast allocates no scratch/output and releases active ownership',async()=>{
 let allocations=0,saves=0;const events=[];const requestId='77777777-7777-4777-8777-777777777777';
 const handler=CreateYoutubeRunner({client:{},workspaces:{create:async()=>{allocations++;}},waitForBroadcast:async(_c,_q,{signal,report})=>{await report({waiting:true});return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}});
 await handler({type:'youtubeRun',job:{requestId,waiting:true},quality:{videoId:id,scheduled:true}},{report:async(...args)=>events.push(args),saveFile:async()=>saves++});
 await new Promise(r=>setTimeout(r,0));assert.deepEqual(await handler({type:'youtubeActive'}),[requestId]);assert.equal(events[0][2].waiting,true);
 await handler({type:'youtubeCancel',requestId});await new Promise(r=>setTimeout(r,0));assert.deepEqual(await handler({type:'youtubeActive'}),[]);assert.equal(allocations,0);assert.equal(saves,0);assert.equal(events.at(-1)[2].canceled,true);
});
