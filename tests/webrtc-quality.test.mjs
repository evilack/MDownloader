import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile as ReadFile} from 'node:fs/promises';
import {createContext, runInContext} from 'node:vm';

const Code = await ReadFile(new URL('../extension/webrtc-quality-observer.js', import.meta.url), 'utf8');
const SDP = 'a=ice-ufrag:receiver\r\na=fingerprint:sha-256 AA:BB\r\n';
function Fixture()
{
	const Sent = [], Listeners = new Map();
	class Socket extends EventTarget
	{
		readyState = 1;
		url = 'wss://edge-webrtc.doppiocdn.com/signaling';
		send(Data) { Sent.push(JSON.parse(Data)); }
		receive(Message) { this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(Message)})); }
	}
	class Peer
	{
		connectionState = 'connected';
		async setRemoteDescription(Description) { this.remoteDescription = Description; }
		getReceivers() { return [{track: {id: 'video', kind: 'video', readyState: 'live'}}]; }
	}
	const Video = {srcObject: {getVideoTracks: () => [{id: 'video', readyState: 'live'}]}, videoWidth: 720, videoHeight: 960};
	const Context = createContext({WebSocket: Socket, RTCPeerConnection: Peer, URL, document: {querySelectorAll: () => [Video]},
		location: {href: 'https://player.test/live'}, crypto, Date, JSON, Map, Set, Object, Promise, setTimeout, clearTimeout,
		setInterval: () => 1, clearInterval() {}, addEventListener: (Name, Fn) => Listeners.set(Name, Fn)});
	runInContext(Code, Context);
	const Api = Context.MDownloaderWebRtcQuality, Ws = new Socket(), Pc = new Peer();
	const Send = (Message, Data) => Ws.send(JSON.stringify({message: Message, data: Data}));
	async function Connect()
	{
		Send('connection', [{appKey: 'player-key', custom: {name: 'stream', aclAuth: 'observed-session-authorization'}}]);
		Send('getStreamInfo', {mediaSessionId: 'session', modelName: 'stream'});
		Ws.receive({message: 'getStreamInfoReply', data: {mediaSessionId: 'session', status: true, profiles: {
			'160p_blurred': {width: 284, height: 160, bitrate: 100000, abr: false},
			'240p': {width: 426, height: 240, bitrate: 500000, abr: true},
			'source': {width: 720, height: 960, bitrate: 1800000, abr: true}}}});
		Send('playStream', [{mediaSessionId: 'session', quality: 'source'}]);
		Ws.receive({message: 'setRemoteSDP', data: ['session', SDP]});
		await Pc.setRemoteDescription({type: 'answer', sdp: SDP});
	}
	return {Api, Ws, Pc, Video, Sent, Send, Connect, event: (Name, Detail) => Listeners.get(Name)?.({detail: Detail})};
}

Test('server profiles are bound to the exact receiver track and omit blurred preview', async () =>
{
	const F = Fixture();
	await F.Connect();
	const List = F.Api.list('video');
	Assert.deepEqual(Array.from(List, Q => Q.name), ['source', '240p']);
	Assert.equal(List[0].resolution, '720x960');
	Assert.equal(F.Api.list('other').length, 0);
	Assert.equal(JSON.stringify(List).includes('mediaSessionId'), false);
	Assert.equal(JSON.stringify(List).includes('receiver'), false);
});

Test('quality selection waits for server success and actual dimensions, maintains selection and restores control', async () =>
{
	const F = Fixture(); await F.Connect();
	const Choice = F.Api.list('video')[1];
	const Pending = F.Api.select('video', Choice, 'lease');
	Assert.equal(F.Sent.at(-1).message, 'changeQuality');
	Assert.equal(F.Sent.at(-1).data.quality, '240p');
	F.Ws.receive({message: 'changeQualityStatus', data: {status: 'success', currentQuality: '240p'}});
	F.Video.videoWidth = 180; F.Video.videoHeight = 240;
	Assert.equal((await Pending).width, 180);
	F.Send('changeQuality', {mediaSessionId: 'session', quality: 'source'});
	Assert.equal(F.Sent.at(-1).data.quality, '240p', 'ABR cannot replace the selected server profile during recording');
	F.Api.release('lease');
	Assert.equal(F.Sent.at(-1).data.quality, 'source');
	F.Send('changeQuality', {mediaSessionId: 'session', quality: 'source'});
	Assert.equal(F.Sent.at(-1).data.quality, 'source');
});

Test('server failure and stale session release the lock without recording another quality', async () =>
{
	const F = Fixture(); await F.Connect();
	const Choice = F.Api.list('video')[1];
	const Pending = F.Api.select('video', Choice, 'lease');
	F.Ws.receive({message: 'changeQualityStatus', data: {status: 'failed', currentQuality: 'source'}});
	await Assert.rejects(Pending, /webrtc_quality_failed/);
	F.Send('getStreamInfo', {mediaSessionId: 'replacement'});
	await Assert.rejects(F.Api.select('video', Choice, 'lease2'), /webrtc_quality_unavailable/);
	Assert.equal(F.Api.list('video').length, 0);
});

Test('cancellation before the MAIN select arrives prevents any server change', async () =>
{
	const F = Fixture(); await F.Connect();
	const Count = F.Sent.length, Choice = F.Api.list('video')[1];
	F.Api.release('canceled-before-start');
	await Assert.rejects(F.Api.select('video', Choice, 'canceled-before-start'), /webrtc_quality_failed/);
	Assert.equal(F.Sent.length, Count);
});

Test('a background connection descriptor is bound to the exact observed session and stays out of quality lists', async () =>
{
	const F = Fixture(); await F.Connect();
	const Choice = F.Api.list('video')[1];
	const Descriptor = F.Api.connection('video', Choice);
	Assert.equal(Descriptor.url, 'wss://edge-webrtc.doppiocdn.com/signaling');
	Assert.equal(Descriptor.quality, '240p');
	Assert.equal(Descriptor.connection.custom.aclAuth, 'observed-session-authorization');
	Assert.equal(JSON.stringify(F.Api.list('video')).includes('observed-session-authorization'), false);
	Assert.throws(() => F.Api.connection('other', Choice), /webrtc_background_unavailable/);
	Assert.throws(() => F.Api.connection('video', {...Choice, session: 'stale'}), /webrtc_quality_unavailable/);
});
