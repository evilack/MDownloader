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
