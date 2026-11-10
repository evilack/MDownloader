import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Scan} from '../extension/detection.js';
import {ObserveResponse, ObserveManifest, NetworkCandidates} from '../extension/network.js';
import {DiscoverDashInitialization} from '../extension/lib/dash-initialization.js';

Test('DASH initialization MP4s are not standalone videos, including signed URLs and other documents', async T =>
{
	const Page = 'https://player.test/episode', Manifest = 'https://manifest.test/movie.mpd';
	const Init = 'https://cdn.test/random-uuid.mp4?Signature=a%2Bb';
	const OtherToken = Init.replace('a%2Bb', 'other');
	const ChildInit = Init + '&frame=child';
	const Independent = 'https://cdn.test/trailer.mp4';
	const Data = {'network:907': [
		{url: Init, format: 'MP4'}, {url: OtherToken, format: 'MP4'},
		{url: Independent, format: 'MP4'}, {url: Manifest, format: 'MPD'},
		{url: ChildInit, format: 'MP4', documentId: 'child', frameId: 1, parentDocumentId: 'dash-doc'},
	].map(Item => ({documentId: 'dash-doc', page: Page, initiator: 'https://player.test',
		supported: true, name: Item.url.split('/').at(-1), ...Item}))};
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {
		session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)},
		local: {get: async() => ({})}}, scripting: {executeScript: async({func: Func, target: Target}) =>
	{
		if (Func.name === 'CollectVideos') return [{documentId: 'dash-doc', result: {
			page: Page, sources: [], playlists: [], opaquePlayer: true, observerReady: true}}];
		if (Func.name === 'ParseDashInitializationUrls') return [{documentId: 'dash-doc', result: [Init, ChildInit]}];
		return [{documentId: Target.frameIds ? 'child' : 'dash-doc', result: {page: Page, active: true}}];
	}}};
	T.mock.method(globalThis, 'fetch', async() => new Response('<MPD/>'));
	T.after(() => {delete globalThis.chrome;});
	const Result = await Scan(907);
	Assert.equal(Result.candidates.length, 4, 'only the exact same-document initialization URL is excluded');
	Assert.equal(Result.candidates.filter(Item => Item.name.startsWith('random-uuid')).length, 2,
		'a different signed URL and a separate frame must survive');
});

Test('eventually inspects every observed MPD while limiting each scan to two new probes', async T =>
{
	const Calls = [], Page = 'https://player.test/three-manifests';
	globalThis.chrome = {scripting: {executeScript: async({args: Args}) =>
	{
		Calls.push(Args[1]);
		return [{documentId: 'three-doc', result: [Args[1] + '.init.mp4']}];
	}}};
	T.after(() => {delete globalThis.chrome;});
	const Items = [1, 2, 3].map(Index => ({url: `https://cdn.test/${Index}.mpd`, format: 'MPD',
		documentId: 'three-doc', initiator: 'https://player.test', dashManifest: '<MPD/>'}));
	Assert.equal((await DiscoverDashInitialization(909, 'three-doc', Page, Items)).size, 2);
	Assert.equal(Calls.length, 2);
	Assert.equal((await DiscoverDashInitialization(909, 'three-doc', Page, Items)).size, 3);
	Assert.equal(Calls.length, 3);
	Assert.equal((await DiscoverDashInitialization(909, 'three-doc', Page, Items)).size, 3);
	Assert.equal(Calls.length, 3);
});

Test('retains the actual observed DASH response instead of refetching a potentially different CDN manifest', async T =>
{
	const Data = {}, Page = 'https://player.test/movie', Url = 'https://cdn.test/stream.mpd?token=signed';
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {session: {
		get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}}};
	T.after(() => {delete globalThis.chrome;});
	const Sender = {tab: {id: 908}, documentId: 'dash-doc', frameId: 0, origin: 'https://player.test'};
	const Text = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period/></MPD>';
	await ObserveResponse({tabId: 908, documentId: 'dash-doc', frameId: 0, initiator: Sender.origin, method: 'GET', statusCode: 200, url: Url});
	await ObserveManifest({...Sender, origin: 'https://unrelated.test'}, {url: Url, text: 'untrusted', page: Page});
	await ObserveManifest(Sender, {url: Url, text: Text, page: Page});
	Assert.equal((await NetworkCandidates(908, 'dash-doc'))[0].dashManifest, Text);
	await ObserveManifest({...Sender, documentId: 'old-doc'}, {url: Url, text: 'untrusted', page: Page});
	Assert.equal((await NetworkCandidates(908, 'dash-doc'))[0].dashManifest, Text);
	globalThis.chrome.scripting = {executeScript: async({args: Args}) => [{documentId: 'dash-doc',
		result: [Args[0] === Text ? 'https://cdn-a.test/init.mp4' : 'https://cdn-b.test/init.mp4']} ]};
	Assert.equal((await DiscoverDashInitialization(908, 'dash-doc', Page, await NetworkCandidates(908, 'dash-doc'))).size, 1);
	await ObserveManifest(Sender, {url: Url, text: Text.replace('<Period/>', '<Period id="new-cdn"/>'), page: Page});
	Assert.deepEqual([...await DiscoverDashInitialization(908, 'dash-doc', Page, await NetworkCandidates(908, 'dash-doc'))],
		['https://cdn-a.test/init.mp4', 'https://cdn-b.test/init.mp4']);
});

Test('MAIN and ISOLATED manifest observers use distinct policy files so Chrome injects both', async T =>
{
	let Registered;
	globalThis.chrome = {permissions: {getAll: async() => ({origins: ['https://example.test/*']})}, scripting: {
		getRegisteredContentScripts: async() => [], registerContentScripts: async Scripts => {Registered = Scripts;}}};
	T.after(() => {delete globalThis.chrome;});
	const {SyncHlsDiscovery} = await import('../extension/hls-discovery.js');
	await SyncHlsDiscovery();
	Assert.notEqual(Registered.find(Item => Item.world === 'MAIN').js[0], Registered.find(Item => Item.world === 'ISOLATED').js[0]);
});
