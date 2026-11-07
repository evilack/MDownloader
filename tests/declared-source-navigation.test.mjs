import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {readFile as ReadFile} from 'node:fs/promises';
import {FindMedia} from '../extension/detection.js';
import {DiscoverDeclaredHls} from '../extension/lib/declared-streams.js';
import {NetworkCandidates, ObserveResponse} from '../extension/network.js';
Test('rediscovers a declared source after SPA navigation and excludes its stale performance entry', async T =>
{
	const Old = {url: 'https://cdn.test/Channel_A_auto.m3u8', name: 'Channel_A_auto.m3u8', format: 'M3U8',
		supported: true, documentId: 'same-spa-document', initiator: 'https://site.test', declaredPage: 'https://site.test/Channel_A'};
	let DiscoveryCalls = 0;
	globalThis.chrome = {
		runtime: {getURL: Path => 'https://extension.test/' + Path},
		permissions: {contains: async () => true},
		storage: {session: {get: async Key => ({[Key]: Key === 'network:7' ? [Old]: []})}},
		scripting: {executeScript: async ({world: World}) =>
			{
				if (World === 'MAIN')
				{
					DiscoveryCalls++;
					return [{documentId: 'same-spa-document', result: null}];
				}
				return [{documentId: 'same-spa-document', result: {page: 'https://site.test/Channel_B', sources: [],
							playlists: [[Old.url, 100]], timeOrigin: 100, observerReady: true, liveStream: true}}];
			}},
	};
	const OriginalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(await ReadFile(new URL('../extension/data/source-providers.json', import.meta.url), 'utf8'));
	T.after(() =>
	{
		delete globalThis.chrome;
		globalThis.fetch = OriginalFetch;
	});
	const Result = await FindMedia(7);
	Assert.equal(DiscoveryCalls, 1, 'Channel B must trigger its own source discovery');
	Assert.deepEqual(Result.items, [], 'Channel A must not reappear from resource timings');
});
Test('binds a successful late response even when the page moved before the body task returned', async T =>
{
	const Stored = {};
	const Page = 'https://site.test/Channel_A';
	const Url = 'https://cdn.test/Channel_A_auto.m3u8';
	globalThis.chrome = {
		runtime: {getURL: Path => 'https://extension.test/' + Path}, permissions: {contains: async () => true},
		storage: {session: {get: async Key => ({[Key]: Stored[Key]}), set: async Values =>
				{
					Object.assign(Stored, Values);
				}}},
		scripting: {executeScript: async ({args: [Task]}) =>
			{
				if (Task.mode === 'discover')
				{
					return [{documentId: 'spa', result: {url: Url}}];
				}
				await ObserveResponse({tabId: 8, frameId: 0, documentId: 'spa', initiator: 'https://site.test',
					method: 'GET', statusCode: 200, url: Url});
				// 본문 읽기 직전 SPA가 이동하면 페이지 작업은 본문을 반환하지 않습니다.
				return [{documentId: 'spa', result: null}];
			}},
	};
	const OriginalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(await ReadFile(new URL('../extension/data/source-providers.json', import.meta.url), 'utf8'));
	T.after(() =>
	{
		delete globalThis.chrome;
		globalThis.fetch = OriginalFetch;
	});
	await DiscoverDeclaredHls(8, 'spa', Page);
	Assert.equal((await NetworkCandidates(8, 'spa'))[0].declaredPage, Page);
});
Test('marks probe ownership when headers arrive while its body is still pending across navigation', async T =>
{
	const Stored = {};
	const Page = 'https://site.test/Channel_A';
	const Url = 'https://cdn.test/Channel_A_auto.m3u8';
	let ReleaseBody, SignalHeaders;
	const Body = new Promise(Resolve =>
	{
		ReleaseBody = Resolve;
	});
	const Headers = new Promise(Resolve =>
	{
		SignalHeaders = Resolve;
	});
	globalThis.chrome = {
		runtime: {getURL: Path => 'https://extension.test/' + Path}, permissions: {contains: async () => true},
		storage: {session: {get: async Key => ({[Key]: Stored[Key]}), set: async Values =>
				{
					Object.assign(Stored, Values);
				}}},
		scripting: {executeScript: async ({args: [Task]}) =>
			{
				if (Task.mode === 'discover')
				{
					return [{documentId: 'pending-spa', result: {url: Url}}];
				}
				await ObserveResponse({tabId: 18, frameId: 0, documentId: 'pending-spa', initiator: 'https://site.test',
					method: 'GET', statusCode: 200, url: Url});
				SignalHeaders();
				await Body;
				return [{documentId: 'pending-spa', result: null}];
			}},
	};
	const OriginalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(await ReadFile(new URL('../extension/data/source-providers.json', import.meta.url), 'utf8'));
	const Discovery = DiscoverDeclaredHls(18, 'pending-spa', Page);
	T.after(async () =>
	{
		ReleaseBody();
		await Discovery;
		delete globalThis.chrome;
		globalThis.fetch = OriginalFetch;
	});
	await Headers;
	Assert.equal((await NetworkCandidates(18, 'pending-spa'))[0].declaredPage, Page,
	'The response must be scoped before the body finishes or navigation can expose the wrong broadcast');
});
