import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Scan} from '../extension/detection.js';
import {HlsQualities} from '../extension/hls-jobs.js';
import {DiscoverNativeHls, ReadNativeHlsManifest} from '../extension/lib/native-hls-discovery.js';
Test('groups native HLS variants under their observed master and offers every declared quality', async T =>
{
	const Page = 'https://player.test/watch', Master = 'https://cdn.test/movie/master.m3u8';
	const Low = 'https://cdn.test/movie/low.m3u8', High = 'https://cdn.test/movie/high.m3u8';
	const Data = {'network:801': [High, Low, Master].map(Url => ({url: Url, name: Url.split('/').at(-1), format: 'M3U8', supported: true,
			page: Page, documentId: 'native-doc', initiator: 'https://player.test'}))};
	let ManifestReads = 0;
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {
			session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)},
			local: {get: async() => ({})},
		}, scripting: {executeScript: async({func: Func}) =>
			{
				if (Func.name === 'CollectVideos')
				{
					return[{documentId: 'native-doc', result: {page: Page, sources: [Master], playlists: [], observerReady: true}}];
				}
				if (Func.name === 'ReadNativeHlsManifest')
				{
					ManifestReads++;
					return[{documentId: 'native-doc', result: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x180\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nhigh.m3u8\n'}];
				}
				if (Func.name === 'CollectPlayerPreviews')
				{
					return[{documentId: 'native-doc', result: []}];
				}
				return[{documentId: 'native-doc', result: {page: Page, active: true, pageTitle: 'Native player'}}];
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const First = await Scan(801);
	Assert.equal(First.candidates.length, 1, 'master and two renditions are one video');
	Assert.equal(First.candidates[0].name, 'master.m3u8');
	const Qualities = await HlsQualities({tabId: 801, scanId: First.scanId, candidateId: 0});
	Assert.deepEqual(Qualities.map(X => [X.url, X.resolution, X.bandwidth]), [
		[High, '1920x1080', 3000000], [Low, '320x180', 300000],
	]);
	Assert.equal((await Scan(801)).candidates.length, 1);
	Assert.equal(ManifestReads, 1, 'unchanged scans must not repeatedly fetch the native master');
});
Test('does not roll an already observed SPA page back when an older native probe arrives late', async T =>
{
	const PageA = 'https://player.test/a', PageB = 'https://player.test/b', Url = 'https://cdn.test/master.m3u8';
	const Item = {url: Url, name: 'master.m3u8', format: 'M3U8', supported: true, documentId: 'spa-doc', initiator: 'https://player.test', page: PageA};
	const Data = {'network:802': [Item]};
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}},
		scripting: {executeScript: async() =>
			{
				Data['network:802'] = [{...Item, page: PageB}];
				return[{documentId: 'spa-doc', result: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nlow.m3u8\n'}];
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await DiscoverNativeHls(802, 'spa-doc', PageA, [Url], [Item]);
	Assert.equal(Data['network:802'][0].page, PageB);
	Assert.equal(Data['network:802'][0].qualities, undefined, 'the older body must not be committed into the newer page');
});
Test('bounds native manifest reads and rejects the result when the current page changes', async T =>
{
	const Page = 'https://player.test/watch', Url = 'https://cdn.test/master.m3u8';
	globalThis.location = {href: Page};
	globalThis.document = {querySelectorAll: () => [{currentSrc: Url}]};
	let bCanceled = false;
	T.after(() =>
	{
		delete globalThis.location;
		delete globalThis.document;
	});
	T.mock.method(globalThis, 'fetch', async() => new Response(new ReadableStream({start(Controller)
		{
			Controller.enqueue(new Uint8Array(33));
		}, cancel()
		{
			bCanceled = true;
		}})));
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 32, 5000), null);
	Assert.equal(bCanceled, true);
	T.mock.method(globalThis, 'fetch', async() =>
	{
		location.href = 'https://player.test/next';
		return new Response('#EXTM3U\n');
	});
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 32, 5000), null);
});
