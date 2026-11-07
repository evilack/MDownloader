import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { EnqueuePlayback, ListJobs } from '../extension/jobs.js';
Test('reads only registered downloads and keeps legacy records when the browser item is gone', async T =>
{
	const Data = { usePageTitle: true };
	const Downloads = new Map();
	const Queries = [];
	globalThis.chrome = {
		permissions: {contains: async () => true},
		runtime: { id: 'mdownloader' },
		storage: { local: { get: async () => ({ ...Data }) } },
		downloads: { search: async Query =>
			{
				Queries.push(Query);
				return Query.id === undefined ? [...Downloads.values()] : [Downloads.get(Query.id)].filter(Boolean);
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	Assert.deepEqual(await ListJobs(), []);
	Assert.deepEqual(Queries, []);
	Data['job:legacy'] = { filename: 'original.mp4', requestId: 'legacy', created: 1, downloadId: 42, state: 'started' };
	Data['job:removed'] = { filename: 'missing.mp4', requestId: 'removed', created: 2, downloadId: 99, state: 'started' };
	Data['job:failed'] = { filename: 'stream.mp4', requestId: 'failed', created: 3, hls: true, state: 'failed' };
	Downloads.set(42, {
		id: 42, byExtensionId: 'mdownloader', filename: 'C:/Downloads/clip.mp4',
		state: 'in_progress', paused: true, canResume: true, exists: true,
		bytesReceived: 2048, totalBytes: 4096, url: 'https://example.test/clip.mp4',
	});
	Downloads.set(99, { id: 99, byExtensionId: 'other-extension' });
	Downloads.set(100, { id: 100, byExtensionId: 'another-extension' });
	const Jobs = await ListJobs();
	Assert.deepEqual(Jobs.map(Job => [Job.requestId, Job.filename, Job.state]), [
		['failed', 'stream.mp4', 'failed'], ['removed', 'missing.mp4', 'unknown'], ['legacy', 'clip.mp4', 'paused'],
	]);
	Assert.equal(Jobs[2].canResume, true);
	Assert.equal(Jobs[2].bytesReceived, 2048);
	Assert.equal(Jobs[2].snapshotAvailable, true);
	Assert.deepEqual(Queries.sort((A, B) => A.id - B.id), [{ id: 42 }, { id: 99 }]);
});
Test('reads exact job records for manager deltas and ignores unrelated local values', async T =>
{
	const Data = {
		language: 'ko',
		'job:older': { requestId: 'older', created: 1, state: 'started', downloadId: 42 },
		'job:target': { requestId: 'target', created: 2, hls: true, state: 'failed' },
	};
	const Reads = [];
	globalThis.chrome = {
		runtime: { id: 'mdownloader' },
		storage: { local: {
				getKeys: async () => Object.keys(Data),
				get: async Keys =>
				{
					Reads.push(Keys);
					return Object.fromEntries((Keys ?? Object.keys(Data)).filter(Key => Key in Data).map(Key => [Key, Data[Key]]));
				},
			} },
		downloads: { search: async () => [] },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	Assert.deepEqual(await ListJobs(['target', 'missing', 'target']), [Data['job:target']]);
	Assert.deepEqual(await ListJobs([]), []);
	await Assert.rejects(ListJobs('target'), { key: 'job_invalid_request' });
	await Assert.rejects(ListJobs(['target', null]), { key: 'job_invalid_request' });
	Assert.deepEqual((await ListJobs()).map(Job => Job.requestId), ['target', 'older']);
	Assert.deepEqual(Reads, [['job:target', 'job:missing'], ['job:older', 'job:target']]);
});
Test('resolves only downloads belonging to the visible popup media', async T =>
{
	const Data = {
		'job:match': { mediaKey: 'match', filename: 'same.mp4', state: 'started', downloadId: 42 },
		'job:other': { mediaKey: 'other', filename: 'same.mp4', state: 'started', downloadId: 43 },
		'job:legacy': { filename: 'same.mp4', state: 'started', downloadId: 44 },
	};
	const Queries = [];
	globalThis.chrome = {
		runtime: { id: 'mdownloader' },
		storage: { local: { get: async () => ({ ...Data }) } },
		downloads: { search: async ({ id: Id }) =>
			{
				Queries.push(Id);
				return [{ id: Id, byExtensionId: 'mdownloader', state: 'complete', filename: 'C:/Downloads/same.mp4' }];
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	Assert.deepEqual(await ListJobs(undefined, []), []);
	const Matches = await ListJobs(undefined, ['match']);
	Assert.deepEqual(Matches.map(Job => [Job.requestId, Job.state]), [['match', 'complete']]);
	Assert.deepEqual(Queries, [42]);
});
Test('keeps a stream in startup when its runner reply races registration', async T =>
{
	const RequestId = '63d85d5a-45a2-4ec5-bd4b-509e8197797c';
	const Data = { 'job:orphan': { requestId: 'orphan', state: 'active', hls: true } };
	const Launched = Promise.withResolvers();
	const Checked = Promise.withResolvers();
	const Launch = Promise.withResolvers();
	const Active = Promise.withResolvers();
	globalThis.chrome = {
		storage: { local: {
				get: async Keys => Object.fromEntries((Array.isArray(Keys) ? Keys : [Keys]).map(Key => [Key, Data[Key]])),
				set: async Values => Object.assign(Data, Values),
			} },
		runtime: {
			getURL: Path => 'chrome-extension://mdownloader/' + Path,
			getContexts: async () => [{}],
			sendMessage({ type: Type })
			{
				if (Type === 'hlsRun')
				{
					Launched.resolve();
					return Launch.promise;
				}
				Assert.equal(Type, 'hlsActive');
				Checked.resolve();
				return Active.promise;
			},
		},
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Registering = EnqueuePlayback({ requestId: RequestId, playlist: '#EXTM3U\n', count: 1, bytes: 188 });
	await Launched.promise;
	const Listing = ListJobs([RequestId, 'orphan']);
	await Checked.promise;
	Launch.resolve({ ok: true });
	await Registering;
	Active.resolve({ requestId: undefined });
	Assert.deepEqual((await Listing).map(Job => [Job.requestId, Job.state]), [[RequestId, 'active'], ['orphan', 'failed']]);
});
