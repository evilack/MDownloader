import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {ControlJob, UpdateHls} from '../extension/jobs.js';
import {CanFinishJob} from '../extension/lib/job-actions.js';
import {SummarizeJob} from '../extension/lib/browser-job-state.js';
import {WriteJob} from '../extension/lib/job-storage.js';
import {WaitForYoutubeBroadcast} from '../extension/features/youtube/live.js';
import {YoutubeQualities} from '../extension/features/youtube/qualities.js';
import {CreateYoutubeClient} from '../extension/features/youtube/client.js';
import {CreateYoutubeRunner} from '../extension/features/youtube/runner.js';

function Install(T, Job, Send = async () => ({ok:true, data:true}))
{
	const Data = {['job:' + Job.requestId]: Job};
	globalThis.chrome = {storage:{local:{get:async Key=>({[Key]:Data[Key]}),set:async Values=>Object.assign(Data, structuredClone(Values))}},
		runtime:{id:'owner',getURL:Path=>'chrome-extension://owner/'+Path,getContexts:async()=>[{}],sendMessage:Send}};
	T.after(()=>delete globalThis.chrome);
	return Data;
}
const Tick = () => new Promise(Resolve=>setImmediate(Resolve));

Test('finish is unavailable while an action or browser save already owns the job', () =>
{
	const Job = {state:'active',hls:true,snapshotAvailable:true};
	for (const Change of [{pendingAction:'finish'},{pendingAction:'cancel'},{saving:true},{downloadId:3}])
		Assert.equal(CanFinishJob({...Job,...Change}),false);
});

Test('accepted finish stays visible in storage until actual terminal output', async T =>
{
	const Id='pending-finish', Reply=Promise.withResolvers();
	const Data=Install(T,{requestId:Id,youtube:true,state:'active',snapshotAvailable:true},async()=>Reply.promise);
	const Control=ControlJob(Id,'finish'); await Tick();
	Assert.equal(Data['job:'+Id].pendingAction,'finish');
	Reply.resolve({ok:true,data:true}); await Control;
	Assert.equal(Data['job:'+Id].pendingAction,'finish');
	await UpdateHls({requestId:Id,action:'failure',canceled:true});
	Assert.equal(Data['job:'+Id].state,'canceled');
	Assert.equal(Data['job:'+Id].pendingAction,undefined);
});

Test('rejected action clears its persisted transition without losing current progress', async T =>
{
	const Id='pending-error', Reply=Promise.withResolvers();
	const Data=Install(T,{requestId:Id,youtube:true,state:'active',bytesReceived:20},async()=>Reply.promise);
	const Control=ControlJob(Id,'cancel'); await Tick();
	Assert.equal(Data['job:'+Id].pendingAction,'cancel');
	await UpdateHls({requestId:Id,action:'progress',received:35});
	Reply.reject(new Error('receiver unavailable'));
	await Assert.rejects(Control);
	Assert.equal(Data['job:'+Id].pendingAction,undefined);
	Assert.equal(Data['job:'+Id].bytesReceived,35);
});

Test('browser cancel remains pending until the real download reports a terminal state',async T=>
{
	const Id='native-cancel', Reply=Promise.withResolvers();
	const Data=Install(T,{requestId:Id,state:'started',downloadId:7});
	const Item={id:7,byExtensionId:'owner',state:'in_progress',filename:'video.mp4'};
	chrome.downloads={search:async()=>[Item],cancel:async()=>Reply.promise};
	const Control=ControlJob(Id,'cancel');await Tick();
	Assert.equal(SummarizeJob(Data['job:'+Id],Item).pendingAction,'cancel');
	Reply.resolve();await Control;
	Assert.equal(SummarizeJob(Data['job:'+Id],Item).pendingAction,'cancel');
	Item.state='interrupted';Item.error='USER_CANCELED';
	Assert.equal(SummarizeJob(Data['job:'+Id],Item).pendingAction,undefined);
	Assert.equal(SummarizeJob(Data['job:'+Id],Item).state,'canceled');
});

Test('scheduled polls retain waiting and suppress live until a confirmed start', async T =>
{
	const Id='scheduled', Time='2026-11-10T09:00:00.000Z';
	const Data=Install(T,{requestId:Id,youtube:true,state:'active',waiting:true,live:false,scheduledStartTime:Time});
	await UpdateHls({requestId:Id,action:'progress',received:0});
	Assert.equal(Data['job:'+Id].waiting,true);
	await UpdateHls({requestId:Id,action:'progress',received:0,waiting:true,live:true});
	Assert.equal(Data['job:'+Id].live,false);
	await UpdateHls({requestId:Id,action:'connecting',live:true});
	Assert.equal(Data['job:'+Id].connecting,true);
	Assert.equal(Data['job:'+Id].scheduledStartTime,Time);
	await UpdateHls({requestId:Id,action:'progress',received:800,live:true});
	Assert.equal(Data['job:'+Id].connecting,false);
});

