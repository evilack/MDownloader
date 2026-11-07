import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setTimeout as Delay} from 'node:timers/promises';
import {ReadPagePreviewResource} from '../extension/lib/page-preview.js';
Test('aborts the source-document fetch as well as the caller when a thumbnail is disposed', async T =>
{
	let FetchSignal;
	const Started = Promise.withResolvers();
	globalThis.location = {origin: 'https://player.test', href: 'https://player.test/watch'};
	let CacheMode;
	T.mock.method(globalThis, 'fetch', async(_url, {signal: Signal, cache: Cache}) =>
	{
		CacheMode = Cache;
		FetchSignal = Signal;
		Started.resolve();
		return new Promise((_resolve, Reject) => Signal.addEventListener('abort', () => Reject(Signal.reason), {once: true}));
	});
	globalThis.chrome = {scripting: {executeScript: async({func: Func, args: Args}) => [{result: await Func(...Args)}]}};
	T.after(() =>
	{
		delete globalThis.chrome;
		delete globalThis.location;
		delete globalThis.MDownloaderPreviewRequests;
	});
	const Controller = new AbortController();
	const Pending = ReadPagePreviewResource({tabId: 1, documentId: 'doc', page: location.href, context: {
			origin: location.origin, referer: location.href, serverOrigin: 'https://cdn.test',
		}}, {url: 'https://cdn.test/part.ts'}, 1024, Controller.signal).catch(Error => Error.name);
	await Started.promise;
	Controller.abort();
	Assert.equal(await Promise.race([Pending, Delay(50, 'still waiting')]), 'AbortError');
	Assert.equal(FetchSignal.aborted, true, 'the request must stop inside the selected document');
	Assert.equal(CacheMode, 'no-store', 'live preview requests must not reuse an obsolete cached playlist');
});
