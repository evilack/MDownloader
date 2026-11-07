import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile as ReadFile} from 'node:fs/promises';
import {DiscoverDeclaredHls} from '../extension/lib/declared-streams.js';
import {ObserveRequest, ObserveResponse} from '../extension/network.js';
import {Scan, ResolveCandidate} from '../extension/detection.js';
import {HlsQualities} from '../extension/hls-jobs.js';
import {Enqueue} from '../extension/jobs.js';
Test('offers every successful declared quality with its actual CDN context instead of only the highest probe', async T =>
{
	const Page = 'https://page.test/Channel', Origin = 'https://page.test', Doc = 'declared-qualities', Tab = 906;
	const Master = 'https://edge.test/master.m3u8', Variants = [1080, 720, 480].map(Height => ({url: `https://media.test/${Height}.m3u8`, height: Height}));
	const Manifest = '#EXTM3U\n' + Variants.map(V => `#EXT-X-STREAM-INF:BANDWIDTH=${V.height * 1000},RESOLUTION=${V.height * 16 / 9}x${V.height}\n${V.url}`).join('\n');
	const Cache = {}, Probed = [];
	let Inflight = 0, Peak = 0;
	const ItemData = () => new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\npart.ts\n');
	T.mock.method(globalThis, 'fetch', async Url => new Response(await ReadFile(new URL(Url), 'utf8')));
	globalThis.chrome = {runtime: {getURL: Path => new URL('../extension/' + Path, import.meta.url).href},
		permissions: {contains: async() => true}, storage: {session: {get: async Key => ({[Key]: Cache[Key]}), set: async Values => Object.assign(Cache, Values)}, local: {get: async() => ({})}},
		scripting: {executeScript: async({func: Func, args: Args}) =>
			{
				if (Func.name === 'DeclaredStreamPageTask')
				{
					const Options = Args[0];
					if (Options.mode === 'discover')
					{
						return[{documentId: Doc, result: {url: Master}}];
					}
					const Url = Options.url;
					Probed.push(Url);
					Inflight++;
					Peak = Math.max(Peak, Inflight);
					await new Promise(Resolve => setImmediate(Resolve));
					const Details = {tabId: Tab, documentId: Doc, frameId: 0, parentFrameId: -1, initiator: Origin, method: 'GET', requestId: Url, url: Url};
					ObserveRequest({...Details, requestHeaders: [{name: 'Origin', value: Origin}, {name: 'Referer', value: Page}]});
					await ObserveResponse({...Details, statusCode: 200, responseHeaders: [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}]});
					Inflight--;
					return[{documentId: Doc, result: {url: Url, text: Url === Master ? Manifest: await ItemData().text()}}];
				}
				if (Func.name === 'CollectVideos')
				{
					return[{documentId: Doc, result: {page: Page, sources: [], playlists: [], observerReady: true}}];
				}
				return[{documentId: Doc, result: {page: Page, active: true, pageTitle: 'Channel'}}];
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await DiscoverDeclaredHls(Tab, Doc, Page);
	const scan = await Scan(Tab);
	Assert.equal(scan.candidates.length, 1);
	const Input = {tabId: Tab, scanId: scan.scanId, candidateId: 0}, Qualities = await HlsQualities(Input);
	Assert.equal(Qualities.length, 3, 'all declared qualities must be available across the master/variant CDN boundary');
	const Item = await ResolveCandidate(Tab, scan.scanId, 0);
	Assert.deepEqual(Item.observedVariants.map(X => X.url), Variants.map(X => X.url));
	Assert.equal(Item.observedVariants.at(-1).requestContext.serverOrigin, 'https://media.test');
	Assert.equal(Item.observedVariants.at(-1).requestContext.referer, Page);
	Assert.deepEqual(new Set(Probed), new Set([Master, ...Variants.map(X => X.url)]));
	Assert.ok(Peak <= 2, 'metadata reads must have bounded concurrency');
	const Local = {};
	let Launched;
	chrome.storage.local = {get: async Keys => Keys === null ? {...Local}: Object.fromEntries((Array.isArray(Keys) ? Keys: [Keys]).map(Key => [Key, Local[Key]])), set: async Values => Object.assign(Local, Values)};
	chrome.runtime.getContexts = async() => [{}];
	chrome.runtime.sendMessage = async Message =>
	{
		if (Message.type === 'hlsRun')
		{
			Launched = Message.job;
		}
		return {ok: true};
	};
	Assert.deepEqual(await Enqueue({...Input, variantUrl: Variants.at(-1).url, requestId: crypto.randomUUID()}), {state: 'started'});
	Assert.equal(Launched.url, Variants.at(-1).url, 'the selected lower rendition reaches the independent transfer');
	Assert.equal(Launched.variantUrl, undefined);
	Assert.equal(Launched.requestContext.serverOrigin, 'https://media.test');
	Assert.equal(Launched.requestContext.referer, Page);
	Assert.equal(Object.entries(Local).find(([Key]) => Key.startsWith('job:'))[1].live, true, 'known live state is visible in the manager as soon as the job is registered');
});