Test('native terminal summaries remove pending controls but retain recording origin and partial bytes',()=>
{
	const Job={created:1,state:'started',recording:true,live:true,recordingInterrupted:true,bytesReceived:120,pendingAction:'finish',connecting:true};
	const Summary=SummarizeJob(Job,{filename:'C:\\partial.webm',state:'complete',bytesReceived:125,totalBytes:125,exists:true});
	Assert.equal(Summary.state,'interrupted'); Assert.equal(Summary.live,true); Assert.equal(Summary.recording,true);
	Assert.equal(Summary.bytesReceived,120); Assert.equal(Summary.pendingAction,undefined); Assert.equal(Summary.connecting,false);
});

Test('stream end signals do not erase the confirmed live origin',async T=>
{
	const Id='live-ended', Data=Install(T,{requestId:Id,hls:true,state:'active',live:true});
	await UpdateHls({requestId:Id,action:'progress',received:500,live:false,muxing:true});
	Assert.equal(Data['job:'+Id].live,true);
});

Test('terminal storage clears transient state while preserving the source type',async T=>
{
	const Data=Install(T,{requestId:'terminal'});
	await WriteJob('job:terminal',{state:'complete',live:true,recording:true,pendingAction:'finish',connecting:true,waiting:true});
	Assert.equal(Data['job:terminal'].pendingAction,undefined); Assert.equal(Data['job:terminal'].connecting,false);
	Assert.equal(Data['job:terminal'].waiting,false); Assert.equal(Data['job:terminal'].live,true);
});

Test('recording snapshot retains its origin through finite child processing',async T=>
{
	const Id='e9d72f54-eecd-407a-b297-be9b6d0f5ea7'; let Child;
	const Parent={requestId:Id,filename:'live.mp4',state:'active',recording:true,live:true,snapshotAvailable:true,finished:5};
	const Data=Install(T,Parent,async Message=>{Child=Message.job;return {ok:true};});
	await ControlJob(Id,'snapshot');
	Assert.equal(Child.recording,true); Assert.equal(Child.live,true); Assert.equal(Child.snapshot,true);
	await UpdateHls({requestId:Child.requestId,action:'partialStarted'});
	await UpdateHls({requestId:Child.requestId,action:'progress',received:200,muxing:true});
	Assert.equal(Data['job:'+Child.requestId].live,true); Assert.deepEqual(Data['job:'+Id],Parent);
	Assert.equal(SummarizeJob(Data['job:'+Child.requestId],undefined,{requestIds:[Child.requestId]}).state,'active');
	Assert.equal(SummarizeJob({...Data['job:'+Child.requestId],partial:true,created:1},{filename:'partial.mp4',state:'complete'}).state,'complete');
});

Test('upcoming quality and polling retain only source supplied scheduled time',async()=>
{
	const Time='2026-11-10T09:00:00.000Z', Reports=[];
	const [Choice]=YoutubeQualities({mode:'upcoming',videoId:'pinned',scheduledStartTime:Time});
	Assert.equal(Choice.quality.scheduledStartTime,Time);
	const Stop=new AbortController();
	await Assert.rejects(WaitForYoutubeBroadcast({DiscoverYoutube:async()=>({videoId:'pinned',mode:'upcoming',scheduledStartTime:'2026-11-10T10:00:00.000Z'})},Choice.quality,
		{signal:Stop.signal,report:async Fields=>Reports.push(Fields),wait:async()=>Stop.abort()}));
	Assert.equal(Reports[0].scheduledStartTime,Time);
	Assert.equal(Reports.at(-1).scheduledStartTime,'2026-11-10T10:00:00.000Z');
	Assert.equal(Reports.at(-1).live,false);
});

Test('discovery exposes the actual upstream schedule and omits absent timestamps',async()=>
{
	let Timestamp='2026-11-10T09:00:00+00:00';
	const Client=CreateYoutubeClient({hasPermission:async()=>true,createInnertube:async()=>({getBasicInfo:async()=>({
		basic_info:{id:'JXR579POAu4',is_upcoming:true,start_timestamp:Timestamp},playability_status:{status:'LIVE_STREAM_OFFLINE'}})})});
	Assert.equal((await Client.DiscoverYoutube({pageUrl:'https://youtu.be/JXR579POAu4'})).scheduledStartTime,'2026-11-10T09:00:00.000Z');
	Timestamp=undefined;
	Assert.equal((await Client.DiscoverYoutube({pageUrl:'https://youtu.be/JXR579POAu4'})).scheduledStartTime,undefined);
});

Test('broadcast resolving start is reported as connecting before media data arrives',async()=>
{
	const Reports=[], Hold=Promise.withResolvers(), Seen=Promise.withResolvers();
	const Runner=CreateYoutubeRunner({client:{ResolveYoutubeSelection:async()=>({config:{live:true}})},
		workspaces:{create:async()=>{Seen.resolve();return Hold.promise;},release:async()=>{}}});
	await Runner({type:'youtubeRun',job:{requestId:'77777777-7777-4777-8777-777777777777',waiting:true},quality:{}},
		{report:async(_Id,Action,Fields)=>Reports.push({action:Action,...Fields})});
	await Seen.promise;
	Assert.equal(Reports[0].action,'connecting');Assert.equal(Reports[0].live,true);
	Hold.reject(new Error('test stops before disk allocation'));await Tick();
});
