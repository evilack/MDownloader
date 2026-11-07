import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setImmediate as Settle} from 'node:timers/promises';
import {StartWebRtcReceiver} from '../extension/lib/webrtc-receiver.js';

function Fixture(Options = {})
{
	const Sockets = [], Peers = [], Recorders = [], Data = [], Ends = [];
	class Events
	{
		listeners = new Map();
		addEventListener(Name, Fn) { const List = this.listeners.get(Name) || []; List.push(Fn); this.listeners.set(Name, List); }
		removeEventListener(Name, Fn) { this.listeners.set(Name, (this.listeners.get(Name) || []).filter(Item => Item !== Fn)); }
		emit(Name, Fields = {}) { for (const Fn of this.listeners.get(Name) || []) Fn(Fields); this['on' + Name]?.(Fields); }
	}
	const Video = Object.assign(new Events(), {kind: 'video', muted: !!Options.mutedTracks, readyState: 'live', getSettings: () => ({width: 1920, height: 1080}), stop() { this.readyState = 'ended'; }});
	const Audio = Object.assign(new Events(), {kind: 'audio', muted: !!Options.mutedTracks, readyState: 'live', stop() { this.readyState = 'ended'; }});
	class Socket extends Events
	{
		constructor(Url) { super(); this.url = Url; this.readyState = 0; this.sent = []; Sockets.push(this); }
		send(Value) { this.sent.push(JSON.parse(Value)); }
		close() { this.readyState = 3; this.emit('close'); }
		open() { this.readyState = 1; this.emit('open'); }
		message(Value) { this.emit('message', {data: JSON.stringify(Value)}); }
	}
	class Peer extends Events
	{
		constructor(Config) { super(); this.config = Config; this.kinds = []; this.connectionState = 'new'; Peers.push(this); }
		addTransceiver(Kind, Config) { this.kinds.push([Kind, Config.direction]); }
		async createOffer() { return {type: 'offer', sdp: 'v=0\r\na=rtpmap:100 H264/90000\r\na=fmtp:100 packetization-mode=1\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10\r\n'}; }
		async setLocalDescription(Value) { this.localDescription = Value; }
		async setRemoteDescription(Value) { this.remoteDescription = Value; this.emit('track', {track: Video}); this.emit('track', {track: Audio}); }
		async getStats() { return new Map([['video', {type: 'inbound-rtp', kind: 'video', bytesReceived: 100, framesDecoded: 1}]]); }
		close() { this.connectionState = 'closed'; this.closed = true; this.emit('connectionstatechange'); }
	}
	class Stream
	{
		tracks = [];
		addTrack(Track) { this.tracks.push(Track); }
		getTracks() { return this.tracks; }
		getVideoTracks() { return this.tracks.filter(T => T.kind === 'video'); }
	}
	class Recorder extends Events
	{
		static isTypeSupported(Value) { return !Options.webmOnly || Value.startsWith('video/webm'); }
		constructor(StreamValue, Config) { super(); this.stream = StreamValue; this.mimeType = Config.mimeType; this.state = 'inactive'; Recorders.push(this); }
		start(Slice) { if (Options.startThrows) throw new Error('private-codec-detail'); this.slice = Slice; this.state = 'recording'; }
		chunk(Value = 'chunk') { this.emit('dataavailable', {data: new Blob([Value])}); }
		stop() { this.state = 'inactive'; this.chunk('last'); this.emit('stop'); }
	}
	const Descriptor = {url: 'wss://receiver.test/path', connection: {appKey: 'private-key', custom: {name: 'stream', aclAuth: 'private-token'}}, streamId: 'stream', quality: 'source'};
	const Dependencies = {WebSocket: Socket, RTCPeerConnection: Peer, MediaStream: Stream, MediaRecorder: Recorder,
		crypto: {randomUUID: () => 'independent-session'}, navigator: {userAgent: 'test-agent', appVersion: 'test-os'},
		setTimeout: (...Args) => setTimeout(...Args).unref(), clearTimeout, setInterval: (...Args) => setInterval(...Args).unref(), clearInterval, Date};
	const Receiver = StartWebRtcReceiver(Descriptor, {signal: Options.signal,
		onData: async BlobValue => { if (Options.onData) await Options.onData(BlobValue); Data.push(await BlobValue.text()); }, onEnd: Reason => Ends.push(Reason)}, Dependencies);
	const Info = {status: true, mediaSessionId: 'independent-session', profiles: {source: {width: 1920, height: 1080, bitrate: 4000000}}};
	async function Connect()
	{
		await Settle(); Sockets[0].open();
		Sockets[0].message({message: 'connected', data: {features: {getStreamInfo: true}, peerConfig: {iceServers: [{urls: 'turn:receiver.test', username: 'u', credential: 'c'}], iceTransportPolicy: 'relay'}}});
		await Settle(); Sockets[0].message({message: 'getStreamInfoReply', data: Info});
		await Settle(); Sockets[0].message({message: 'setRemoteSDP', data: ['independent-session', 'answer-sdp']}); await Settle();
	}
	return {Receiver, Descriptor, Sockets, Peers, Recorders, Video, Audio, Data, Ends, Info, Connect};
}

