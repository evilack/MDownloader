import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateYoutubeClient} from '../extension/features/youtube/client.js';
import {ReceiveYoutubeCaptions} from '../extension/features/youtube/captions.js';
const Id='-XHx839rSc8';
function harness(captions){const info={basic_info:{id:Id,title:'fixture',duration:2},playability_status:{status:'OK'},captions:{caption_tracks:captions},streaming_data:{adaptive_formats:[{itag:137,url:'https://rr.googlevideo.com/test',has_video:true,mime_type:'video/mp4; codecs="avc1.4d401e"',decipher:async()=> 'https://rr.googlevideo.com/test?expire=9999999999'}]}};let allowed=true;return{client:CreateYoutubeClient({hasPermission:async()=>allowed,createInnertube:async()=>({getBasicInfo:async()=>info,session:{player:{}}})}),revoke(){allowed=false;}};}
const caption={base_url:`https://www.youtube.com/api/timedtext?v=${Id}&signature=private&expire=9999999999`,language_code:'ko',name:{toString:()=> '한국어'},vss_id:'.ko',kind:'asr'};
test('caption public catalog hides signed URLs and resolve binds to the same video/session',async()=>{
 const h=harness([caption]);const info=await h.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});
 assert.equal(info.captions.length,1);assert.equal(info.captions[0].language,'ko');assert.equal(JSON.stringify(info).includes('signature'),false);
 const args={sessionKey:info.sessionKey,videoId:Id};const result=await h.client.ResolveYoutubeCaptions(args);assert.equal(result[0].format,'vtt');assert.equal(new URL(result[0].url).searchParams.get('fmt'),'vtt');
 await assert.rejects(h.client.ResolveYoutubeCaptions({...args,videoId:'aqz-KE-bpKQ'}),{code:'youtube_session_changed'});
 h.revoke();await assert.rejects(h.client.ResolveYoutubeCaptions(args),{code:'youtube_permission_denied'});
});
test('caption source cannot escape YouTube timedtext, replace video ID, or silently drop malformed tracks',async()=>{
 for(const url of ['https://evil.test/api/timedtext?v='+Id,'https://www.youtube.com/redirect?v='+Id,'https://www.youtube.com/api/timedtext?v=aqz-KE-bpKQ']){
  const h=harness([{...caption,base_url:url}]);await assert.rejects(h.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`}),{code:'youtube_unexpected_host'});
 }
});
test('caption receive uses the shared reader, omits credentials, and rejects empty/error responses',async()=>{
 const h=harness([caption]);const info=await h.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});const requests=[],events=[];
 const result=await ReceiveYoutubeCaptions(h.client,info,new AbortController().signal,{hasPermission:async()=>true,report:async e=>events.push(e),fetch:async(url,init)=>{requests.push({url,init});return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n안녕하세요\n');}});
 assert.equal(result.tracks.length,1);assert.equal(result.receipt.tracks[0].cues,1);assert.equal(requests[0].init.credentials,'omit');assert.equal(JSON.stringify(events).includes('signature'),false);
 for(const response of [new Response(''),new Response('denied',{status:403})])await assert.rejects(ReceiveYoutubeCaptions(h.client,info,new AbortController().signal,{hasPermission:async()=>true,fetch:async()=>response}));
});
test('caption resolution rejects expired signed sources and expired sessions before acquisition',async t=>{
 const expired=harness([{...caption,base_url:`https://www.youtube.com/api/timedtext?v=${Id}&expire=1`}]);
 const old=await expired.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});await assert.rejects(expired.client.ResolveYoutubeCaptions(old),{code:'youtube_url_expired'});
 const h=harness([caption]),info=await h.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});const now=Date.now();t.mock.method(Date,'now',()=>now+31*60*1000);
 await assert.rejects(h.client.ResolveYoutubeCaptions(info),{code:'youtube_session_changed'});
});
test('SABR caption union retains WEB-only languages and prefers VISIONOS only for the same identity',async()=>{
 const en={...caption,language_code:'en',vss_id:'a.en',base_url:caption.base_url+'&profile=web'};
 const ko={...caption,vss_id:'a.ko'};
 const manual={...en,kind:undefined,vss_id:'.en'};
 const preferred={...en,base_url:caption.base_url+'&profile=visionos'};
 const info={basic_info:{id:Id,title:'fixture',duration:2},playability_status:{status:'OK'},captions:{caption_tracks:[en,ko,manual]},streaming_data:{adaptive_formats:[{itag:137,has_video:true,mime_type:'video/mp4; codecs="avc1.4d401e"'}],server_abr_streaming_url:'https://rr.googlevideo.com/sabr'},player_config:{media_common_config:{media_ustreamer_request_config:{video_playback_ustreamer_config:'fixture'}}}};
 const client=CreateYoutubeClient({hasPermission:async()=>true,createInnertube:async()=>({getBasicInfo:async(_id,{client})=>client==='WEB'?info:{...info,captions:{caption_tracks:[preferred]}},session:{player:{}}})});
 const result=await client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`,transport:'sabr'});assert.deepEqual(result.captions.map(t=>t.language),['en','ko','en']);
 const sources=await client.ResolveYoutubeCaptions(result);assert.equal(new URL(sources[0].url).searchParams.get('profile'),'visionos');assert.equal(new URL(sources[2].url).searchParams.get('profile'),'web');
 assert.equal(new Set(result.captions.map(t=>t.id)).size,3);
});
test('shared job state receives original caption count, languages and completion',async t=>{
 const job={requestId:'captions',youtube:true,state:'active'};let stored;
 globalThis.chrome={storage:{local:{async get(key){return{[key]:job};},async set(value){stored=Object.values(value)[0];}}}};t.after(()=>delete globalThis.chrome);
 const {UpdateHls}=await import('../extension/jobs.js');await UpdateHls({requestId:'captions',action:'youtubeCaptions',receipt:{phase:'ready',count:2,completed:2,tracks:[{language:'en'},{language:'ko'}]}});
 assert.equal(stored.subtitleCount,2);assert.deepEqual(stored.subtitleStatus,{phase:'ready',count:2,completed:2,languages:['en','ko'],targetLanguage:'',translation:'off'});
});
test('genuinely absent captions are explicit unavailable metadata and do not trigger subtitle fetch',async()=>{
 const h=harness([]),info=await h.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});let fetched=false;
 const r=await ReceiveYoutubeCaptions(h.client,info,new AbortController().signal,{hasPermission:async()=>true,fetch:async()=>{fetched=true;throw Error('unexpected');}});
 assert.equal(r.receipt.phase,'unavailable');assert.equal(r.receipt.count,0);assert.equal(fetched,false);
});
test('excluding ASR preserves manual captions and ignores expired unselected automatic sources',async()=>{
 const h=harness([{...caption,base_url:`https://www.youtube.com/api/timedtext?v=${Id}&expire=1`},{...caption,kind:undefined,vss_id:'.ko',base_url:caption.base_url+'&manual=1'}]);
 const info=await h.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});
 const tracks=await h.client.ResolveYoutubeCaptions(info,new AbortController().signal,{includeAutoGenerated:false});assert.equal(tracks.length,1);assert.equal(tracks[0].kind,undefined);
 let fetched=0;const allAuto=harness([caption]),discovery=await allAuto.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});
 const r=await ReceiveYoutubeCaptions(allAuto.client,discovery,new AbortController().signal,{includeAutoGenerated:false,hasPermission:async()=>true,fetch:async()=>{fetched++;throw Error('ASR must not be fetched');}});
 assert.equal(fetched,0);assert.equal(r.tracks.length,0);assert.equal(r.receipt.phase,'not-selected');assert.equal(r.receipt.httpResponses,0);
});
test('only selected YouTube captions are resolved and an unselected expired track does not block them',async()=>{
 const h=harness([{...caption,base_url:`https://www.youtube.com/api/timedtext?v=${Id}&expire=1`},{...caption,language_code:'en',kind:undefined,vss_id:'.en',base_url:caption.base_url+'&manual=1'}]);
 const info=await h.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});
 let fetched=0;
 const result=await ReceiveYoutubeCaptions(h.client,info,new AbortController().signal,{trackIds:[info.captions[1].id],translation:{enabled:false},hasPermission:async()=>true,fetch:async()=>{fetched++;return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n');}});
 assert.equal(fetched,1); assert.deepEqual(result.tracks.map(t=>t.language),['en']);
});

test('YouTube target-language deselection survives client resolution and caption receiver filtering',async()=>{
 const english={...caption,language_code:'en',vss_id:'a.en',base_url:caption.base_url+'&lang=en'};
 const h=harness([english,caption]),info=await h.client.DiscoverYoutube({pageUrl:`https://youtu.be/${Id}`});
 const translation={enabled:true,targetLanguage:'ko'},trackIds=[info.captions[0].id];
 const selected=await h.client.ResolveYoutubeCaptions(info,new AbortController().signal,{trackIds,translation});assert.deepEqual(selected.map(t=>t.language),['en']);
 const result=await ReceiveYoutubeCaptions({ResolveYoutubeCaptions:async()=>[...selected,{id:info.captions[1].id,url:caption.base_url,language:'ko',format:'vtt'}]},info,new AbortController().signal,{trackIds,translation,hasPermission:async()=>true,
  fetch:async()=>new Response('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nEnglish source\n')});
 assert.deepEqual(result.tracks.map(t=>t.language),['en']);
});
