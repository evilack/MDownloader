import { test as Test } from 'node:test';
import Assert from 'node:assert/strict';
import * as Jobs from '../extension/jobs.js';
Test('removes a job from the panel and deletes its file only on explicit request', async T =>
{
	const Records = { 'job:sample': { downloadId: 42 } };
	const Item = { id: 42, state: 'complete', exists: true, byExtensionId: 'mdownloader' };
	let bFileExists = true;
	let bFail = false;
	globalThis.chrome = {
		runtime: { id: 'mdownloader' },
		storage: { local: {
				get: async Key => ({ [Key]: Records[Key] }),
				remove: async Key =>
				{
					delete Records[Key];
				},
			} },
		downloads: {
			search: async ({ id: Id }) => Id === Item.id ? [Item] : [],
			removeFile: async Id =>
			{
				Assert.equal(Id, Item.id);
				Assert.ok(Records['job:sample']);
				if (bFail)
				{
					throw new Error('File locked');
				}
				bFileExists = false;
			},
		},
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await Jobs.RemoveJob('sample', false);
	Assert.equal(Records['job:sample'], undefined);
	Assert.equal(bFileExists, true);
	Records['job:sample'] = { downloadId: 42 };
	Item.state = 'in_progress';
	await Assert.rejects(Jobs.RemoveJob('sample', true), { key: 'job_delete_after_finish' });
	Item.state = 'complete';
	Item.byExtensionId = 'other-extension';
	await Assert.rejects(Jobs.RemoveJob('sample', true), { key: 'job_file_unknown' });
	Item.byExtensionId = 'mdownloader';
	bFail = true;
	await Assert.rejects(Jobs.RemoveJob('sample', true), { key: 'job_delete_failed' });
	Assert.ok(Records['job:sample']);
	Assert.equal(bFileExists, true);
	bFail = false;
	await Jobs.RemoveJob('sample', true);
	Assert.equal(Records['job:sample'], undefined);
	Assert.equal(bFileExists, false);
});
Test('clears only the selected section and keeps saved files and resumed jobs', async T =>
{
	const Records = {
		'job:failed': { state: 'failed' },
		'job:canceled': { state: 'canceled', hls: true },
		'job:resumed': { state: 'started', downloadId: 1 },
		'job:complete': { state: 'started', downloadId: 2 },
		'job:other': { state: 'failed' },
	};
	const Downloads = [
		{ id: 1, state: 'in_progress', filename: 'resumed.mp4', byExtensionId: 'mdownloader' },
		{ id: 2, state: 'complete', filename: 'saved.mp4', byExtensionId: 'mdownloader' },
	];
	globalThis.chrome = {
		runtime: { id: 'mdownloader', sendMessage: async () => ({}) },
		storage: { local: {
				get: async Key => ({ [Key]: Records[Key] }),
				remove: async Key =>
				{
					delete Records[Key];
				},
			} },
		downloads: {
			search: async ({ id: Id }) => Downloads.filter(Item => Item.id === Id),
			removeFile: () => Assert.fail('Bulk removal must preserve the downloaded file'),
		},
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await Jobs.RemoveJobs(['failed', 'canceled', 'missing', 'resumed', 'complete'], 'attention');
	Assert.deepEqual(Object.keys(Records), ['job:resumed', 'job:complete', 'job:other']);
	await Assert.rejects(Jobs.RemoveJobs(['resumed'], 'active'), { key: 'job_invalid_request' });
	await Jobs.RemoveJobs(['resumed', 'complete', 'other'], 'complete');
	Assert.deepEqual(Object.keys(Records), ['job:resumed', 'job:other']);
});
