import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CreateYoutubeClient} from '../extension/features/youtube/client.js';
import {CreateEvaluator} from '../extension/features/youtube/evaluator.js';
const VideoId = 'aqz-KE-bpKQ';
function harness(extra = {}) {
 const formats = [{itag: 137, url: 'https://rr1.googlevideo.com/fixture', has_video: true, has_audio: false, mime_type: 'video/mp4; codecs="avc1.640028"', height: 1080, width: 1920, fps: 30, content_length: 999, decipher: async () => 'https://rr1.googlevideo.com/videoplayback?expire=9999999999'}, {itag: 140, url: 'https://rr1.googlevideo.com/fixture', has_audio: true, has_video: false, mime_type: 'audio/mp4; codecs="mp4a.40.2"', decipher: async () => 'https://rr1.googlevideo.com/videoplayback?expire=9999999999'}];
 const info = {basic_info: {id: VideoId, title: 'Authorized fixture', duration: 5}, playability_status: {status: 'OK'}, streaming_data: {adaptive_formats: formats}};
 let calls = 0;
 const client = CreateYoutubeClient({hasPermission: async () => true, createInnertube: async () => ({getBasicInfo: async () => {calls++; return info;}, session: {player: {}}}), ...extra});
 return {client, info, formats, calls: () => calls};
}
test('fixture discovery retains URLs only in memory and resolves exact selected formats', async () => {
 const {client} = harness();
 const result = await client.DiscoverYoutube({pageUrl: `https://youtube.com/watch?v=${VideoId}`});
 assert.equal(result.videoId, VideoId);
 assert.equal(result.title, 'Authorized fixture');
 assert.equal(result.formats.length, 2);
 assert.equal(JSON.stringify(result).includes('googlevideo'), false);
 const resolved = await client.ResolveYoutubeSelection({sessionKey: result.sessionKey, videoId: VideoId, selection: {videoFormatId: '137', audioFormatId: '140', output: 'mp4'}});
 assert.deepEqual(resolved.tracks.map(track => track.kind), ['video', 'audio']);
 await assert.rejects(client.ResolveYoutubeSelection({sessionKey: result.sessionKey, videoId: 'wrong', selection: {videoFormatId: '137'}}), {code: 'youtube_session_changed'});
});
test('permissions are checked before networking and resolution; expiry cannot silently switch formats', async () => {
 let allowed = false;
 const h = harness({hasPermission: async () => allowed});
 await assert.rejects(h.client.DiscoverYoutube({pageUrl: `https://youtu.be/${VideoId}`}), {code: 'youtube_permission_denied'});
 assert.equal(h.calls(), 0);
 allowed = true;
 const result = await h.client.DiscoverYoutube({pageUrl: `https://youtu.be/${VideoId}`});
 h.formats[0].decipher = async () => 'https://rr1.googlevideo.com/videoplayback?expire=1';
 await assert.rejects(h.client.ResolveYoutubeSelection({sessionKey: result.sessionKey, videoId: VideoId, selection: {videoFormatId: '137'}}), {code: 'youtube_url_expired'});
 allowed = false;
 await assert.rejects(h.client.ResolveYoutubeSelection({sessionKey: result.sessionKey, videoId: VideoId, selection: {videoFormatId: '137'}}), {code: 'youtube_permission_denied'});
});
test('SABR-only, DRM and restricted/mismatched responses are explicit unsupported failures', async () => {
 for (const [change, code] of [[{streaming_data: {server_abr_streaming_url: 'https://rr1.googlevideo.com/sabr'}}, 'youtube_sabr_unsupported'], [{playability_status: {status: 'LOGIN_REQUIRED'}}, 'youtube_restricted'], [{basic_info: {id: 'different'}}, 'youtube_session_changed']]) {
  const h = harness(); Object.assign(h.info, change);
  await assert.rejects(h.client.DiscoverYoutube({pageUrl: `https://youtu.be/${VideoId}`}), {code});
 }
 const h = harness(); h.formats.forEach(format => format.drm_families = ['WIDEVINE']);
 await assert.rejects(h.client.DiscoverYoutube({pageUrl: `https://youtu.be/${VideoId}`}), {code: 'youtube_no_clear_formats'});
});
test('evaluator rejects oversized input, terminates stalled workers and never leaks script errors', async () => {
 let terminated = 0, started = 0;
 const evaluator = CreateEvaluator({timeoutMs: 20, createWorker: () => {started++; return {postMessage() {}, terminate() {terminated++;}};}});
 await assert.rejects(evaluator({output: 'x'.repeat(4 * 1024 * 1024 + 1)}, {}), {code: 'youtube_evaluator_input_limit'});
 assert.equal(started, 0);
 await assert.rejects(evaluator({output: 'while(true){}'}, {}), {code: 'youtube_evaluator_timeout'});
 assert.equal(terminated, 1);
});

