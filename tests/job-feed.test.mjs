import Assert from 'node:assert/strict';
import { setImmediate as Settle } from 'node:timers/promises';
import { test as Test } from 'node:test';
import { ObserveJobs } from '../extension/lib/job-feed.js';
function ExtensionEvent()
{
	let Listener;
	return { addListener(Callback)
		{
			Listener = Callback;
		}, emit: (...Args) => Listener(...Args) };
}

function Manager(T, Initial, WaitForInitial, MediaKeys)
{
	T.mock.timers.enable({ apis: ['setTimeout'] });
	const Jobs = new Map(Initial.map(Job => [Job.requestId, Job]));
	const Requests = [];
	const Updates = [];
	const OnChanged = ExtensionEvent();
	const OnErased = ExtensionEvent();
	const StorageChange = ExtensionEvent();
	globalThis.document = new EventTarget();
	document.hidden = false;
	globalThis.chrome = {
		downloads: { onChanged: OnChanged, onErased: OnErased },
		storage: { onChanged: StorageChange },
		runtime: { sendMessage: async ({ requestIds: RequestIds, mediaKeys: Scope }) =>
			{
				Requests.push(RequestIds);
				const Snapshot = RequestIds ? RequestIds.map(Id => Jobs.get(Id)).filter(Boolean) : [...Jobs.values()];
				if (Requests.length === 1)
				{
					await WaitForInitial;
				}
				return { ok: true, data: Scope ? Snapshot.filter(Job => Scope.includes(Job.mediaKey)) : Snapshot };
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
		delete globalThis.document;
	});
	ObserveJobs({ mediaKeys: MediaKeys, onUpdate: Changes => Updates.push(Changes), onError: Error => Assert.fail(Error) });
	return {
		jobs: Jobs, requests: Requests, updates: Updates, onChanged: OnChanged, onErased: OnErased, storageChange: StorageChange,
		show(Visible)
		{
			document.hidden = !Visible;
			document.dispatchEvent(new Event('visibilitychange'));
		},
	};
}

Test('polls only the visible active jobs and refreshes exact changed jobs between ticks', async T =>
{
	const View = Manager(T, [
		{ requestId: 'done', downloadId: 1, state: 'complete' },
		{ requestId: 'paused', downloadId: 2, state: 'paused' },
		{ requestId: 'active', downloadId: 3, state: 'active', bytesReceived: 1024 },
	]);
	await Settle();
	Assert.deepEqual(View.requests, [undefined]);
	View.onChanged.emit({ id: 50 });
	View.onErased.emit(51);
	View.storageChange.emit({ downloadFolder: { newValue: 'Videos' } }, 'local');
	await Settle();
	Assert.deepEqual(View.requests, [undefined]);
	View.jobs.set('active', { ...View.jobs.get('active'), bytesReceived: 2048 });
	T.mock.timers.tick(1000);
	await Settle();
	Assert.deepEqual(View.requests, [undefined, ['active']]);
	Assert.equal(View.updates.at(-1).get('active').bytesReceived, 2048);
	View.jobs.set('active', { ...View.jobs.get('active'), state: 'paused' });
	View.onChanged.emit({ id: 3 });
	View.jobs.delete('done');
	View.storageChange.emit({ 'job:done': { oldValue: { requestId: 'done' } } }, 'local');
	await Settle();
	Assert.deepEqual(View.requests.at(-1), ['active', 'done']);
	Assert.equal(View.updates.at(-1).get('done'), null);
	T.mock.timers.tick(3000);
	await Settle();
	Assert.equal(View.requests.length, 3);
	View.show(false);
	View.jobs.set('active', { ...View.jobs.get('active'), state: 'active' });
	View.onChanged.emit({ id: 3 });
	T.mock.timers.tick(3000);
	await Settle();
	Assert.equal(View.requests.length, 3);
	View.show(true);
	await Settle();
	Assert.equal(View.requests.length, 4);
	Assert.equal(View.requests.at(-1), undefined);
	Assert.equal(View.updates.at(-1).get('active').state, 'active');
});
Test('replays a native event for a job discovered during the initial read', async T =>
{
	const Initial = Promise.withResolvers();
	const View = Manager(T, [{ requestId: 'discovered', downloadId: 7, state: 'paused' }], Initial.promise);
	await Settle();
	View.jobs.set('discovered', { ...View.jobs.get('discovered'), state: 'active' });
	View.onChanged.emit({ id: 7 });
	View.onChanged.emit({ id: 100 });
	Initial.resolve();
	await Settle();
	Assert.deepEqual(View.requests, [undefined, ['discovered']]);
	Assert.equal(View.updates.at(-1).get('discovered').state, 'active');
});
Test('keeps a popup feed scoped to its candidate jobs and observes completion and removal', async T =>
{
	const View = Manager(T, [
		{ requestId: 'target', downloadId: 7, mediaKey: 'visible', state: 'active' },
		{ requestId: 'other', downloadId: 8, mediaKey: 'other', state: 'active' },
	], undefined, new Set(['visible']));
	await Settle();
	Assert.deepEqual([...View.updates.at(-1).keys()], ['target']);
	View.storageChange.emit({ 'job:other': { newValue: View.jobs.get('other') } }, 'local');
	View.onChanged.emit({ id: 8 });
	View.jobs.get('target').bytesReceived = 2048;
	T.mock.timers.tick(1000);
	await Settle();
	Assert.deepEqual(View.requests, [undefined, ['target']]);
	Assert.equal(View.updates.at(-1).get('target').bytesReceived, 2048);
	View.jobs.get('target').state = 'complete';
	View.onChanged.emit({ id: 7 });
	await Settle();
	Assert.equal(View.updates.at(-1).get('target').state, 'complete');
	const Target = View.jobs.get('target');
	View.jobs.delete('target');
	View.storageChange.emit({ 'job:target': { oldValue: Target } }, 'local');
	await Settle();
	Assert.equal(View.updates.at(-1).get('target'), null);
});
