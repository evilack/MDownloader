import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Scan, ResolveCandidate} from '../extension/detection.js';
import {MockSourceProviders} from './helpers/webrtc-connection.mjs';

Test('the actual WebRTC track is a normal candidate instead of unbound historic HLS', async T =>
{
	const Page = 'https://player.test/live', Doc = 'document';
	let Track = 'real-track';
	const Data = {'network:70': [{url: 'https://cdn.test/160p_blurred.m3u8', name: '160p_blurred.m3u8', format: 'M3U8', supported: true,
		initiator: 'https://player.test', documentId: Doc, page: Page}]};
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {local: {get: async () => ({})},
		session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}},
		scripting: {async executeScript({func})
		{
			if (func.name === 'CollectVideos') return [{documentId: Doc, result: {page: Page, sources: [], playlists: [],
				liveStream: true, opaquePlayer: true, observerReady: true}}];
			if (func.name === 'WebRtcPageTask') return [{documentId: Doc, result: {page: Page, title: 'live', mimeType: 'video/mp4',
				streams: [{trackId: Track, width: 720, height: 960}]}}];
			return [{documentId: Doc, result: {page: Page, active: true, pageTitle: 'live'}}];
		}}};
	T.after(() => { delete globalThis.chrome; });
	const Result = await Scan(70);
	Assert.equal(Result.candidates.length, 1);
	Assert.equal(Result.candidates[0].format, 'WEBRTC');
	Assert.equal(Result.candidates[0].name, 'WebRTC-720x960.mp4');
	Assert.equal(Result.candidates[0].supported, true);
	Assert.equal(Result.candidates[0].live, true);
	const Candidate = await ResolveCandidate(70, Result.scanId, 0);
	Assert.equal(Candidate.trackId, 'real-track');
	Assert.equal(Candidate.documentId, Doc);
	Track = 'replacement';
	await Assert.rejects(ResolveCandidate(70, Result.scanId, 0), {key: 'candidate_changed'});
	Assert.equal(Data['network:70'].length, 1, 'historical requests remain as evidence, not current playback candidates');
});

Test('a real HLS URL remains downloadable alongside WebRTC while blurred previews stay hidden', async T =>
{
	const Page = 'https://player.test/G-Velvet', Doc = 'document';
	const Hls = 'https://cdn.test/live/master.m3u8', Blur = 'https://cdn.test/123_160p_blurred.m3u8';
	const Data = {'network:71': [Hls, Blur].map(Url => ({url: Url, name: Url.split('/').at(-1), format: 'M3U8',
		supported: true, live: true, initiator: 'https://player.test', documentId: Doc, page: Page}))};
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {local: {get: async () => ({})},
		session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}},
		scripting: {async executeScript({func})
		{
			if (func.name === 'CollectVideos') return [{documentId: Doc, result: {page: Page, sources: [], playlists: [],
				liveStream: true, opaquePlayer: true, observerReady: true}}];
			if (func.name === 'WebRtcPageTask') return [{documentId: Doc, result: {page: Page, mimeType: 'video/mp4',
				streams: [{trackId: 'live-video', width: 1920, height: 1080}]}}];
			return [{documentId: Doc, result: {page: Page, active: true, pageTitle: 'G-Velvet'}}];
		}}};
	T.after(() => { delete globalThis.chrome; });
	const Result = await Scan(71);
	Assert.deepEqual(Result.candidates.map(Candidate => Candidate.format), ['WEBRTC', 'M3U8']);
	Assert.equal(Result.candidates[1].name, 'master.m3u8');
	const Candidate = await ResolveCandidate(71, Result.scanId, 1);
	Assert.equal(Candidate.url, Hls);
	Assert.equal(Candidate.live, true);
	Assert.equal(Data['network:71'].length, 2, 'preview exclusion must not erase the original observations');
});

Test('an unclassified connectivity playlist does not block declared HLS discovery while WebRTC plays', async T =>
{
	MockSourceProviders(T);
	const Page = 'https://player.test/G-Velvet', Doc = 'document', Master = 'https://cdn.test/master.m3u8';
	const Data = {'network:72': [{url: 'https://cdn.test/ping.m3u8', name: 'ping.m3u8', format: 'M3U8',
		supported: true, initiator: 'https://player.test', documentId: Doc, page: Page}]};
	let Discoveries = 0;
	globalThis.chrome = {runtime: {getURL: Path => 'chrome-extension://owner/' + Path}, permissions: {contains: async () => true},
		storage: {local: {get: async () => ({})}, session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}},
		scripting: {async executeScript({func, args})
		{
			if (func.name === 'CollectVideos') return [{documentId: Doc, result: {page: Page, sources: [], playlists: [], liveStream: true, opaquePlayer: true, observerReady: true}}];
			if (func.name === 'WebRtcPageTask') return [{documentId: Doc, result: {page: Page, mimeType: 'video/mp4', streams: [{trackId: 'live', width: 1920, height: 1080}]}}];
			if (func.name === 'DeclaredStreamPageTask')
			{
				if (args[0].mode === 'discover') { Discoveries++; return [{documentId: Doc, result: {url: Master}}]; }
				const Url = args[0].url, IsMaster = Url === Master;
				Data['network:72'].push({url: Url, name: Url.split('/').at(-1), format: 'M3U8', supported: true, initiator: 'https://player.test', documentId: Doc, page: Page, declaredPage: Page});
				return [{documentId: Doc, result: {url: Url, text: IsMaster ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nhigh.m3u8\n' : '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\npart.ts\n'}}];
			}
			return [{documentId: Doc, result: {page: Page, active: true}}];
		}}};
	T.after(() => { delete globalThis.chrome; });
	const Result = await Scan(72);
	Assert.equal(Discoveries, 1);
	Assert.ok(Result.candidates.some(Candidate => Candidate.name === 'master.m3u8'));
});
