import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setImmediate as Settle} from 'node:timers/promises';
import {CreateWebRtcTransfers} from '../extension/lib/webrtc-transfers.js';
import {SummarizeJob} from '../extension/lib/browser-job-state.js';
import {CreateTransferSnapshots} from '../extension/lib/transfer-snapshots.js';

Test('the normal manager keeps a recording active without misclassifying it as HLS or a missing download', () =>
{
	const Job = {requestId: 'recording', recording: true, live: true, state: 'active', bytesReceived: 500};
	Assert.equal(SummarizeJob(Job, undefined, {recordingIds: ['recording']}).state, 'active');
	Assert.equal(SummarizeJob(Job, undefined, {}, true).state, 'active');
	Assert.equal(SummarizeJob(Job, undefined, {}).state, 'failed');
	Assert.equal(SummarizeJob(Job, undefined, {recordingIds: ['recording']}).hls, undefined);
});

function Fixture({storeGate, snapshots} = {})
{
	const Reports = [], Saved = [], Released = [];
	const Transfers = CreateWebRtcTransfers({extensionId: 'extension', snapshots,
		async createStore()
		{
			if (storeGate) await storeGate;
			const Chunks = [];
			return {bytes: 0, async write(Data) { Chunks.push(Data); this.bytes += Data.length; }, async close() {},
				snapshot(Mime) { const Frozen = Chunks.slice(); return async () => new Blob(Frozen, {type: Mime}); },
				async file(Mime) { return new Blob(Chunks, {type: Mime}); }};
		}, async report(Id, Action, Fields) { Reports.push({Id, Action, ...Fields}); if (Action === 'recordingFormat') return Fields.partial ? 'partial.mp4' : 'video.mp4'; },
		async saveFile(Job, File, Signal) { Signal.throwIfAborted(); Saved.push({Job, File}); }, async release(Id) { Released.push(Id); }});
	const Job = {requestId: 'recording', token: 'secret', tabId: 7, documentId: 'doc', page: 'https://player.test/live', mimeType: 'video/mp4', filename: 'video.mp4'};
	const Sender = {id: 'extension', tab: {id: 7}, documentId: 'doc', frameId: 0, url: Job.page};
	const Accept = Fields => Transfers.accept({type: 'webrtcRecordingData', requestId: Job.requestId, token: Job.token, ...Fields}, Sender);
	return {Transfers, Reports, Saved, Released, Job, Sender, Accept};
}

Test('a WebRTC job is active before the first chunk and reports received bytes before saving', async () =>
{
	const F = Fixture();
	await F.Transfers.prepare(F.Job);
	Assert.deepEqual(F.Transfers.ids(), ['recording']);
	Assert.equal((await F.Accept({sequence: 0, data: 'AAEC'})).ok, true);
	Assert.equal(F.Reports.some(R => R.Action === 'progress' && R.received === 3 && R.live), true);
	Assert.equal(F.Saved.length, 0);
	await F.Transfers.finish('recording', 1, 'requested');
	Assert.equal(F.Saved.length, 1);
	Assert.deepEqual([...new Uint8Array(await F.Saved[0].File.arrayBuffer())], [0, 1, 2]);
	Assert.deepEqual(F.Transfers.ids(), []);
	Assert.deepEqual(F.Released, ['recording']);
});

Test('another document cannot inject chunks and source loss saves a partial file', async () =>
{
	const F = Fixture();
	await F.Transfers.prepare(F.Job);
	Assert.equal((await F.Transfers.accept({type: 'webrtcRecordingData', requestId: 'recording', token: 'secret', sequence: 0, data: 'AAEC'}, {...F.Sender, documentId: 'other'})).ok, false);
	await F.Accept({sequence: 0, data: 'AAEC'});
	await F.Transfers.sourceLost(7);
	Assert.equal(F.Saved[0].Job.filename, 'partial.mp4');
});

Test('cancel discards captured data and never saves it', async () =>
{
	const F = Fixture();
	await F.Transfers.prepare(F.Job);
	await F.Accept({sequence: 0, data: 'AAEC'});
	Assert.equal(await F.Transfers.cancel('recording'), true);
	await Settle();
	Assert.equal(F.Saved.length, 0);
	Assert.equal(F.Reports.some(R => R.Action === 'failure' && R.canceled), true);
	Assert.deepEqual(F.Released, ['recording']);
});

