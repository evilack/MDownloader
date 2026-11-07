import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {ReadCommittedSnapshot} from '../extension/lib/committed-snapshot.js';
import {CreateTransferSnapshots} from '../extension/lib/transfer-snapshots.js';
Test('uses only a closed contiguous prefix and freezes it while later segments arrive', () =>
{
	const Tracks = [{saved: [{path: 'a.ts', duration: 2}, {path: 'b.ts', duration: 2}, {path: 'c.ts', duration: 2}]}];
	const Files = new Map([['b.ts', 20]]);
	Assert.equal(ReadCommittedSnapshot(Tracks, Files), null);
	Files.set('a.ts', 10);
	const Snapshot = ReadCommittedSnapshot(Tracks, Files);
	Assert.deepEqual(Snapshot.video.map(S => S.path), ['a.ts', 'b.ts']);
	Assert.equal(Snapshot.progress.received, 30);
	Files.set('c.ts', 30);
	Assert.equal(Snapshot.video.length, 2);
	Assert.equal(ReadCommittedSnapshot(Tracks, Files).video.length, 3);
});
Test('requires a completed initialization and audio coverage before exporting video', () =>
{
	const Tracks = [{playlist: {}, saved: [{path: 'v0.m4s', init: 'init.mp4', duration: 6}, {path: 'v1.m4s', init: 'init.mp4', duration: 6}]},
		{audio: true, playlist: {}, saved: [{path: 'a0.aac', duration: 3}, {path: 'a1.aac', duration: 3}, {path: 'a2.aac', duration: 3}]}];
	const Files = new Map([['v0.m4s', 10], ['v1.m4s', 10], ['a0.aac', 10], ['a1.aac', 10], ['a2.aac', 10]]);
	Assert.equal(ReadCommittedSnapshot(Tracks, Files), null);
	Files.set('init.mp4', 5);
	const Snapshot = ReadCommittedSnapshot(Tracks, Files);
	Assert.equal(Snapshot.video.length, 1);
	Assert.equal(Snapshot.audio.length, 2);
	Assert.equal(Snapshot.progress.received, 35);
});
Test('isolates partial saves and holds source cleanup until pending readers finish', async() =>
{
	const Wait = Promise.withResolvers(), Events = [];
	const Saves = CreateTransferSnapshots(async(Job, Data, Signal) =>
	{
		Events.push([Job.requestId, Data, Signal]);
		await Wait.promise;
	});
	Saves.register('parent', () => ({video: [{path: 'a.ts'}]}));
	const First = Saves.save('parent', {requestId: 'partial-a'});
	Assert.deepEqual(Saves.ids(), ['partial-a']);
	await Assert.rejects(Saves.save('parent', {requestId: 'partial-b'}), {key: 'job_snapshot_busy'});
	let bClosed = false;
	const Close = Saves.close('parent').then(() =>
	{
		bClosed = true;
	});
	await Promise.resolve();
	Assert.equal(bClosed, false);
	Assert.equal(Events[0][2].aborted, false);
	Assert.equal(Saves.cancel('partial-a'), true);
	Assert.equal(Events[0][2].aborted, true);
	Wait.resolve();
	await First;
	await Close;
	Assert.equal(bClosed, true);
	Assert.deepEqual(Saves.ids(), []);
	await Assert.rejects(Saves.save('parent', {requestId: 'later'}), {key: 'job_snapshot_unavailable'});
});
Test('waits for video/audio overlap when the audio timeline begins after the first video segment', () =>
{
	const Tracks = [{playlist: {presentationTimeOffset: 2}, saved: [{path: 'v0', duration: 1}, {path: 'v1', duration: 2}]},
		{playlist: {}, audio: true, saved: [{path: 'a0', duration: 1}]}];
	const Files = new Map([['v0', 10], ['a0', 10]]);
	Assert.equal(ReadCommittedSnapshot(Tracks, Files), null);
	Files.set('v1', 20);
	const Snapshot = ReadCommittedSnapshot(Tracks, Files);
	Assert.equal(Snapshot.audio.length, 1);
	Assert.equal(Snapshot.video.length, 2);
	Assert.equal(Snapshot.audioShift, 2);
});
