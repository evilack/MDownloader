import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Scan, ResolveCandidate} from '../extension/detection.js';

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
