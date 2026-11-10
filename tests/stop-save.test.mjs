import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {CanFinishJob} from '../extension/lib/job-actions.js';
import {ControlJob, UpdateHls} from '../extension/jobs.js';
Test('stop/save becomes available for finite streams only after a committed prefix is ready', () =>
{
	const Job = {state: 'active', hls: true, live: false, snapshotAvailable: true};
	Assert.equal(CanFinishJob(Job), true);
	for (const Change of [{snapshotAvailable: false}, {muxing: true}, {snapshot: true}, {state: 'complete'}, {state: 'paused'}, {hls: false}])
	{
		Assert.equal(CanFinishJob({...Job, ...Change}), false);
	}
	Assert.equal(CanFinishJob({state: 'active', live: true, recording: true, finished: 1}), true);
});
Test('YouTube finish uses only its provider and partial receipt keeps the YouTube type', async T =>
{
	const Id = 'youtube-stop-save', Job = {requestId: Id, youtube: true, state: 'active', snapshotAvailable: true, filename: 'movie.mp4'};
	Assert.equal(CanFinishJob(Job), true);
	for (const Change of [{snapshotAvailable:false},{snapshot:true},{muxing:true},{state:'complete'}]) Assert.equal(CanFinishJob({...Job,...Change}), false);
	const Data = {['job:' + Id]: Job}, Sent = [];
	globalThis.chrome = {storage:{local:{get:async Key=>({[Key]:Data[Key]}),set:async Values=>Object.assign(Data,Values)}},
		runtime:{getURL:Path=>'chrome-extension://test/'+Path,getContexts:async()=>[{}],sendMessage:async Message=>{Sent.push(Message);return {ok:true,data:true};}}};
	T.after(()=>delete globalThis.chrome);
	await ControlJob(Id,'finish'); Assert.deepEqual(Sent,[{type:'youtubeFinish',requestId:Id}]);
	await UpdateHls({requestId:Id,action:'youtubePartial',receipt:{duration:20,start:0,partial:true}});
	Assert.equal(Data['job:'+Id].youtube,true); Assert.equal(Data['job:'+Id].hls,undefined); Assert.equal(Data['job:'+Id].partial,true);
	Assert.match(Data['job:'+Id].filename,/_partial_.+\.mp4$/);
});
Test('finite HLS stop/save controls its existing transfer and marks its output as partial', async T =>
{
	const Id = 'finite-stop-save';
	const Job = {requestId: Id, state: 'active', hls: true, live: false, snapshotAvailable: true, filename: 'movie.mp4'};
	const Data = {['job:' + Id]: Job};
	const Sent = [];
	globalThis.chrome = {storage: {local: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}}, runtime: {sendMessage: async Message =>
			{
				Sent.push(Message);
				return {ok: true};
			}}};
	T.after(() => delete globalThis.chrome);
	await ControlJob(Id, 'finish');
	Assert.deepEqual(Sent, [{type: 'hlsFinish', requestId: Id}]);
	const Filename = await UpdateHls({requestId: Id, action: 'streamPartial'});
	Assert.match(Filename, /_partial_.+\.mp4$/);
	Assert.equal(Data['job:' + Id].partial, true);
	Assert.equal(Data['job:' + Id].state, 'active');
	Assert.equal(Object.keys(Data).length, 1);
	Assert.equal(await UpdateHls({requestId: Id, action: 'streamPartial'}), Filename);
});

Test('stop/save leaves the stopping phase when muxing starts and preserves a later cancel request', async T =>
{
	const Id = 'stop-save-phases', Key = 'job:' + Id;
	const Data = {[Key]: {requestId: Id, hls: true, state: 'active', pendingAction: 'finish'}};
	globalThis.chrome = {storage: {local: {get: async Name => ({[Name]: Data[Name]}), set: async Values => Object.assign(Data, Values)}}};
	T.after(() => delete globalThis.chrome);
	await UpdateHls({requestId: Id, action: 'progress', received: 376, finished: 1, count: 2});
	Assert.equal(Data[Key].pendingAction, 'finish');
	await UpdateHls({requestId: Id, action: 'progress', received: 376, finished: 1, count: 1, muxing: true});
	Assert.equal(Data[Key].pendingAction, undefined, 'show mux/save progress instead of hiding it behind Stopping');
	Data[Key].pendingAction = 'cancel';
	await UpdateHls({requestId: Id, action: 'progress', received: 376, finished: 1, count: 1, muxing: true});
	Assert.equal(Data[Key].pendingAction, 'cancel');
});
