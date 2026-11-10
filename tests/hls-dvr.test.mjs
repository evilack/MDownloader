import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import * as Hls from '../extension/lib/hls.js';
import {GetMediaFormatLabel} from '../extension/lib/media.js';
import {ObserveResponse,ObserveManifest,NetworkCandidates} from '../extension/network.js';
import {FindMedia,Scan} from '../extension/detection.js';
import {DiscoverHlsDvr} from '../extension/lib/hls-dvr-discovery.js';

const Playlist=(Count,Seconds=2,Tags='')=>'#EXTM3U\n#EXT-X-TARGETDURATION:'+Seconds+'\n'+Tags+
	Array.from({length:Count},(_,I)=>'#EXTINF:'+Seconds+',\n'+I+'.ts\n').join('');

Test('DVR detection uses EVENT or a substantial retained live window without guessing from a URL',()=>
{
	Assert.equal(typeof Hls.ReadHlsDvrState,'function');
	Assert.equal(Hls.ReadHlsDvrState(Playlist(3)),false);
	Assert.equal(Hls.ReadHlsDvrState(Playlist(2,2,'#EXT-X-PLAYLIST-TYPE:EVENT\n')),true);
	Assert.equal(Hls.ReadHlsDvrState(Playlist(60)),true);
	Assert.equal(Hls.ReadHlsDvrState(Playlist(59)),false);
	Assert.equal(Hls.ReadHlsDvrState(Playlist(9,30)),false,'a long target-duration playback buffer is not a DVR signal');
	Assert.equal(Hls.ReadHlsDvrState(Playlist(60)+'#EXT-X-ENDLIST'),false);
	Assert.equal(Hls.ReadHlsDvrState(Playlist(60,2,'#EXT-X-PLAYLIST-TYPE:VOD\n')),false);
	Assert.equal(Hls.ReadHlsDvrState('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\ndvr.m3u8'),undefined);
});

Test('DVR is a display capability while the transport remains HLS',()=>
{
	Assert.equal(GetMediaFormatLabel('M3U8',{dvr:true}),'DVR');
	Assert.equal(GetMediaFormatLabel('M3U8',{dvr:false}),'HLS');
	Assert.equal(GetMediaFormatLabel('MPD',{dvr:true}),'DASH');
	Assert.equal(Hls.ParseMediaPlaylist(Playlist(60),'https://cdn.test/live.m3u8').dvr,true);
	Assert.equal(Hls.ParseMediaPlaylist(Playlist(3),'https://cdn.test/DVR.m3u8').dvr,undefined);
});

Test('observed DVR metadata reaches its master and public scan, survives headers, and clears when ended',async T=>
{
	const Data={},Page='https://page.test/live',Doc='dvr-doc',Master='https://cdn.test/master.m3u8',Variant='https://cdn.test/media.m3u8';
	globalThis.chrome={permissions:{contains:async()=>true},storage:{session:{get:async K=>({[K]:Data[K]}),set:async V=>Object.assign(Data,V)}},
		scripting:{executeScript:async({func})=>[{documentId:Doc,result:func.name==='CollectVideos'?
			{page:Page,observerReady:true,sources:[],playlists:[],timeOrigin:1}:{page:Page,active:true,pageTitle:'DVR test'}}]}};
	T.after(()=>delete globalThis.chrome);
	const R={tabId:945,frameId:0,documentId:Doc,initiator:'https://page.test',method:'GET',statusCode:200};
	const Sender={tab:{id:945},frameId:0,documentId:Doc,origin:'https://page.test'};
	await ObserveResponse({...R,url:Master});await ObserveResponse({...R,url:Variant});
	await ObserveManifest(Sender,{url:Master,text:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\n'+Variant,page:Page});
	await ObserveManifest(Sender,{url:Variant,text:Playlist(60),page:Page});
	await ObserveResponse({...R,url:Variant});
	Assert.equal((await NetworkCandidates(945,Doc)).find(I=>I.url===Variant).dvr,true);
	Assert.equal((await FindMedia(945)).items.find(I=>I.url===Master).dvr,true);
	const S=await Scan(945,'popup');Assert.equal(S.candidates[0].dvr,true);Assert.equal(S.candidates[0].format,'M3U8');
	await ObserveManifest(Sender,{url:Variant,text:Playlist(60)+'#EXT-X-ENDLIST',page:Page});
	const Ended=(await FindMedia(945)).items.find(I=>I.url===Master);Assert.equal(Ended.dvr,false);Assert.equal(Ended.live,false);
});

Test('a paused sole Blob player can classify its observed master through one declared media playlist',async T=>
{
	const Page='https://paused.test/watch',Doc='paused-dvr',Master='https://cdn.test/master.m3u8',Variant='https://cdn.test/paused.m3u8';
	const Data={'network:946':[{url:Master,name:'master.m3u8',format:'M3U8',supported:true,documentId:Doc,initiator:'https://paused.test',page:Page,
		qualities:[{url:Variant}],variants:[Variant]}]},Calls=[];
	globalThis.location={href:Page};
	T.after(()=>{delete globalThis.chrome;delete globalThis.location;});
	globalThis.chrome={runtime:{getURL:()=>{throw Error('no provider data needed');}},permissions:{contains:async()=>true},
		storage:{session:{get:async K=>({[K]:Data[K]}),set:async V=>Object.assign(Data,V)}},
		scripting:{executeScript:async({func,args=[]})=>[{documentId:Doc,result:func.name==='CollectVideos'?
			{page:Page,observerReady:true,opaquePlayer:true,sources:['blob:https://paused.test/video'],playlists:[],timeOrigin:1}
			:func.name==='DeclaredStreamPageTask'?await func(args[0]):null}]}};
	T.mock.method(globalThis,'fetch',async U=>{
		Calls.push(U);Assert.equal(U,Variant);
		await ObserveResponse({tabId:946,frameId:0,documentId:Doc,initiator:'https://paused.test',method:'GET',statusCode:200,url:U});
		return new Response(Playlist(60));
	});
	Assert.equal((await FindMedia(946)).items[0].dvr,true);
	Assert.equal((await FindMedia(946)).items[0].dvr,true);
	Assert.deepEqual(Calls,[Variant],'successful capability metadata is reused, with no media segment requests');
});

Test('DVR supplementation never chooses between multiple masters even when only one is unclassified',async T=>
{
	const Page='https://multi.test/watch',Doc='multi-dvr',Calls=[];
	globalThis.location={href:Page};globalThis.chrome={permissions:{contains:async()=>true},storage:{session:{get:async()=>({}),set:async()=>{}}},
		scripting:{executeScript:async O=>{Calls.push(O);return [{documentId:Doc,result:null}];}}};
	T.after(()=>{delete globalThis.chrome;delete globalThis.location;});
	const Common={format:'M3U8',documentId:Doc,initiator:'https://multi.test',page:Page};
	const Observed=[{...Common,url:'https://cdn.test/master-a.m3u8',qualities:[{url:'https://cdn.test/a.m3u8'}]},
		{...Common,url:'https://cdn.test/a.m3u8',dvr:true},
		{...Common,url:'https://cdn.test/master-b.m3u8',qualities:[{url:'https://cdn.test/b.m3u8'}]}];
	Assert.equal(await DiscoverHlsDvr(947,Doc,Page,Observed),false);Assert.deepEqual(Calls,[]);
});
