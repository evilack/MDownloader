import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {createContext, runInContext} from 'node:vm';
import {setImmediate as Settle} from 'node:timers/promises';
import {WebRtcPageTask} from '../extension/lib/webrtc-page.js';

function Fixture()
{
	const Clones = [], Messages = [];
	let Tick;
	class Track
	{
		constructor(Id, Kind) { this.id = Id; this.kind = Kind; this.readyState = 'live'; }
		clone() { const Copy = new Track(this.id + '-clone', this.kind); Clones.push(Copy); return Copy; }
		stop() { this.readyState = 'ended'; }
	}
	class Stream
	{
		constructor(Tracks) { this.tracks = Tracks; }
		getTracks() { return this.tracks; }
		getVideoTracks() { return this.tracks.filter(T => T.kind === 'video'); }
	}
	class Recorder
	{
		static isTypeSupported() { return true; }
		constructor(Source, Options) { this.source = Source; this.mimeType = Options.mimeType; this.state = 'inactive'; }
		start() { this.state = 'recording'; }
		stop()
		{
			this.state = 'inactive';
			queueMicrotask(() => { this.ondataavailable({data: new Blob(['media'])}); void this.onstop(); });
		}
	}
	class Reader
	{
		async readAsDataURL(Part)
		{
			this.result = 'data:video/mp4;base64,' + Buffer.from(await Part.arrayBuffer()).toString('base64');
			this.onload();
		}
	}
	const Original = new Stream([new Track('video', 'video'), new Track('audio', 'audio')]);
	const Player = {srcObject: Original, paused: false, ended: false, videoWidth: 720, videoHeight: 960, readyState: 4,
		isConnected: true, getBoundingClientRect: () => ({width: 720, height: 960}), closest: () => null};
	const Context = createContext({location: {href: 'https://player.test/live'}, document: {title: 'live', querySelectorAll: () => [Player]},
		MediaStream: Stream, MediaRecorder: Recorder, FileReader: Reader, Blob, clearInterval() {},
		setInterval(Fn) { Tick = Fn; return 1; }, addEventListener() {}, removeEventListener() {},
		chrome: {runtime: {async sendMessage(Message) { Messages.push(Message); return {ok: true}; }}}});
	const Run = Options =>
	{
		Context.Options = {page: 'https://player.test/live', requestId: 'recording', token: 'secret', trackId: 'video',
			maxChunkBytes: 3, maxQueuedBytes: 100, ...Options};
		return runInContext('(' + WebRtcPageTask.toString() + ')(Options)', Context);
	};
	return {Run, Original, Player, Clones, Messages, tick: () => Tick()};
}

Test('records only the selected live source and stops only cloned tracks', async () =>
{
	const F = Fixture();
	Assert.equal((await F.Run({action: 'start', trackId: 'wrong'})).error, 'webrtc_source_changed');
	Assert.equal((await F.Run({action: 'start'})).width, 720);
	Assert.equal((await F.Run({action: 'start', requestId: 'other'})).error, 'webrtc_busy');
	Assert.equal(await F.Run({action: 'stop', token: 'wrong'}), null);
	Assert.equal(F.Original.getTracks().every(T => T.readyState === 'live'), true);
	await F.Run({action: 'stop'});
	await Settle();
	Assert.equal(F.Clones.every(T => T.readyState === 'ended'), true);
	Assert.equal(F.Original.getTracks().every(T => T.readyState === 'live'), true);
	Assert.deepEqual(F.Messages.filter(M => M.data).map(M => [M.sequence, M.data]), [[0, 'bWVk'], [1, 'aWE=']]);
	Assert.equal(F.Messages.at(-1).count, 2);
	Assert.equal(F.Messages.at(-1).reason, 'requested');
});

Test('a replaced source ends the recording instead of capturing another video', async () =>
{
	const F = Fixture();
	await F.Run({action: 'start'});
	F.Player.srcObject = null;
	await F.tick();
	await Settle();
	Assert.equal(F.Messages.at(-1).reason, 'webrtc_source_changed');
	Assert.equal(F.Original.getTracks().every(T => T.readyState === 'live'), true);
});

Test('paused videos and card previews are not offered as the recording source', async () =>
{
	const F = Fixture();
	F.Player.paused = true;
	Assert.equal((await F.Run({action: 'probe'})).streams.length, 0);
	F.Player.paused = false;
	F.Player.closest = () => ({});
	Assert.equal((await F.Run({action: 'probe'})).streams.length, 0);
});
