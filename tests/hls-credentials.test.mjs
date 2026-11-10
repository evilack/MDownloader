import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {FetchMedia} from '../extension/lib/hls-http.js';
import {ObserveRequest, ObserveResponse, NetworkCandidates} from '../extension/network.js';
import {HlsRequestSource} from '../extension/lib/hls-request-context.js';
import {KnownMasterDenial, StartHlsTrace, SaveTransferTrace} from '../extension/lib/hls-diagnostics.js';
import {HlsHttpError} from '../extension/lib/hls-http.js';

Test('a previous cookieless 403 cannot block the same playlist after cookie authentication is observed', async T =>
{
	const Stored = {};
	globalThis.chrome = {storage: {local: {get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values)}}};
	T.after(() => {delete globalThis.chrome;});
	const Url = 'https://delivery.test/master.m3u8';
	const Context = {origin: 'https://player.test', referer: 'https://player.test/', serverOrigin: 'https://delivery.test'};
	const Before = HlsRequestSource(Url, Context);
	const Trace = await StartHlsTrace(Before, 'previous-attempt', SaveTransferTrace);
	await Trace.begin('master-request');
	await Trace.fail(new HlsHttpError('stream_http_forbidden', 403));
	Assert.equal((await KnownMasterDenial(Before))?.status, 403);
	Assert.equal(await KnownMasterDenial(HlsRequestSource(Url, {...Context, includeCredentials: true})), undefined);
	Assert.equal((await KnownMasterDenial(Before))?.status, 403, 'the original denied request still retains its diagnostic');
});

Test('observed cookie authentication records only a boolean and survives a repeated response', async T =>
{
	const Stored = {};
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {session: {
		get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values),
	}}};
	T.after(() => {delete globalThis.chrome;});
	const Request = {tabId: 989, frameId: 0, documentId: 'cookie-doc', requestId: 'cookie-request',
		url: 'https://delivery.test/master.m3u8', initiator: 'https://player.test', method: 'GET'};
	const Headers = [{name: 'Origin', value: Request.initiator}, {name: 'Referer', value: Request.initiator + '/'}];
	const Response = {...Request, statusCode: 200, responseHeaders: [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}]};
	ObserveRequest({...Request, requestHeaders: Headers});
	await ObserveResponse(Response);
	ObserveRequest({...Request, requestHeaders: [...Headers, {name: 'Cookie', value: 'session=must-never-be-stored'}]});
	await ObserveResponse(Response);
	const [Item] = await NetworkCandidates(Request.tabId, Request.documentId);
	Assert.equal(Item.requestContext.includeCredentials, true);
	Assert.equal(JSON.stringify(Stored).includes('must-never-be-stored'), false);
});

Test('observed cookie credentials follow only their exact server origin, including key requests', async T =>
{
	const Context = {origin: 'https://player.test', referer: 'https://player.test/',
		serverOrigin: 'https://delivery.test', includeCredentials: true};
	const Seen = [];
	T.mock.method(globalThis, 'fetch', async (Url, Options) => {Seen.push(Options); return new Response(new Uint8Array(16));});
	const Signal = new AbortController().signal;
	for (const [Address, RequestContext] of [
		['https://delivery.test/key', Context],
		['https://asset.test/part.m4s', Context],
		['https://delivery.test/key', {...Context, includeCredentials: false}],
		['https://delivery.test/key', true],
		['https://delivery.test/key', false],
	]) await (await FetchMedia(Address, Signal, RequestContext, undefined, true)).body.cancel();
	Assert.deepEqual(Seen.map(Options => Options.credentials), ['include', 'omit', 'omit', 'omit', 'include']);
	Assert.ok(Seen.every(Options => Options.redirect === 'error' && Options.cache === 'no-store'));
});