Test('independent signaling validates server quality and starts MP4 recording before readiness', async () =>
{
	const F = Fixture(); await F.Connect();
	Assert.equal(F.Sockets[0].url, F.Descriptor.url);
	Assert.equal(F.Sockets[0].sent[0].message, 'connection');
	Assert.deepEqual(F.Sockets[0].sent[0].data[0].custom, F.Descriptor.connection.custom);
	Assert.deepEqual(F.Peers[0].kinds, [['audio', 'recvonly'], ['video', 'recvonly']]);
	Assert.equal(F.Peers[0].config.iceTransportPolicy, 'relay');
	const Play = F.Sockets[0].sent.find(M => M.message === 'playStream').data[0];
	Assert.equal(Play.mediaSessionId, 'independent-session'); Assert.equal(Play.name, 'stream'); Assert.equal(Play.quality, 'source');
	Assert.equal(Play.minBitrate, 0); Assert.match(Play.sdp, /x-google-start-bitrate=100/); Assert.match(Play.sdp, /stereo=1;sprop-stereo=1/);
	Assert.equal(F.Recorders[0].slice, 1000);
	let Ready = false; F.Receiver.ready.then(() => { Ready = true; }); await Settle(); Assert.equal(Ready, false);
	F.Recorders[0].chunk('first');
	Assert.deepEqual(await F.Receiver.ready, {mimeType: 'video/mp4;codecs=avc1.42001f,mp4a.40.2', width: 1920, height: 1080});
	await F.Receiver.stop('requested'); Assert.deepEqual(F.Data, ['first', 'last']); Assert.deepEqual(F.Ends, ['requested']);
	Assert.equal(F.Peers[0].closed, true); Assert.equal(F.Sockets[0].readyState, 3); Assert.equal(F.Video.readyState, 'ended');
});

Test('stop drains asynchronous committed chunks and final recorder data before one end callback', async () =>
{
	let Release; const Gate = new Promise(Resolve => { Release = Resolve; });
	const F = Fixture({onData: () => Gate}); await F.Connect(); F.Recorders[0].chunk('first');
	const Stop = F.Receiver.stop('requested'); await Settle(); Assert.deepEqual(F.Ends, []);
	Release(); await Stop; Assert.deepEqual(F.Data, ['first', 'last']); Assert.deepEqual(F.Ends, ['requested']);
	await F.Receiver.stop('canceled'); Assert.deepEqual(F.Ends, ['requested']);
	await Assert.rejects(F.Receiver.ready, /requested/);
});

Test('server unavailable and socket failure remain abnormal rather than clean recording completion', async () =>
{
	const F = Fixture(); await F.Connect(); F.Recorders[0].chunk(); await F.Receiver.ready;
	F.Sockets[0].message({message: 'notifyStreamStatusEvent', data: [{status: 'FAILED', info: 'private-server-detail'}]});
	await Settle(); await F.Receiver.stop('requested'); Assert.deepEqual(F.Ends, ['webrtc_connection_lost']);
});

Test('an unknown requested profile rejects without creating a peer or exposing authentication', async () =>
{
	const F = Fixture(); F.Info.profiles = {other: {width: 10, height: 10}}; await F.Connect();
	await Assert.rejects(F.Receiver.ready, ErrorValue => ErrorValue.message === 'webrtc_quality_unavailable');
	Assert.equal(F.Peers.length, 0); Assert.deepEqual(F.Ends, ['webrtc_quality_unavailable']);
});

Test('caller abort before connection rejects readiness and cleans up without starting media', async () =>
{
	const Controller = new AbortController(); const F = Fixture({signal: Controller.signal}); Controller.abort(); await Settle();
	await Assert.rejects(F.Receiver.ready, /canceled/); await F.Receiver.stop('requested');
	Assert.deepEqual(F.Ends, ['canceled']); Assert.equal(F.Peers.length, 0);
});

