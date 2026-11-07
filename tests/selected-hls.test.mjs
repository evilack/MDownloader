import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Scan, FindMedia} from '../extension/detection.js';
import {RuntimePolicy} from '../extension/lib/runtime-policy.js';
import {HlsQualities} from '../extension/hls-jobs.js';
import {ReadSelectedHls, DiscoverSelectedHls} from '../extension/lib/selected-hls.js';
import {ObserveResponse} from '../extension/network.js';
Test('uses the explicitly selected worker master instead of unrelated historic rendition URLs, retaining other documents', async T =>
{
	const Page = 'https://player.test/live', Master = 'https://origin.test/live.m3u8', Doc = 'worker-doc';
	const Records = [Master, 'https://cdn.test/old-a.m3u8', 'https://cdn.test/old-b.m3u8'].map(Url => ({url: Url, name: new URL(Url).pathname.slice(1), format: 'M3U8', supported: true, page: Page, documentId: Doc, initiator: 'https://player.test'}));
	const Frame = {url: 'https://frame.test/movie.m3u8', name: 'movie.m3u8', format: 'M3U8', supported: true, documentId: 'child-doc', initiator: 'https://frame.test', frameId: 1, parentDocumentId: Doc};
	const Data = {'network:904': [...Records, Frame]};
	let bSelected = true;
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}, local: {get: async() => ({})}}, scripting: {executeScript: async({func: Func, target: Target}) =>
			{
				if (Target.frameIds)
				{
					return[{documentId: 'child-doc'}];
				}
				if (Func.name === 'CollectVideos')
				{
					return[{documentId: Doc, result: {page: Page, sources: [], playlists: [], opaquePlayer: true, observerReady: true}}];
				}
				if (Func.name === 'ReadSelectedHls')
				{
					return[{documentId: Doc, result: bSelected ? {url: Master, live: true, text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360\nhttps://cdn.test/new-a.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\nhttps://cdn.test/new-b.m3u8\n'}: null}];
				}
				return[{documentId: Doc, result: {page: Page, active: true, pageTitle: 'Live player'}}];
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Result = await Scan(904);
	Assert.deepEqual(Result.candidates.map(X => X.name), ['live.m3u8', 'movie.m3u8']);
	Assert.equal(Result.candidates[0].live, true, 'the selected player live state must reach the row badge');
	Assert.equal(Result.candidates[1].live, undefined, 'another document must not inherit the selected player state');
	Assert.equal(Data['network:904'].length, 4, 'unselected observations are retained for request evidence');
	Assert.equal((await HlsQualities({tabId: 904, scanId: Result.scanId, candidateId: 0})).length, 2);
	Data['network:904'][0].live = false;
	Assert.equal((await Scan(904)).candidates[0].live, false, 'a playlist that explicitly ended takes priority over stale player metadata');
	bSelected = false;
	Assert.equal((await Scan(904)).candidates.length, 4, 'no authoritative selection means no document-wide suppression');
});
Test('reports a live duration only for the selected bound player and never guesses from a finite VOD', async T =>
{
	const H = PlayerHarness(T), Options = {...H.options, readUrls: []};
	H.api.getDuration = () => Infinity;
	Assert.deepEqual(await ReadSelectedHls(H.page, Options), {url: H.url, live: true});
	H.api.getDuration = () => 634.634;
	Assert.deepEqual(await ReadSelectedHls(H.page, Options), {url: H.url});
	H.api.getDuration = () => NaN;
	Assert.deepEqual(await ReadSelectedHls(H.page, Options), {url: H.url});
});
function PlayerHarness(T)
{
	const Page = 'https://player.test/live', Url = 'https://origin.test/live.m3u8';
	const Player = {closest: () => null}, Other = {closest: () => null};
	let Path = Url, Players = [Player];
	const Api = {getHTMLVideoElement: () => Player, getPath: () => Path};
	Player.__reactFiberTest = {memoizedProps: {media: Api}};
	globalThis.location = {href: Page};
	globalThis.document = {querySelectorAll: () => Players};
	T.after(() =>
	{
		delete globalThis.location;
		delete globalThis.document;
	});
	return {page: Page, url: Url, api: Api, other: Other, options: {allowedUrls: [Url], readUrls: [Url], maxAncestors: 96, maxBytes: 256 * 1024, timeoutMs: 5000},
		path: Value =>
		{
			Path = Value;
		}, players: Value =>
		{
			Players = Value;
		}, player: Player};
}

Test('reads only a source explicitly bound to the sole media element', async T =>
{
	const H = PlayerHarness(T);
	let Requests = 0;
	T.mock.method(globalThis, 'fetch', async(_url, Options) =>
	{
		Requests++;
		Assert.equal(Options.cache, 'force-cache');
		return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n');
	});
	Assert.equal((await ReadSelectedHls(H.page, H.options)).url, H.url);
	H.api.getHTMLVideoElement = () => H.other;
	Assert.equal(await ReadSelectedHls(H.page, H.options), null);
	H.api.getHTMLVideoElement = () => H.player;
	H.path('https://other.test/unobserved.m3u8');
	Assert.deepEqual(await ReadSelectedHls(H.page, H.options), {url: 'https://other.test/unobserved.m3u8', bound: true});
	H.path(H.url);
	H.players([H.player, H.other]);
	Assert.equal(await ReadSelectedHls(H.page, H.options), null);
	Assert.equal(Requests, 1);
});
Test('bootstraps a bound selected master only after its real response is observed', async T =>
{
	const H = PlayerHarness(T), Doc = 'bootstrap-doc', TabId = 919, Data = {};
	let bSuccessful = true;
	H.options.allowedUrls = [];
	H.options.readUrls = [];
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}}, scripting: {executeScript: async({func: Func, args: Args}) =>
			{
				if (Func.name === 'CollectVideos')
				{
					return[{documentId: Doc, result: {page: H.page, sources: [], playlists: [], opaquePlayer: true, observerReady: true}}];
				}
				if (Func.name !== 'ReadSelectedHls')
				{
					return[{documentId: Doc, result: {page: H.page, active: true, pageTitle: 'Live channel'}}];
				}
				const Result = await Func(...Args);
				return[{documentId: Doc, result: Result}];
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		if (bSuccessful)
		{
			await ObserveResponse({tabId: TabId, documentId: Doc, frameId: 0, initiator: 'https://player.test', url: Url, method: 'GET', statusCode: 200, responseHeaders: [{name: 'content-type', value: 'application/vnd.apple.mpegurl'}]});
		}
		return new Response(bSuccessful ? '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:6,\npart.ts\n': 'denied', {status: bSuccessful ? 200: 403});
	});
	Assert.deepEqual(await ReadSelectedHls(H.page, H.options), {url: H.url, bound: true});
	Assert.equal((await DiscoverSelectedHls(TabId, Doc, H.page, []))?.url, H.url);
	Assert.equal(Data['network:' + TabId][0].live, true);
	Data['network:' + TabId] = ['old-a', 'old-b', 'old-master'].map(Name => ({url: 'https://origin.test/' + Name + '.m3u8', name: Name + '.m3u8', documentId: Doc, initiator: 'https://player.test', page: H.page, format: 'M3U8', supported: true}));
	const scan = await Scan(TabId);
	Assert.deepEqual(scan.candidates.map(Item => Item.name), ['live.m3u8'], 'three old observations must not survive a verified current selection');
	bSuccessful = false;
	delete Data['network:' + TabId];
	Assert.equal(await DiscoverSelectedHls(TabId, Doc, H.page, []), null, 'no successful response means no representative root');
});
Test('rejects a selected worker source that changes during a manifest read', async T =>
{
	const H = PlayerHarness(T);
	T.mock.method(globalThis, 'fetch', async() =>
	{
		H.path('https://origin.test/next.m3u8');
		return new Response('#EXTM3U\n');
	});
	Assert.equal(await ReadSelectedHls(H.page, H.options), null);
});
Test('bounds body reads and avoids another request for a known master', async T =>
{
	const H = PlayerHarness(T);
	let Requests = 0, bCanceled = false;
	T.mock.method(globalThis, 'fetch', async() =>
	{
		Requests++;
		return new Response(new ReadableStream({start(C)
			{
				C.enqueue(new Uint8Array(33));
			}, cancel()
			{
				bCanceled = true;
			}}));
	});
	Assert.deepEqual(await ReadSelectedHls(H.page, {...H.options, maxBytes: 32}), {url: H.url});
	Assert.equal(bCanceled, true);
	Assert.deepEqual(await ReadSelectedHls(H.page, {...H.options, readUrls: []}), {url: H.url});
	Assert.equal(Requests, 1);
});
Test('finds a page-owned hook source beside a hidden auxiliary video and renews it through an observed metadata URL', async T =>
{
	const H = PlayerHarness(T), Fresh = 'https://origin.test/live.m3u8?token=fresh', Metadata = 'https://player.test/api/public/channel/info';
	const Descriptor = {sourceField: 'playbackUrl', pageField: 'pageUrl', typeField: 'type', liveValue: 'livestream', metadataPathPattern: '^/api/public/channel/info$',
		refresh: {sourcePath: ['playback_url'], identityPath: ['slug'], livePath: ['stream', 'live'], streamIdPath: ['stream', 'id']}};
	H.player.__reactFiberTest = {memoizedState: {memoizedState: {playbackUrl: H.url, pageUrl: '/live', type: 'livestream'}, next: null}, memoizedProps: {}};
	H.player.closest = () => null;
	H.player.getBoundingClientRect = () => ({width: 640, height: 360});
	H.other.closest = () => ({});
	H.other.getBoundingClientRect = () => ({width: 0, height: 0});
	H.players([H.player, H.other]);
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Assert.equal(Url, Metadata);
		return new Response(JSON.stringify({slug: 'live', playback_url: Fresh, stream: {live: true, id: 'broadcast-1'}}));
	});
	const Options = {...H.options, excludedSelector: '[aria-hidden="true"]', maxHooks: 48, maxIdentityLength: 256, descriptor: Descriptor, metadataUrls: [Metadata]};
	const Result = await ReadSelectedHls(H.page, {...Options, readUrls: []});
	Assert.equal(Result.url, Fresh);
	Assert.equal(Result.live, true);
	Assert.equal(Result.sourceIdentity, 'broadcast-1');
	Assert.equal(Result.declared, true);
	H.player.__reactFiberTest.memoizedState.memoizedState.pageUrl = '/another';
	Assert.equal(await ReadSelectedHls(H.page, Options), null, 'an old SPA owner must not refresh another channel');
});
Test('inspects a linked worker player before grouping while retaining multi-player and preview guards', async T =>
{
	const H = PlayerHarness(T), Doc = 'linked-doc', TabId = 940;
	H.player.closest = Selector => Selector === RuntimePolicy.Detection.AuxiliaryPlayerSelector ? {}: null;
	Object.assign(H.player, {currentSrc: '', srcObject: {}, hasAttribute: () => false, querySelectorAll: () => []});
	globalThis.document.querySelector = () => H.player;
	globalThis.window = {document: globalThis.document, performance: {getEntriesByType: () => [], timeOrigin: 100}, length: 0};
	globalThis.MDownloaderMediaContext = true;
	const Data = {['network:' + TabId]: [H.url, 'https://origin.test/old-a.m3u8', 'https://origin.test/old-b.m3u8'].map(Url => ({url: Url, name: new URL(Url).pathname.slice(1), format: 'M3U8', supported: true, page: H.page, documentId: Doc, initiator: 'https://player.test'}))};
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)}}, scripting: {executeScript: async({func: Func, args: Args = []}) =>
			{
				return[{documentId: Doc, result: await Func(...Args)}];
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
		delete globalThis.window;
		delete globalThis.MDownloaderMediaContext;
		delete globalThis.MDownloaderMediaPage;
	});
	T.mock.method(globalThis, 'fetch', async() => new Response('denied', {status: 403}));
	Assert.equal((await FindMedia(TabId)).items.length, 1, 'a navigation link must not hide the bound source API');
	H.other.currentSrc = '';
	H.other.srcObject = {};
	H.other.hasAttribute = () => false;
	H.other.querySelectorAll = () => [];
	H.players([H.player, H.other]);
	Assert.equal((await FindMedia(TabId)).items.length, 3, 'two real players must not use a document-wide selected master');
	H.players([H.player]);
	globalThis.MDownloaderMediaPage = {previewOnly: true, players: new WeakMap()};
	Assert.equal((await FindMedia(TabId)).items.length, 0, 'an active preview-only scope must still be excluded');
});
