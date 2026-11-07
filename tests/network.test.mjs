import { test as Test } from 'node:test';
import Assert from 'node:assert/strict';
import * as Network from '../extension/network.js';
import { SetHlsRequestRules, ValidHlsRequestContext } from '../extension/lib/hls-request-context.js';
import { readFile as ReadFile } from 'node:fs/promises';
Test('recognizes direct and playlist responses while excluding segments and extension traffic', () =>
{
	const Response = {
		tabId: 2, frameId: 0, documentId: 'doc', initiator: 'https://page.test',
		url: 'https://cdn.test/asset?token=a%2Bb', method: 'GET', statusCode: 206,
		responseHeaders: [{ name: 'Content-Type', value: 'video/mp4; charset=binary' }],
	};
	Assert.equal(Network.ClassifyResponse(Response).name, 'asset.mp4');
	Assert.equal(Network.ClassifyResponse(Response).url, Response.url);
	const Hls = Network.ClassifyResponse({
		...Response, responseHeaders: [{ name: 'content-type', value: 'application/vnd.apple.mpegurl' }],
	});
	Assert.equal(Hls.format, 'M3U8');
	Assert.equal(Hls.supported, true);
	Assert.equal(Network.ClassifyResponse({ ...Response, url: 'https://cdn.test/1.m4s' }), null);
	Assert.equal(Network.ClassifyResponse({ ...Response, tabId: -1 }), null);
	Assert.equal(Network.ClassifyResponse({ ...Response, initiator: 'chrome-extension://ext' }), null);
	Assert.equal(Network.ClassifyResponse({ ...Response, statusCode: 404 }), null);
	Assert.equal(Network.ClassifyResponse({
		...Response, url: 'https://cdn.test/error.mp4',
		responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
	}), null);
});
Test('infers direct formats and DASH from the response and preserves compatible suffixes', () =>
{
	const Response = {
		tabId: 2, frameId: 0, documentId: 'doc', initiator: 'https://page.test', method: 'GET', statusCode: 200,
	};
	const Cases = [
		['video/quicktime', 'clip', 'clip.mov', 'MOV'],
		['video/x-matroska', 'clip', 'clip.mkv', 'MKV'],
		['video/matroska', 'clip.MKV', 'clip.MKV', 'MKV'],
		['video/mp4', 'clip.m4v', 'clip.m4v', 'M4V'],
		['audio/mpeg', 'track', 'track.mp3', 'MP3'],
		['audio/x-mp3', 'track', 'track.mp3', 'MP3'],
		['audio/mp4', 'track.m4a', 'track.m4a', 'M4A'],
		['application/ogg', 'track.opus', 'track.opus', 'OPUS'],
		['audio/webm', 'track', 'track.weba', 'WEBA'],
		['application/octet-stream', 'clip.avi', 'clip.avi', 'AVI'],
		['application/dash+xml', 'manifest', 'manifest.mpd', 'MPD'],
		['text/xml', 'manifest.mpd', 'manifest.mpd', 'MPD'],
	];
	for (const [Mime, Path, Name, Format] of Cases)
	{
		const Url = `https://cdn.test/${Path}?token=a%2Bb`;
		Assert.deepEqual(Network.ClassifyResponse({
			...Response, url: Url, responseHeaders: [{ name: 'Content-Type', value: Mime + '; charset=utf-8' }],
		}), { name: Name, format: Format, supported: true, url: Url }, Path + ' with ' + Mime);
	}
});
Test('does not promote fragment MIME types or misleading stream filenames to direct media', () =>
{
	const Response = {
		tabId: 2, frameId: 0, documentId: 'doc', initiator: 'https://page.test', method: 'GET', statusCode: 200,
	};
	for (const [Path, Mime] of [
		['chunk.m4s', 'video/mp4'], ['chunk.m4f', 'video/mp4'], ['chunk.ts', 'video/mp4'], ['chunk.aac', 'audio/mpeg'],
		['chunk', 'video/iso.segment'], ['chunk', 'video/mp2t'], ['chunk', 'audio/aac'],
		['chunk-stream0-00001.m4a', 'audio/mp4'], ['init-stream1.mp4', 'video/mp4'],
		['manifest.mpd', 'text/html'], ['metadata.xml', 'text/xml'],
	])
	{
		Assert.equal(Network.ClassifyResponse({
			...Response, url: `https://cdn.test/${Path}`, responseHeaders: [{ name: 'Content-Type', value: Mime }],
		}), null, Path + ' with ' + Mime);
	}
});
Test('deduplicates observations per document and stops exposing a revoked CDN', async T =>
{
	const Cached = {};
	const Allowed = new Set(['https://page.test/*', 'https://cdn.test/*']);
	let PermissionChecks = 0;
	globalThis.chrome = {
		permissions: { contains: async ({ origins: Origins }) =>
			{
				PermissionChecks++;
				return Origins.every(Origin => Allowed.has(Origin));
			} },
		storage: { session: {
				get: async Key => ({ [Key]: Cached[Key] }),
				set: async Values =>
				{
					Object.assign(Cached, Values);
				},
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Response = {
		tabId: 3, frameId: 0, documentId: 'original', initiator: 'https://page.test',
		url: 'https://cdn.test/clip.mp4', method: 'GET', statusCode: 200,
	};
	await Promise.all([Network.ObserveResponse(Response), Network.ObserveResponse(Response)]);
	const Candidates = await Network.NetworkCandidates(3, 'original');
	Assert.equal(Candidates.length, 1);
	await Network.ObserveResponse({ ...Response, url: 'https://cdn.test/clip-2.mp4' });
	PermissionChecks = 0;
	const SameOrigin = await Network.NetworkCandidates(3, 'original');
	Assert.deepEqual(SameOrigin.map(Item => Item.url), ['https://cdn.test/clip-2.mp4', Response.url]);
	Assert.equal(PermissionChecks, 1, 'one permission check covers the shared page and CDN');
	Assert.deepEqual(await Network.NetworkCandidates(3, 'next'), []);
	Allowed.delete('https://cdn.test/*');
	Assert.deepEqual(await Network.NetworkCandidates(3, 'original'), []);
	Assert.deepEqual(await Network.FilterAllowedNetworkCandidates(Candidates, 3, 'original'), []);
});
Test('updates a tab when its player frame loads a different playlist', async T =>
{
	const Stored = {};
	let PlayerDocument = 'first-player';
	globalThis.chrome = {
		permissions: { contains: async () => true },
		scripting: { executeScript: async ({ target: Target }) =>
			{
				Assert.deepEqual(Target, { tabId: 9, frameIds: [4] });
				return PlayerDocument ? [{ documentId: PlayerDocument }] : [];
			} },
		storage: { session: {
				get: async Key => ({ [Key]: Stored[Key] }),
				set: async Values =>
				{
					Object.assign(Stored, Values);
				},
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Response = {
		tabId: 9, frameId: 4, parentFrameId: 0, parentDocumentId: 'page', documentLifecycle: 'active',
		initiator: 'https://page.test', method: 'GET', statusCode: 200,
	};
	const First = 'https://cdn.test/first.m3u8';
	const Second = 'https://cdn.test/second.m3u8';
	await Network.ObserveResponse({ ...Response, documentId: PlayerDocument, url: First });
	Assert.deepEqual((await Network.NetworkCandidates(9, 'page')).map(Item => Item.url), [First]);
	PlayerDocument = 'second-player';
	await Network.ObserveResponse({ ...Response, documentId: PlayerDocument, url: Second });
	const Items = await Network.NetworkCandidates(9, 'page');
	Assert.deepEqual(Items.map(Item => Item.url), [Second]);
	Assert.deepEqual(await Network.NetworkCandidates(9, 'unrelated-page'), []);
	PlayerDocument = undefined;
	Assert.deepEqual(await Network.FilterAllowedNetworkCandidates(Items, 9, 'page'), []);
});
Test('retains observed live metadata and clears it when the same playlist ends', async T =>
{
	const Stored = {};
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {session: {
				get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values),
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Url = 'https://cdn.test/live.m3u8', Origin = 'https://page.test';
	const Response = {tabId: 51, frameId: 0, documentId: 'doc', initiator: Origin, method: 'GET', statusCode: 200, url: Url};
	const Sender = {tab: {id: 51}, frameId: 0, documentId: 'doc', origin: Origin};
	const Text = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nclip.ts';
	await Network.ObserveResponse(Response);
	await Network.ObserveManifest(Sender, {url: Url, text: Text});
	Assert.equal((await Network.NetworkCandidates(51, 'doc'))[0].live, true);
	await Network.ObserveResponse(Response);
	Assert.equal((await Network.NetworkCandidates(51, 'doc'))[0].live, true);
	await Network.ObserveManifest(Sender, {url: Url, text: Text + '\n#EXT-X-ENDLIST'});
	Assert.equal((await Network.NetworkCandidates(51, 'doc'))[0].live, false);
});
Test('keeps the starting page of a late HTTP response across same-document navigation', async T =>
{
	const Stored = {};
	globalThis.chrome = {tabs: {get: async() => ({url: 'https://page.test/A'})}, permissions: {contains: async() => true},
		storage: {session: {get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values)}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Details = {tabId: 41, requestId: 'late-A', frameId: 0, documentId: 'spa', initiator: 'https://page.test',
		method: 'GET', statusCode: 200, url: 'https://cdn.test/a.m3u8'};
	Network.ObservePageUrl(41, 'https://page.test/A');
	Network.ObserveRequestStart(Details);
	Network.ObservePageUrl(41, 'https://page.test/B');
	await Network.ObserveResponse(Details);
	const Items = await Network.NetworkCandidates(41, 'spa');
	Assert.equal(Items[0].page, 'https://page.test/A');
	Assert.deepEqual(await Network.FilterAllowedNetworkCandidates(Items, 41, 'spa', 'https://page.test/B'), []);
});
Test('binds declared sources to the discovered SPA page and preserves their binding on refresh', async T =>
{
	const Stored = {};
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {session: {
				get: async Key => ({[Key]: Stored[Key]}), set: async Values =>
				{
					Object.assign(Stored, Values);
				},
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Page = 'https://page.test/Channel_A';
	const Response = {tabId: 21, frameId: 0, documentId: 'spa', initiator: 'https://page.test',
		method: 'GET', statusCode: 200, url: 'https://cdn.test/live.m3u8'};
	await Network.ObserveResponse(Response);
	await Network.BindDeclaredSource(21, 'spa', Page, Response.url);
	await Network.ObserveResponse(Response);
	const Items = await Network.NetworkCandidates(21, 'spa');
	Assert.equal(Items[0].declaredPage, Page);
	Assert.equal((await Network.FilterAllowedNetworkCandidates(Items, 21, 'spa', Page)).length, 1);
	Assert.deepEqual(await Network.FilterAllowedNetworkCandidates(Items, 21, 'spa', 'https://page.test/Channel_B'), []);
	await Network.BindDeclaredSource(21, 'other-document', 'https://page.test/Channel_B', Response.url);
	Assert.equal((await Network.NetworkCandidates(21, 'spa'))[0].declaredPage, Page);
});
Test('keeps ordinary network observations available after a long sequence of card requests', async T =>
{
	const Stored = {};
	globalThis.chrome = {
		runtime: { id: 'test' },
		permissions: { contains: async () => true },
		storage: { session: {
				get: async Key => ({ [Key]: Stored[Key] }),
				set: async Values =>
				{
					Object.assign(Stored, Values);
				},
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Origin = 'https://page.test';
	const TabId = 3;
	const DocumentId = 'gallery';
	const Request = { tabId: TabId, frameId: 0, documentId: DocumentId, initiator: Origin, method: 'GET', statusCode: 200 };
	const Full = 'https://cdn.test/asset.mp4?purpose=selected';
	await Network.ObserveResponse({ ...Request, url: Full });
	const Sender = { id: 'test', url: Origin, tab: { id: TabId }, documentId: DocumentId };
	for (let Index = 0; Index < Network.MaxObservedMediaPerTab + 5; Index++)
	{
		const Url = 'https://cdn.test/asset.mp4?v=' + Index;
		await Network.ObserveMediaContext(Sender, { timeOrigin: 123, media: [[Url, 'preview']] });
		await Network.ObserveResponse({ ...Request, url: Url });
	}
	const Context = await Network.ReadMediaContext(TabId);
	const Candidates = await Network.NetworkCandidates(TabId, DocumentId);
	const Allowed = Candidates.filter(Item => !Network.IsAuxiliaryMedia(Context, Item.url, Item.documentId));
	Assert.deepEqual(Allowed.map(Item => Item.url), [Full]);
});
Test('pairs an observed master only with an allowed successful variant from the same document', async T =>
{
	const Stored = {};
	globalThis.chrome = {
		permissions: { contains: async () => true },
		storage: { session: {
				get: async Key => ({ [Key]: Stored[Key] }),
				set: async Values =>
				{
					Object.assign(Stored, Values);
				},
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Origin = 'https://en.xsz-av.com';
	const Master = Origin + '/media/video.m3u8';
	const Variant = 'https://xszcdn11.com/v11/195409_720p/v.m3u8';
	const Response = { tabId: 7, frameId: 0, documentId: 'current', initiator: Origin, method: 'GET', statusCode: 200 };
	await Network.ObserveResponse({ ...Response, requestId: 'master', url: Master });
	Network.ObserveRequest({ ...Response, requestId: 'variant', url: Variant, requestHeaders: [
			{ name: 'Referer', value: Origin + '/' }, { name: 'Origin', value: Origin }, { name: 'Cookie', value: 'private' },
		] });
	await Network.ObserveResponse({ ...Response, requestId: 'variant', url: Variant });
	await Network.ObserveManifest({ tab: { id: 7 }, frameId: 0, documentId: 'current', origin: Origin }, {
		url: Master, text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720\n' + Variant,
	});
	const Items = await Network.NetworkCandidates(7, 'current');
	Assert.deepEqual(Items.find(Item => Item.url === Master).variants, [Variant]);
	Assert.deepEqual(Items.find(Item => Item.url === Master).qualities, [
		{ url: Variant, bandwidth: 900000, resolution: '1280x720' },
	]);
	Assert.deepEqual(Items.find(Item => Item.url === Variant).requestContext, {
		serverOrigin: 'https://xszcdn11.com', origin: Origin, referer: Origin + '/',
	});
	Assert.equal(JSON.stringify(Stored).includes('private'), false);
	Assert.deepEqual(await Network.NetworkCandidates(7, 'next'), []);
	await Network.ObserveResponse({ ...Response, requestId: 'master', url: Master, responseHeaders: [
			{ name: 'Content-Type', value: 'application/dash+xml' },
		] });
	const UpdatedMaster = (await Network.NetworkCandidates(7, 'current')).find(Item => Item.url === Master);
	Assert.equal(UpdatedMaster.format, 'MPD');
	Assert.equal(UpdatedMaster.variants, undefined);
	Assert.equal(UpdatedMaster.qualities, undefined);
	Assert.equal(UpdatedMaster.documentId, 'current');
	Assert.equal(UpdatedMaster.initiator, Origin);
});
Test('limits observed headers to exact background GETs on each approved CDN', async T =>
{
	const Applied = [];
	const Owners = {};
	globalThis.chrome = {
		runtime: { id: 'mdownloader' },
		storage: { session: {get: async Key => ({[Key]: Owners[Key]}), set: async Values => Object.assign(Owners, Values)} },
		declarativeNetRequest: {
			getSessionRules: async () => [{ id: 3 }, { id: 40000 }],
			updateSessionRules: async Changes => Applied.push(Changes),
		},
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Contexts = [
		{ serverOrigin: 'https://xszcdn11.com', origin: 'https://en.xsz-av.com', referer: 'https://en.xsz-av.com/' },
		{ serverOrigin: 'https://v1.xsz2-cdn.com', origin: 'https://en.xsz-av.com', referer: 'https://en.xsz-av.com/' },
		{ serverOrigin: 'https://surrit.com', origin: 'https://missav123.com', referer: 'https://missav123.com/ko/watch' },
	];
	for (const Context of Contexts)
	{
		const { serverOrigin: ServerOrigin } = Context;
		const Address = ServerOrigin + '/stream/part.jpeg';
		await Assert.rejects(SetHlsRequestRules(Context, ['https://example.test/part.jpeg'], 'header-test'), { key: 'headers_url_outside_cdn' });
		Assert.deepEqual(Applied, []);
		await SetHlsRequestRules(Context, [Address, Address], 'header-test');
		const { addRules: AddRules, removeRuleIds: RemoveRuleIds } = Applied.shift();
		Assert.deepEqual(RemoveRuleIds, [40000]);
		Assert.equal(AddRules.length, 1);
		Assert.deepEqual(AddRules[0].condition, {
			urlFilter: '|' + Address + '|', isUrlFilterCaseSensitive: true,
			requestDomains: [new URL(ServerOrigin).hostname], initiatorDomains: ['mdownloader'],
			requestMethods: ['get'], resourceTypes: ['xmlhttprequest'],
		});
		Assert.deepEqual(AddRules[0].action.requestHeaders.map(Header => Header.header), ['Referer', 'Origin']);
	}
	const Invalid = [
		{ serverOrigin: 'https://surrit.com', origin: 'https://missav123.com', referer: 'https://other.test/' },
		{ serverOrigin: 'file://server', origin: 'https://missav123.com', referer: 'https://missav123.com/' },
		{ serverOrigin: 'https://surrit.com/path', origin: 'https://missav123.com', referer: 'https://missav123.com/' },
		{ serverOrigin: 'https://surrit.com', origin: 'https://user:password@missav123.com', referer: 'https://missav123.com/' },
		{ serverOrigin: 'https://surrit.com', origin: 'https://missav123.com', referer: 'https://user:password@missav123.com/' },
	];
	for (const Context of Invalid)
	{
		Assert.equal(ValidHlsRequestContext(Context), false);
		await Assert.rejects(SetHlsRequestRules(Context, ['https://surrit.com/v.m3u8']), { key: 'headers_reuse_denied' });
	}
	await SetHlsRequestRules();
	Assert.deepEqual(Applied, [{ addRules: [], removeRuleIds: [40000] }]);
});
Test('keeps unchanged HLS observations stable after Chrome reorders stored object properties', async T =>
{
	const Origin = 'https://player.test';
	const Url = 'https://cdn.test/master.m3u8';
	const Variant = 'https://cdn.test/480p/video.m3u8';
	const Cached = {
		'network:8': [{
				name: 'master.m3u8', format: 'M3U8', supported: true, url: Url, documentId: 'doc', initiator: Origin,
				requestContext: { origin: Origin, referer: Origin + '/watch', serverOrigin: 'https://cdn.test' },
				qualities: [{ bandwidth: 1000000, resolution: '854x480', url: Variant }], variants: [Variant],
			}],
	};
	let Writes = 0;
	globalThis.chrome = {
		permissions: { contains: async () => true },
		storage: { session: {
				get: async Key => ({ [Key]: Cached[Key] }),
				set: async Values =>
				{
					Writes++;
					Object.assign(Cached, Values);
				},
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Response = {
		tabId: 8, frameId: 0, documentId: 'doc', initiator: Origin, url: Url,
		requestId: 'repeat', method: 'GET', statusCode: 200,
	};
	Network.ObserveRequest({ ...Response, requestHeaders: [
			{ name: 'Origin', value: Origin }, { name: 'Referer', value: Origin + '/watch' },
		] });
	await Network.ObserveResponse(Response);
	await Network.ObserveManifest({ frameId: 0, documentId: 'doc', origin: Origin, tab: { id: 8 } }, {
		url: Url, text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\n' + Variant,
	});
	Assert.equal(Writes, 0, 'the same preview requests must not refresh and restart the hovering preview');
});
Test('filters linked live previews, collapses reload directives, and excludes their MP4 parts', async T =>
{
	const Cached = {};
	const Origin = 'https://catalog.test';
	const Page = Origin + '/browse';
	const Master = 'https://edge.test/live.m3u8?token=keep';
	const Media = 'https://media.test/quality.m3u8?token=keep';
	const Init = 'https://media.test/header.mp4';
	const Part = 'https://media.test/piece.mp4';
	const Hinted = 'https://media.test/next.mp4';
	globalThis.chrome = {
		runtime: { id: 'test' },
		permissions: { contains: async () => true },
		storage: { session: {
				get: async Key => ({ [Key]: Cached[Key] }),
				set: async Values =>
				{
					Object.assign(Cached, Values);
				},
			} },
		scripting: { executeScript: async () => [{ documentId: 'doc', result: {
						page: Page, timeOrigin: 123, sources: [], observerReady: true,
						playlists: [[Media + '&_HLS_msn=9&_HLS_part=2', 123], [Master, 123]],
					} }] },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Response = { tabId: 12, frameId: 0, documentId: 'doc', initiator: Origin, method: 'GET', statusCode: 200 };
	for (const Url of [Master, Media, Media + '&_HLS_msn=8&_HLS_part=0', Media + '&_HLS_msn=9&_HLS_part=2'])
	{
		await Network.ObserveResponse({ ...Response, url: Url });
	}
	const Sender = { id: 'test', url: Page, origin: Origin, frameId: 0, documentId: 'doc', tab: { id: 12 } };
	await Network.ObserveManifest(Sender, {
		url: Master, text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=426x240\n' + Media,
	});
	// 조각이 먼저 응답한 경우에도 뒤이어 받은 재생목록이 정확한 소유 관계를 알려 줍니다.
	await Network.ObserveResponse({ ...Response, url: Init });
	await Network.ObserveManifest(Sender, {
		url: Media + '&_HLS_msn=9&_HLS_part=2',
		text: '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MAP:URI="header.mp4"\n' +
		'#EXT-X-PART:DURATION=0.5,URI="piece.mp4"\n#EXT-X-PRELOAD-HINT:TYPE=PART,URI="next.mp4"\n' +
		'#EXTINF:2,\nwhole.mp4\n',
	});
	for (const Url of [Init, Part, Hinted])
	{
		await Network.ObserveResponse({ ...Response, url: Url });
	}
	Assert.deepEqual((await Network.NetworkCandidates(12, 'doc')).map(Item => Item.url).sort(), [Master, Media].sort());
	await Network.ObserveMediaContext(Sender, { timeOrigin: 123, media: [[Master, 'preview']] });
	const { FindMedia } = await import('../extension/detection.js');
	Assert.deepEqual((await FindMedia(12)).items, []);
	await Network.ObserveMediaContext(Sender, { timeOrigin: 123, media: [[Master, 'playback']] });
	Assert.deepEqual((await FindMedia(12)).items.map(Item => Item.url), [Master]);
	const Another = 'https://media.test/quality.m3u8?token=different';
	await Network.ObserveResponse({ ...Response, url: Another });
	Assert.ok((await FindMedia(12)).items.some(Item => Item.url === Another), 'signed tokens keep their identity');
});
Test('keeps a card request auxiliary when it completes after the pointer leaves', async T =>
{
	const Stored = {};
	const Page = 'https://gallery.test/';
	globalThis.chrome = {runtime: {id: 'test'}, tabs: {get: async() => ({url: Page})}, permissions: {contains: async() => true},
		storage: {session: {get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values)}},
		scripting: {executeScript: async() => [{documentId: 'gallery', result: {page: Page, observerReady: true, timeOrigin: 1, sources: [], playlists: []}}]}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Sender = {id: 'test', url: Page, origin: 'https://gallery.test', tab: {id: 61}, frameId: 0, documentId: 'gallery'};
	const Request = {tabId: 61, frameId: 0, documentId: 'gallery', initiator: Sender.origin, method: 'GET', statusCode: 200};
	await Network.ObserveResponse({...Request, url: 'https://cdn.test/independent.mp4'});
	await Network.ObserveMediaContext(Sender, {page: Page, timeOrigin: 1, media: [], previewOnly: true});
	Network.ObserveRequestStart({...Request, requestId: 'hover'});
	await Network.ObserveMediaContext(Sender, {page: Page, timeOrigin: 1, media: [], previewOnly: false});
	await Network.ObserveResponse({...Request, requestId: 'hover', url: 'https://cdn.test/card.m3u8'});
	Assert.deepEqual((await (await import('../extension/detection.js')).FindMedia(61)).items.map(I => I.url),
	['https://cdn.test/independent.mp4'], 'the finished card request must not flash after hover ends');
});
Test('keeps main media when durable scope-only preview requests overflow the auxiliary cache', async T =>
{
	const Stored = {}, Page = 'https://gallery.test/';
	globalThis.chrome = {runtime: {id: 'test'}, tabs: {get: async() => ({url: Page})}, permissions: {contains: async() => true},
		storage: {session: {get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values)}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Request = {tabId: 62, frameId: 0, documentId: 'gallery', initiator: 'https://gallery.test', method: 'GET', statusCode: 200};
	const Main = 'https://cdn.test/main.m3u8';
	await Network.ObserveResponse({...Request, url: Main});
	await Network.ObserveMediaContext({id: 'test', url: Page, tab: {id: 62}, frameId: 0, documentId: 'gallery'},
	{page: Page, timeOrigin: 1, media: [], previewOnly: true});
	for (let I = 0; I < Network.MaxObservedMediaPerTab + 8; I++)
	{
		const Current = {...Request, requestId: 'preview' + I, url: 'https://cdn.test/preview.m3u8?session=' + I};
		Network.ObserveRequestStart(Current);
		await Network.ObserveResponse(Current);
	}
	const Candidates = await Network.NetworkCandidates(62, 'gallery');
	Assert.ok(Candidates.some(Item => Item.url === Main), 'preview-only records must not consume the main-media quota');
	const Context = await Network.ReadMediaContext(62);
	Assert.deepEqual(Candidates.filter(Item => !Network.IsAuxiliaryMedia(Context, Item.url, Item.documentId)).map(Item => Item.url), [Main]);
});
Test('excludes worker-loaded HLS parts without a readable manifest and cleans earlier part observations', async T =>
{
	const Cached = {};
	const Origin = 'https://catalog.test';
	const Master = 'https://edge.test/master.m3u8';
	const Media = 'https://media.test/live/channel_240p.m3u8';
	globalThis.chrome = {
		runtime: { id: 'test' }, permissions: { contains: async () => true },
		storage: { session: { get: async Key => ({ [Key]: Cached[Key] }), set: async Values => Object.assign(Cached, Values) } },
		scripting: { executeScript: async () => [{ documentId: 'doc', result: {
						page: Origin, timeOrigin: 123, sources: [], observerReady: true, playlists: [],
					} }] },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Response = { tabId: 13, frameId: 0, documentId: 'doc', initiator: Origin, method: 'GET', statusCode: 200 };
	await Network.ObserveResponse({ ...Response, url: 'https://media.test/live/channel_240p_h264_1_key_part0.mp4' });
	for (const Url of [Master, Media + '?signature=keep'])
	{
		await Network.ObserveResponse({ ...Response, url: Url });
	}
	for (let I = 0; I < 20; I++)
	{
		await Network.ObserveResponse({ ...Response, url: Media + '?signature=keep&_HLS_msn=' + I + '&_HLS_part=0' });
		await Network.ObserveResponse({ ...Response, url: 'https://media.test/live/channel_240p_h264_' + I + '_key_part1.mp4' });
	}
	const Standalone = 'https://media.test/live/channel_240p_trailer.mp4';
	await Network.ObserveResponse({ ...Response, url: Standalone });
	const Sender = { id: 'test', url: Origin, origin: Origin, frameId: 0, documentId: 'doc', tab: { id: 13 } };
	await Network.ObserveManifest(Sender, { url: Master,
		text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n' + Media });
	await Network.ObserveMediaContext(Sender, { timeOrigin: 123, media: [[Master, 'preview']] });
	const { FindMedia } = await import('../extension/detection.js');
	Assert.deepEqual((await FindMedia(13)).items.map(Item => Item.url), [Standalone]);
	await Network.ObserveMediaContext(Sender, { timeOrigin: 123, media: [[Master, 'playback']] });
	Assert.deepEqual((await FindMedia(13)).items.map(Item => Item.url).sort(), [Standalone, Master].sort());
});
Test('retains only same-document broadcast metadata addresses and never exposes them as media', async T =>
{
	const Cached = {};
	const Provider = await ReadFile(new URL('../extension/data/source-providers.json', import.meta.url), 'utf8');
	globalThis.chrome = { runtime: { getURL: Path => 'https://extension.test/' + Path },
		permissions: { contains: async () => true }, storage: { session: {
				get: async Key => ({ [Key]: Cached[Key] }), set: async Values => Object.assign(Cached, Values),
				remove: async Keys =>
				{
					for (const Key of Keys)
					{
						delete Cached[Key];
					}
				},
			} } };
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	T.mock.method(globalThis, 'fetch', async () => new Response(Provider));
	const MetadataResponse = { tabId: 21, frameId: 0, documentId: 'doc', initiator: 'https://page.test', method: 'GET', statusCode: 200,
		responseHeaders: [{ name: 'Content-Type', value: 'application/json' }] };
	const Url = 'https://page.test/api/front/v2/broadcasts/345';
	await Network.ObserveResponse({ ...MetadataResponse, url: Url });
	await Network.ObserveResponse({ ...MetadataResponse, url: Url });
	await Network.ObserveResponse({ ...MetadataResponse, url: 'https://page.test/api/private/account' });
	await Network.ObserveResponse({ ...MetadataResponse, url: 'https://other.test/api/front/v2/broadcasts/999' });
	Assert.deepEqual(await Network.ReadSourceMetadataUrls(21, 'doc'), [Url]);
	Assert.deepEqual(await Network.ReadSourceMetadataUrls(21, 'other-document'), []);
	Assert.deepEqual(await Network.NetworkCandidates(21, 'doc'), []);
	Assert.deepEqual(Cached['source-metadata:21'], [{ documentId: 'doc', url: Url }]);
	await Network.ForgetNetwork(21);
	Assert.deepEqual(await Network.ReadSourceMetadataUrls(21, 'doc'), []);
});