Test('peer failure uses abnormal termination and WebM fallback is reported accurately', async () =>
{
	const F = Fixture({webmOnly: true}); await F.Connect(); F.Recorders[0].chunk(); Assert.match((await F.Receiver.ready).mimeType, /^video\/webm/);
	F.Peers[0].connectionState = 'failed'; F.Peers[0].emit('connectionstatechange'); await F.Receiver.stop('requested');
	Assert.deepEqual(F.Ends, ['webrtc_connection_lost']);
});

Test('callback failure and excessive queued bytes stop rather than silently discarding data', async () =>
{
	const F = Fixture({onData: async () => { throw new Error('private-path'); }}); await F.Connect(); F.Recorders[0].chunk();
	await Assert.rejects(F.Receiver.ready, /webrtc_recording_failed/); await F.Receiver.stop('requested'); Assert.deepEqual(F.Ends, ['webrtc_recording_failed']);
	const G = Fixture(); await G.Connect(); G.Recorders[0].chunk(new Uint8Array(8 * 1048576 + 1)); await G.Receiver.stop('requested');
	await Assert.rejects(G.Receiver.ready, /webrtc_buffer_limit/); Assert.deepEqual(G.Ends, ['webrtc_buffer_limit']);
});

Test('wrong media session and malformed signaling cannot start a recorder', async () =>
{
	const F = Fixture(); await Settle(); F.Sockets[0].open();
	F.Sockets[0].message({message: 'connected', data: {features: {getStreamInfo: true}}}); await Settle();
	F.Sockets[0].message({message: 'getStreamInfoReply', data: {...F.Info, mediaSessionId: 'wrong'}}); await Settle();
	await Assert.rejects(F.Receiver.ready, /webrtc_connection_lost/); Assert.equal(F.Recorders.length, 0);
});

Test('recorder setup failure reports a recording error without native private details', async () =>
{
	const F = Fixture({startThrows: true}); await F.Connect();
	await Assert.rejects(F.Receiver.ready, ErrorValue => ErrorValue.message === 'webrtc_recording_failed');
	Assert.deepEqual(F.Ends, ['webrtc_recording_failed']); Assert.equal(F.Peers[0].closed, true);
});

Test('an inactive native recorder error still drains its following final dataavailable event', async () =>
{
	const F = Fixture(); await F.Connect(); F.Recorders[0].chunk('first'); await F.Receiver.ready;
	F.Recorders[0].state = 'inactive'; F.Recorders[0].emit('error');
	F.Recorders[0].chunk('native-final'); F.Recorders[0].emit('stop');
	await F.Receiver.stop('requested'); Assert.deepEqual(F.Data, ['first', 'native-final']); Assert.deepEqual(F.Ends, ['webrtc_recording_failed']);
});

Test('native muted audio and video must both receive media before the recorder is constructed', async () =>
{
	const F = Fixture({mutedTracks: true}); await F.Connect();
	Assert.equal(F.Recorders.length, 0);
	F.Video.muted = false; F.Video.emit('unmute'); await Settle(); Assert.equal(F.Recorders.length, 0);
	// Signaling stays responsive while waiting for the first audio packet.
	F.Sockets[0].message({message: 'ping'}); await Settle(); Assert.equal(F.Sockets[0].sent.at(-1).message, 'pong');
	F.Audio.muted = false; F.Audio.emit('unmute'); await Settle(); Assert.equal(F.Recorders.length, 1);
	Assert.deepEqual(F.Recorders[0].stream.getTracks().map(T => T.muted), [false, false]);
	F.Audio.emit('unmute'); Assert.equal(F.Recorders.length, 1);
	F.Recorders[0].chunk(); await F.Receiver.ready; await F.Receiver.stop();
});

Test('cancel while waiting for remote media cleans tracks and cannot start recording later', async () =>
{
	const F = Fixture({mutedTracks: true}); await F.Connect();
	await F.Receiver.stop('canceled'); await Assert.rejects(F.Receiver.ready, /canceled/);
	Assert.deepEqual(F.Ends, ['canceled']); Assert.equal(F.Peers[0].closed, true);
	F.Audio.muted = F.Video.muted = false; F.Audio.emit('unmute'); F.Video.emit('unmute');
	Assert.equal(F.Recorders.length, 0);
	Assert.equal(F.Audio.listeners.get('unmute')?.length || 0, 0);
});
