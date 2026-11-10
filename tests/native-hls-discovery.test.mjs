import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Scan} from '../extension/detection.js';
import {HlsQualities} from '../extension/hls-jobs.js';
import {DiscoverNativeHls, ReadNativeHlsManifest} from '../extension/lib/native-hls-discovery.js';
Test('native manifest recovery preserves the observed credential mode instead of replacing it with a cookieless request', async T =>
{
	const Page = 'https://player.test/cookies', Url = 'https://cdn.test/cookies.m3u8';
	globalThis.location = {href: Page};
	globalThis.document = {querySelectorAll: () => [{currentSrc: Url}]};
	T.after(() => {delete globalThis.location; delete globalThis.document;});
	T.mock.method(globalThis, 'fetch', async (Address, Options) => {
		Assert.equal(Options.credentials, 'include');
		return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST');
	});
	Assert.match(await ReadNativeHlsManifest(Page, Url, 1024, 1000, {includeCredentials: true}), /#EXTM3U/);
});
Test('an observed master owns its separately declared audio as well as video, without hiding independent audio', async T =>
{
	const Page = 'https://player.test/separate-audio', Master = 'https://cdn.test/master.m3u8';
	const Audio = 'https://cdn.test/audio.m3u8', Video = 'https://cdn.test/video.m3u8', Independent = 'https://cdn.test/independent.m3u8';
	const Data = {'network:890': [Audio, Video, Master, Independent].map(url => ({url, name: url.split('/').at(-1),
		format: 'M3U8', supported: true, page: Page, documentId: 'audio-doc', initiator: new URL(Page).origin}))};
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {
		session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}, local: {get: async () => ({})}},
		scripting: {executeScript: async ({func: Func}) => {
			if (Func.name === 'CollectVideos') return [{documentId: 'audio-doc', result: {page: Page, sources: [Master], playlists: [], observerReady: true}}];
			if (Func.name === 'ReadNativeHlsManifest') return [{documentId: 'audio-doc', result:
				'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Audio",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="a"\nvideo.m3u8\n'}];
			return [{documentId: 'audio-doc', result: {page: Page, active: true}}];
		}}};
	T.after(() => {delete globalThis.chrome;});
	const Result = await Scan(890);
	Assert.deepEqual(Result.candidates.map(C => C.name).sort(), ['independent.m3u8', 'master.m3u8']);
	const Qualities = await HlsQualities({tabId: 890, scanId: Result.scanId, candidateId: Result.candidates.find(C => C.name === 'master.m3u8').id});
	Assert.equal(Qualities[0].audioUrl, Audio);
});
Test('recovers a missed blob-player master and counts its observed renditions as one video', async T =>
{
	const Page = 'https://player.test/blob', Master = 'https://cdn.test/movie/hls.m3u8';
	const Low = 'https://cdn.test/movie/hls-480p.m3u8', High = 'https://cdn.test/movie/hls-1080p.m3u8';
	const Data = {'network:803': [High, Low, Master].map(Url => ({url: Url, name: Url.split('/').at(-1),
		format: 'M3U8', supported: true, page: Page, documentId: 'blob-doc', initiator: 'https://player.test'}))};
	const Reads = [];
	globalThis.location = {href: Page};
	const Player = {currentSrc: 'blob:https://player.test/video', closest: Selector => Selector.includes('article') ? {} : null};
	globalThis.document = {querySelectorAll: () => [Player]};
	T.mock.method(performance, 'getEntriesByType', () => [Master, Low, High].map((Url, Index) =>
		({name: Url, startTime: Index, initiatorType: 'xmlhttprequest', responseStatus: 0})));
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Reads.push(Url);
		return new Response(Url === Master
			? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=815104,RESOLUTION=854x480\nhls-480p.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3375104,RESOLUTION=1920x1080\nhls-1080p.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=475136,RESOLUTION=640x360\nhls-360p.m3u8\n'
			: '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n');
	});
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {
		session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}, local: {get: async() => ({})}},
		scripting: {executeScript: async({func: Func, args: Args}) =>
		{
			if (Func.name === 'CollectVideos') return [{documentId: 'blob-doc', result: {
				page: Page, sources: [Player.currentSrc], opaquePlayer: true, playlists: [], observerReady: true}}];
			if (Func.name === 'ReadNativeHlsManifest') return [{documentId: 'blob-doc', result: await Func(...Args)}];
			if (Func.name === 'ReadSelectedHls') return [{documentId: 'blob-doc', result: null}];
			return [{documentId: 'blob-doc', result: {page: Page, active: true}}];
		}}};
	T.after(() => {delete globalThis.chrome; delete globalThis.location; delete globalThis.document;});
	const Result = await Scan(803);
	Assert.equal(Result.candidates.length, 1, 'the missed master and two observed renditions are one video');
	Assert.equal(Result.candidates[0].name, 'hls.m3u8');
	const Qualities = await HlsQualities({tabId: 803, scanId: Result.scanId, candidateId: 0});
	Assert.deepEqual(Qualities.map(Item => Item.resolution), ['1920x1080', '854x480', '640x360']);
	Assert.ok(Reads.includes(Master), 'the master relationship comes from its actual response');
	Assert.ok(Reads.length <= 2, 'manifest recovery is bounded');
	Assert.equal((await Scan(803)).candidates.length, 1);
	Assert.equal(Reads.length, 2, 'known relationships need no repeated reads');
	const Separate = 'https://cdn.test/movie/another.m3u8';
	Data['network:803'].push({...Data['network:803'][0], url: Separate, name: 'another.m3u8'});
	const WithSeparate = await Scan(803);
	Assert.deepEqual(WithSeparate.candidates.map(Item => Item.name).sort(), ['another.m3u8', 'hls.m3u8'],
		'an unrelated observed playlist remains a separate video');
	Data['network:804'] = [High, Low, Master].map(Url => ({url: Url, name: Url.split('/').at(-1),
		format: 'M3U8', supported: true, page: Page, documentId: 'blob-doc', initiator: 'https://player.test'}));
	T.mock.method(globalThis, 'fetch', async() => new Response('Forbidden', {status: 403}));
	Assert.equal((await Scan(804)).candidates.length, 3, 'failed reads cannot justify merging distinct URLs');
});
Test('does not recover blob manifests without a current unambiguous player and matching request timing', async T =>
{
	const Page = 'https://player.test/guards', Url = 'https://cdn.test/master.m3u8';
	const Player = {currentSrc: 'blob:https://player.test/video', closest: () => null};
	let Players = [Player], Entries = [];
	globalThis.location = {href: Page};
	globalThis.document = {querySelectorAll: () => Players};
	T.mock.method(performance, 'getEntriesByType', () => Entries);
	T.mock.method(globalThis, 'fetch', () => Assert.fail('unrelated or stale resources must not be fetched'));
	T.after(() => {delete globalThis.location; delete globalThis.document; delete globalThis.MDownloaderMediaPage;});
	const Options = {opaquePlayer: true, excludedSelector: '[hidden]'};
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 1024, 1000, Options), null, 'no observed timing');
	Entries = [{name: Url, startTime: 5, initiatorType: 'fetch', responseStatus: 200}];
	Players = [Player, {...Player}];
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 1024, 1000, Options), null, 'multiple players');
	Players = [{...Player, closest: () => ({})}];
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 1024, 1000, Options), null, 'excluded preview player');
	Players = [Player];
	globalThis.MDownloaderMediaPage = {since: 10};
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 1024, 1000, Options), null, 'timing before SPA navigation');
	globalThis.MDownloaderMediaPage = {previewOnly: true};
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 1024, 1000, Options), null, 'preview-only document');
	globalThis.MDownloaderMediaPage = {players: new Map([[Player, {page: Page + '/old'}]])};
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 1024, 1000, Options), null, 'player belongs to the previous page');
});
Test('rejects a recovered manifest when its blob source changes during the read', async T =>
{
	const Page = 'https://player.test/source-change', Url = 'https://cdn.test/master.m3u8';
	const Player = {currentSrc: 'blob:https://player.test/first', closest: () => null};
	globalThis.location = {href: Page};
	globalThis.document = {querySelectorAll: () => [Player]};
	T.mock.method(performance, 'getEntriesByType', () => [{name: Url, initiatorType: 'fetch', responseStatus: 200}]);
	T.mock.method(globalThis, 'fetch', async() =>
	{
		Player.currentSrc = 'blob:https://player.test/second';
		return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nlow.m3u8\n');
	});
	T.after(() => {delete globalThis.location; delete globalThis.document;});
	Assert.equal(await ReadNativeHlsManifest(Page, Url, 1024, 1000, {opaquePlayer: true}), null);
});
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