test('SABR response containing format metadata without media URLs is unsupported', async () => {
 const h = harness();
 h.info.streaming_data.server_abr_streaming_url = 'https://rr1.googlevideo.com/sabr';
 for (const format of h.formats) delete format.url;
 await assert.rejects(h.client.DiscoverYoutube({pageUrl: `https://youtu.be/${VideoId}`}), {code: 'youtube_sabr_unsupported'});
});
test('actual automated-request 403 is classified without retrying or logging response secrets', async () => {
 const events = [];
 let requests = 0;
 const client = CreateYoutubeClient({hasPermission: async () => true, report: event => events.push(event),
  fetch: async () => {requests++; return new Response('Forbidden automated bot request secret-token', {status: 403});},
  createInnertube: async ({fetch}) => {await fetch('https://www.youtube.com/youtubei/v1/player', {method: 'POST', body: '{}'}); throw Error('must stop before this');}});
 await assert.rejects(client.DiscoverYoutube({pageUrl: `https://youtu.be/${VideoId}`}), {code: 'youtube_automated_request_rejected'});
 assert.equal(requests, 1);
 assert.equal(JSON.stringify(events).includes('secret-token'), false);
 assert.equal(events[0].status, 403);
});
test('explicit SABR discovery validates WEB first and resolves the exact VISIONOS session',async()=>{
 const requested=[];const h=harness();const web={...h.info,streaming_data:{server_abr_streaming_url:'https://r1.googlevideo.com/videoplayback?sabr=1'}};
 const sabr={...h.info,streaming_data:{server_abr_streaming_url:'https://r1.googlevideo.com/videoplayback?sabr=1',adaptive_formats:h.formats},player_config:{media_common_config:{media_ustreamer_request_config:{video_playback_ustreamer_config:'AA=='}}}};
 const client=CreateYoutubeClient({hasPermission:async()=>true,createInnertube:async()=>({getBasicInfo:async(id,{client})=>{requested.push(client);return client==='WEB'?web:sabr;},session:{player:{decipher:async url=>url}}})});
 const discovered=await client.DiscoverYoutube({pageUrl:`https://youtu.be/${VideoId}`,transport:'sabr'});
 assert.deepEqual(requested,['WEB','VISIONOS']);assert.equal(discovered.transport,'sabr');assert.equal(JSON.stringify(discovered).includes('googlevideo'),false);
 const resolved=await client.ResolveYoutubeSelection({sessionKey:discovered.sessionKey,videoId:VideoId,selection:{videoFormatId:discovered.formats[0].id,audioFormatId:discovered.formats[1].id}});
 assert.equal(resolved.transport,'sabr');assert.equal(resolved.config.clientInfo.clientName,101);assert.equal(resolved.config.ustreamerConfig,'AA==');assert.deepEqual(resolved.selection,{video:137,audio:140,videoFormatIndex:0,audioFormatIndex:1});
});
test('SABR catalog and resolution retain a second language variant sharing the same itag',async()=>{
 const h=harness();const formats=[h.formats[0],{...h.formats[1],xtags:'original',language:'ko'},{...h.formats[1],xtags:'dubbed',language:'en'}];
 const info={...h.info,streaming_data:{server_abr_streaming_url:'https://r1.googlevideo.com/videoplayback?sabr=1',adaptive_formats:formats},player_config:{media_common_config:{media_ustreamer_request_config:{video_playback_ustreamer_config:'AA=='}}}};
 const client=CreateYoutubeClient({hasPermission:async()=>true,createInnertube:async()=>({getBasicInfo:async()=>info,session:{player:{decipher:async u=>u}}})});
 const discovery=await client.DiscoverYoutube({pageUrl:`https://youtu.be/${VideoId}`,transport:'sabr'});
 assert.notEqual(discovery.formats[1].id,discovery.formats[2].id);
 const resolved=await client.ResolveYoutubeSelection({sessionKey:discovery.sessionKey,videoId:VideoId,selection:{videoFormatId:discovery.formats[0].id,audioFormatId:discovery.formats[2].id}});
 assert.equal(resolved.selection.audioFormatIndex,2);assert.equal(resolved.config.formats[resolved.selection.audioFormatIndex].language,'en');
});
test('SABR never switches clients for a restricted public WEB response',async()=>{
 const requested=[];const client=CreateYoutubeClient({hasPermission:async()=>true,createInnertube:async()=>({getBasicInfo:async(id,{client})=>{requested.push(client);return{basic_info:{id:VideoId},playability_status:{status:'LOGIN_REQUIRED'}};}})});
 await assert.rejects(client.DiscoverYoutube({pageUrl:`https://youtu.be/${VideoId}`,transport:'sabr'}),{code:'youtube_restricted'});assert.deepEqual(requested,['WEB']);
});

