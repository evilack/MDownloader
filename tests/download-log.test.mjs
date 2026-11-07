import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import {
	ClearDownloadLog, ReadDownloadLog, RecordBrowserDownload, RecordDownloadLog, SetDownloadLogging,
} from '../extension/lib/download-log.js';
import {DebugLog} from '../extension/lib/debug-log.js';
Test('keeps a bounded, local, opt-in log and records only safe diagnostic fields', async T =>
{
	const Storage = {};
	const RequestId = '01234567-89ab-cdef-0123-456789abcdef';
	const Items = new Map([
		[1, { byExtensionId: 'other-extension', state: 'complete' }],
		[2, { byExtensionId: 'this-extension', state: 'interrupted', error: 'USER_CANCELED' }],
		[3, { byExtensionId: 'this-extension', state: 'complete', mime: 'text/html; charset=utf-8' }],
	]);
	globalThis.chrome = {
		runtime: { id: 'this-extension' },
		storage: { local: {
				async get(Key)
				{
					return { [Key]: Storage[Key] };
				},
				async set(Values)
				{
					Object.assign(Storage, Values);
				},
				async remove(Key)
				{
					delete Storage[Key];
				},
			} },
		downloads: { async search({ id: Id })
			{
				return [Items.get(Id)];
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await RecordDownloadLog('started', { requestId: RequestId });
	Assert.deepEqual(await ReadDownloadLog(), []);
	await SetDownloadLogging(true);
	await RecordDownloadLog('http-error', {
		requestId: RequestId, stage: 'master-request', status: 403,
		url: 'https://example.com/?token=secret', cookie: 'secret', filename: 'private.mp4',
	});
	await RecordBrowserDownload({ id: 1, state: { current: 'complete' } });
	await RecordBrowserDownload({ id: 2, state: { current: 'interrupted' } });
	await RecordBrowserDownload({ id: 3, state: { current: 'complete' } });
	const [Stage, bCanceled, WrongType] = (await ReadDownloadLog()).map(({ at: At, ...Event }) => Event);
	Assert.deepEqual(Stage, { result: 'http-error', requestId: RequestId, stage: 'master-request', status: 403 });
	Assert.deepEqual(bCanceled, { result: 'canceled', downloadId: 2, browserError: 'USER_CANCELED' });
	Assert.deepEqual(WrongType, { result: 'failed', downloadId: 3, reason: 'job_not_video' });
	await Promise.all(Array.from({ length: 201 }, (_, DownloadId) =>
	RecordDownloadLog('started', { downloadId: DownloadId })));
	const Log = await ReadDownloadLog();
	Assert.equal(Log.length, 200);
	Assert.equal(new Set(Log.map(Event => Event.downloadId)).size, 200);
	await SetDownloadLogging(false);
	await RecordDownloadLog('failed', { requestId: RequestId });
	Assert.deepEqual(await ReadDownloadLog(), Log);
	await ClearDownloadLog();
	Assert.deepEqual(await ReadDownloadLog(), []);
});
Test('another context disabling logging wins even before its storage event is delivered', async T =>
{
	const Values = {logDownloads: true};
	let Reads = 0;
	const Listeners = new Set();
	globalThis.chrome = {storage: {local: {
				get: async Keys =>
				{
					Reads++;
					return Object.fromEntries((Array.isArray(Keys) ? Keys : [Keys]).map(Key => [Key, Values[Key]]));
				},
				set: async Changes => Object.assign(Values, Changes),
			}, onChanged: {addListener: Listener => Listeners.add(Listener), removeListener: Listener => Listeners.delete(Listener)}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Worker = await import('../extension/lib/download-log.js?context=worker');
	const Options = await import('../extension/lib/download-log.js?context=options');
	await Worker.RecordDownloadLog('started');
	await Options.SetDownloadLogging(false);
	const Before = Reads;
	for (let Index = 0; Index < 100; Index++)
	{
		await Worker.RecordDownloadLog('failed');
	}
	Assert.equal(Reads - Before, 1, 'one locked OFF confirmation updates the stale cache for subsequent events');
	Assert.deepEqual(Values['download-log'].map(Entry => Entry.result), ['started']);
});
Test('detailed browser completion diagnostics work independently from persisted result logging', async T =>
{
	T.mock.method(console, 'debug', () =>
	{
	});
	globalThis.chrome = {runtime: {id: 'owner'}, storage: {local: {get: async () => ({})}}, downloads: {
			search: async () => [{byExtensionId: 'owner', state: 'complete', bytesReceived: 120, mime: 'video/mp4'}],
		}};
	DebugLog.SetEnabled(true);
	T.after(() =>
	{
		DebugLog.SetEnabled(false);
		delete globalThis.chrome;
	});
	await RecordBrowserDownload({id: 1, state: {current: 'complete'}});
	Assert.equal(DebugLog.Snapshot().find(Entry => Entry.event === 'SaveFinished')?.bytes, 120);
});
