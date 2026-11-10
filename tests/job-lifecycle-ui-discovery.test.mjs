import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {FindMedia, CandidateSubtitleStatuses} from '../extension/detection.js';
const Id='JXR579POAu4', Page='https://www.youtube.com/watch?v='+Id;

function PageEnvironment(T)
{
	const Session={'scan:8':{scanId:'scan',page:Page,documentId:'doc',candidates:[{id:0,url:Page,format:'YOUTUBE',supported:true,page:Page}]}};
	globalThis.location={href:Page};
	globalThis.ytInitialPlayerResponse={videoDetails:{videoId:Id,isUpcoming:true},microformat:{playerMicroformatRenderer:{liveBroadcastDetails:{startTimestamp:'2026-11-10T09:00:00Z',isLiveNow:false}}}};
	globalThis.chrome={storage:{local:{get:async()=>({})},session:{get:async Key=>({[Key]:Session[Key]})}},
		permissions:{contains:async()=>true},scripting:{executeScript:async({func,args})=>{
			if(func.name==='CollectVideos')return [{documentId:'doc',result:{page:Page,pageTitle:'Broadcast - YouTube',sources:[],playlists:[]}}];
			if(func.name==='ReadYoutubeBroadcast')return [{documentId:'doc',result:func(...args)}];
			if(func.name==='ReadPageSubtitles')return [{documentId:'doc',result:[]}];
			return [{documentId:'doc',result:{page:Page,pageTitle:'Broadcast',active:true}}];
		}}};
	T.after(()=>{delete globalThis.chrome;delete globalThis.location;delete globalThis.ytInitialPlayerResponse;});
}

Test('YouTube initial candidate reads actual upcoming metadata from the pinned page without network',async T=>
{
	PageEnvironment(T);
	const Result=await FindMedia(8);
	Assert.equal(Result.items[0].upcoming,true);Assert.equal(Result.items[0].live,false);
	Assert.equal(Result.items[0].scheduledStartTime,'2026-11-10T09:00:00.000Z');
});

Test('candidate status refresh exposes current page schedule and suppresses stale SPA response',async T=>
{
	PageEnvironment(T);
	const Input={tabId:8,scanId:'scan',candidateIds:[0]};
	const [Current]=await CandidateSubtitleStatuses(Input);
	Assert.equal(Current.upcoming,true);Assert.equal(Current.scheduledStartTime,'2026-11-10T09:00:00.000Z');
	ytInitialPlayerResponse.videoDetails.videoId='different';
	const [Stale]=await CandidateSubtitleStatuses(Input);
	Assert.equal(Stale.upcoming,undefined);Assert.equal(Stale.scheduledStartTime,undefined);Assert.equal(Stale.live,undefined);
});

Test('matching finite response has no fabricated scheduled date',async T=>
{
	PageEnvironment(T);
	ytInitialPlayerResponse={videoDetails:{videoId:Id,isUpcoming:false,isLive:false}};
	const [Current]=await CandidateSubtitleStatuses({tabId:8,scanId:'scan',candidateIds:[0]});
	Assert.equal(Current.upcoming,false);Assert.equal(Current.scheduledStartTime,undefined);Assert.equal(Current.live,false);
});

Test('independent subtitle inspection failure does not hide verified broadcast metadata',async T=>
{
	PageEnvironment(T);
	const Execute=chrome.scripting.executeScript;
	chrome.scripting.executeScript=async Input=>Input.func.name==='ReadPageSubtitles'
		? [{documentId:'doc',result:{error:'subtitle_invalid'}}] : Execute(Input);
	const [Current]=await CandidateSubtitleStatuses({tabId:8,scanId:'scan',candidateIds:[0]});
	Assert.equal(Current.status.phase,'failed');Assert.equal(Current.upcoming,true);
	Assert.equal(Current.scheduledStartTime,'2026-11-10T09:00:00.000Z');
});
