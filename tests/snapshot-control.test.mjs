import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {ControlJob, UpdateHls} from '../extension/jobs.js';
Test('native partial save freezes the current byte range without changing the parent job', async T =>
{
	const Id = 'c8e01924-1ad2-4b73-92db-b290d7e8d19c';
	const Parent = {requestId: Id, filename: 'page_movie.mp4', state: 'started', downloadId: 7, downloadFolder: 'media'};
	const Data = {['job:' + Id]: Parent};
	const Sent = [];
	const Pending = Promise.withResolvers();
	globalThis.chrome = {permissions: {contains: async() => true}, downloads: {search: async() => [{id: 7, byExtensionId: 'owner', filename: 'page_movie.mp4', state: 'in_progress', bytesReceived: 120000, totalBytes: 232992, url: 'https://file.test/movie.mp4', mime: 'video/mp4'}]},
		storage: {local: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}},
		runtime: {id: 'owner', getURL: Value => 'chrome-extension://owner/' + Value, getContexts: async() => [{}], sendMessage: async Message =>
			{
				Sent.push(Message);
				Assert.equal(Message.type, 'hlsSnapshot');
				Assert.equal(Data['job:' + Message.job.requestId].state, 'starting');
				await UpdateHls({requestId: Message.job.requestId, action: 'partialStarted'});
				await UpdateHls({requestId: Message.job.requestId, action: 'progress', received: 120000, finished: 120000, count: 120000});
				await Pending.promise;
				return{ok: true};
			}}};
	T.after(() => delete globalThis.chrome);
	const Saving = ControlJob(Id, 'snapshot');
	await new Promise(Resolve => setImmediate(Resolve));
	await Assert.rejects(ControlJob(Id, 'snapshot'), {key: 'job_snapshot_busy'});
	Assert.equal(Object.keys(Data).filter(Key => Key.startsWith('job:')).length, 2);
	Pending.resolve();
	await Saving;
	Assert.deepEqual(Data['job:' + Id], Parent);
	Assert.equal(Sent[0].source.bytes, 120000);
	Assert.equal(Sent[0].source.totalBytes, 232992);
	Assert.match(Sent[0].job.filename, /page_movie_partial_/);
	Assert.equal(Sent[0].job.snapshotParent, Id);
	Assert.notEqual(Sent[0].job.requestId, Id);
});