test('restricted anonymous lookup can use the exact authorized finite watch response without switching clients',async()=>{
 const h=harness(),requested=[];
 const player={videoDetails:{videoId:VideoId,title:'Member video',lengthSeconds:'5'},playabilityStatus:{status:'OK'},streamingData:{serverAbrStreamingUrl:'https://rr1.googlevideo.com/sabr?expire=9999999999',adaptiveFormats:[]},playerConfig:{mediaCommonConfig:{mediaUstreamerRequestConfig:{videoPlaybackUstreamerConfig:'fixture'}}}};
 const parsed={...h.info,streaming_data:{...h.info.streaming_data,server_abr_streaming_url:player.streamingData.serverAbrStreamingUrl},player_config:{media_common_config:{media_ustreamer_request_config:{video_playback_ustreamer_config:'fixture'}}}};
 const client=CreateYoutubeClient({hasPermission:async()=>true,createInnertube:async()=>({getBasicInfo:async(_id,{client})=>{requested.push(client);return{basic_info:{id:VideoId},playability_status:{status:'UNPLAYABLE'}};},session:{player:{decipher:async()=>assert.fail('played URL must not be deciphered a second time')}}}),parseWatchPlayer:async(_tube,raw)=>{assert.equal(raw,player);return parsed;}});
 const info=await client.DiscoverYoutube({pageUrl:`https://youtu.be/${VideoId}`,transport:'sabr',watchPlayer:{player,clientVersion:'2.fixture',resolvedUrl:player.streamingData.serverAbrStreamingUrl+'&rn=1'}});
 assert.deepEqual(requested,['WEB']);assert.equal(info.title,'Authorized fixture');
 const resolved=await client.ResolveYoutubeSelection({sessionKey:info.sessionKey,videoId:VideoId,selection:{videoFormatId:'137:0',audioFormatId:'140:1'}});
 assert.equal(resolved.config.clientInfo.clientName,1);assert.equal(resolved.config.clientInfo.clientVersion,'2.fixture');
 assert.equal(resolved.config.url,player.streamingData.serverAbrStreamingUrl+'&rn=1');
 player.videoDetails.videoId='wrong';
 await assert.rejects(client.DiscoverYoutube({pageUrl:`https://youtu.be/${VideoId}`,transport:'sabr',watchPlayer:{player,clientVersion:'2.fixture'}}),{code:'youtube_session_changed'});
 player.videoDetails.videoId=VideoId;player.playabilityStatus.status='LOGIN_REQUIRED';
 await assert.rejects(client.DiscoverYoutube({pageUrl:`https://youtu.be/${VideoId}`,transport:'sabr',watchPlayer:{player,clientVersion:'2.fixture'}}),{code:'youtube_restricted'});
});