Test('a same-document URL change finalizes the old source while an unchanged URL does not', async () =>
{
	const F = Fixture();
	await F.Transfers.prepare(F.Job);
	await F.Accept({sequence: 0, data: 'AAEC'});
	await F.Transfers.sourceLost(7, 'https://player.test/live');
	Assert.deepEqual(F.Transfers.ids(), ['recording']);
	await F.Transfers.sourceLost(7, 'https://player.test/other');
	Assert.equal(F.Saved[0].Job.filename, 'partial.mp4');
});

Test('cancel during store initialization is retained and prevents an active receiver', async () =>
{
	const Gate = Promise.withResolvers(), F = Fixture({storeGate: Gate.promise});
	const Preparing = F.Transfers.prepare(F.Job).catch(ErrorValue => ErrorValue);
	await Settle();
	const Canceled = F.Transfers.cancel('recording');
	Gate.resolve();
	await Preparing;
	Assert.equal(await Canceled, true);
	Assert.deepEqual(F.Transfers.ids(), []);
	Assert.equal(F.Saved.length, 0);
});

Test('current save exposes its committed prefix and keeps the original recording receiving', async () =>
{
	const Gate = Promise.withResolvers(); let Frozen, Signal;
	const Snapshots = CreateTransferSnapshots(async (Job, Snapshot, CurrentSignal) =>
	{
		Signal = CurrentSignal;
		await Gate.promise;
		Frozen = await Snapshot.recording.readFile();
		Assert.equal(Snapshot.recording.format, 'MP4');
	});
	const F = Fixture({snapshots: Snapshots}); await F.Transfers.prepare(F.Job);
	await Assert.rejects(Snapshots.save('recording', {requestId: 'too-early'}), {key: 'job_snapshot_unavailable'});
	await F.Accept({sequence: 0, data: 'AAEC'});
	Assert.equal(F.Reports.at(-1).snapshotAvailable, true);
	const Saving = Snapshots.save('recording', {requestId: 'partial'});
	await F.Accept({sequence: 1, data: 'AwQF'});
	Assert.deepEqual(F.Transfers.ids(), ['recording']);
	Assert.equal(Signal.aborted, false);
	Gate.resolve(); await Saving;
	Assert.deepEqual([...new Uint8Array(await Frozen.arrayBuffer())], [0, 1, 2]);
	Assert.equal((await F.Accept({sequence: 2, data: 'BgcI'})).ok, true);
	await F.Transfers.finish('recording', 3, 'requested');
	Assert.equal(F.Saved[0].File.size, 9);
});

Test('parent cleanup waits for a separate partial save without canceling its signal', async () =>
{
	const Gate = Promise.withResolvers(); let Signal;
	const Snapshots = CreateTransferSnapshots(async (_Job, Snapshot, CurrentSignal) =>
	{
		Signal = CurrentSignal; await Gate.promise;
		Assert.equal((await Snapshot.recording.readFile()).size, 3);
	});
	const F = Fixture({snapshots: Snapshots}); await F.Transfers.prepare(F.Job);
	await F.Accept({sequence: 0, data: 'AAEC'});
	const Saving = Snapshots.save('recording', {requestId: 'partial'});
	await Settle();
	const Canceling = F.Transfers.cancel('recording');
	await Settle();
	Assert.deepEqual(F.Released, []);
	Assert.equal(Signal.aborted, false);
	Gate.resolve(); await Saving; await Canceling;
	Assert.deepEqual(F.Released, ['recording']);
	Assert.deepEqual(F.Saved, [], 'parent cancellation still discards only the parent output');
});

Test('canceling a partial save does not cancel the original recording or future saves', async () =>
{
	const Gate = Promise.withResolvers();
	const Snapshots = CreateTransferSnapshots(async (_Job, _Snapshot, Signal) =>
	{
		await Gate.promise; Signal.throwIfAborted();
	});
	const F = Fixture({snapshots: Snapshots}); await F.Transfers.prepare(F.Job);
	await F.Accept({sequence: 0, data: 'AAEC'});
	const Saving = Snapshots.save('recording', {requestId: 'partial'});
	Assert.equal(Snapshots.cancel('partial'), true);
	Gate.resolve(); await Assert.rejects(Saving, {name: 'AbortError'});
	Assert.equal((await F.Accept({sequence: 1, data: 'AwQF'})).ok, true);
	await Snapshots.save('recording', {requestId: 'retry-partial'});
	await F.Transfers.finish('recording', 2, 'requested');
	Assert.equal(F.Saved[0].File.size, 6);
});
