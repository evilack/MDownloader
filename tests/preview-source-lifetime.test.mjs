import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setImmediate as Settle} from 'node:timers/promises';
import {DeleteJobPreview, PreviewSourceKey, SaveJobPreviewSource} from '../extension/lib/job-preview-cache.js';
Test('deletion waits for an existing source write and prevents any later source resurrection', async T =>
{
	const Session = {};
	let bRegistered = true, Release;
	globalThis.chrome = {storage: {session: {
				set: async Values =>
				{
					await new Promise(Resolve =>
					{
						Release = Resolve;
					});
					Object.assign(Session, Values);
				},
				remove: async Key =>
				{
					delete Session[Key];
				},
			}}};
	globalThis.caches = {has: async () => false};
	T.after(() =>
	{
		delete globalThis.chrome;
		delete globalThis.caches;
	});
	const Write = SaveJobPreviewSource('sample', {url: 'https://cdn.test/?token=private'}, () => bRegistered);
	await Settle();
	bRegistered = false;
	const Delete = DeleteJobPreview('sample');
	Release();
	await Promise.all([Write, Delete]);
	Assert.equal(Session[PreviewSourceKey('sample')], undefined);
	await SaveJobPreviewSource('sample', {url: 'https://cdn.test/late'}, () => bRegistered);
	Assert.equal(Session[PreviewSourceKey('sample')], undefined);
});
