import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {ObserveRequest, ObserveResponse, NetworkCandidates} from '../extension/network.js';
import {SetScopedHlsRequestRules} from '../extension/lib/hls-request-context.js';
import {FetchMedia} from '../extension/lib/hls-http.js';

Test('retains actual request headers when a nonstandard URL is confirmed as HLS by its response', async T =>
{
	const Stored = {};
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {session: {
		get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values),
	}}};
	T.after(() => {delete globalThis.chrome;});
	const Request = {tabId: 1989, frameId: 0, documentId: 'nonstandard-hls', requestId: 'html-playlist',
		url: 'https://delivery.test/v/e/content/c.html?token=signed%2Bvalue', initiator: 'https://player.test', method: 'GET'};
	const Headers = [{name: 'Origin', value: Request.initiator}, {name: 'Referer', value: Request.initiator + '/'}];
	ObserveRequest({...Request, requestHeaders: Headers});
	await ObserveResponse({...Request, statusCode: 200,
		responseHeaders: [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}]});
	const [Item] = await NetworkCandidates(Request.tabId, Request.documentId);
	Assert.equal(Item.format, 'M3U8');
	Assert.deepEqual(Item.requestContext, {serverOrigin: 'https://delivery.test', origin: 'https://player.test', referer: 'https://player.test/'});
});

Test('reuses only successful resource CDN contexts from the same player document', async T =>
{
	const Stored = {}, Rules = [];
	globalThis.chrome = {runtime: {id: 'extension'}, permissions: {contains: async () => true}, storage: {session: {
		get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values),
	}}, declarativeNetRequest: {getSessionRules: async () => [], updateSessionRules: async Value => Rules.push(Value)}};
	T.after(() => {delete globalThis.chrome;});
	const Base = {tabId: 1998, frameId: 0, documentId: 'player-doc', initiator: 'https://player.test', method: 'GET'};
	async function Observe(Name, Url, Mime, Extra = {})
	{
		const Request = {...Base, requestId: Name, url: Url, ...Extra};
		ObserveRequest({...Request, requestHeaders: [{name:'Origin',value:Request.initiator}, {name:'Referer',value:Request.initiator+'/'}, {name:'Cookie',value:'never-store-this'}]});
		await ObserveResponse({...Request, statusCode: 200, responseHeaders: [{name:'Content-Type',value:Mime}], ...Extra});
	}
	await Observe('playlist', 'https://delivery.test/c.html', 'application/vnd.apple.mpegurl');
	await Observe('part', 'https://parts.test/index00000.gif', 'image/gif');
	await Observe('rejected', 'https://denied.test/index00000.gif', 'image/gif', {statusCode:403});
	await Observe('other-doc', 'https://other.test/index00000.gif', 'image/gif', {documentId:'other-doc'});
	await Observe('other-player', 'https://ad.test/index00000.gif', 'image/gif', {initiator:'https://ads.test'});
	const [Item] = await NetworkCandidates(Base.tabId, Base.documentId);
	Assert.deepEqual(Item.requestContext.resources, [{serverOrigin:'https://parts.test', origin:'https://player.test',referer:'https://player.test/',includeCredentials:true}]);
	Assert.equal(JSON.stringify(Stored).includes('never-store-this'), false);
	await SetScopedHlsRequestRules(Item.requestContext, ['https://delivery.test/key', 'https://parts.test/index00001.gif'], 'job');
	Assert.deepEqual(Rules.at(-1).addRules.map(Rule=>Rule.condition.urlFilter), ['|https://delivery.test/key|','|https://parts.test/index00001.gif|']);
	const Modes=[];
	T.mock.method(globalThis,'fetch',async (_Url,Options)=>{Modes.push(Options.credentials);return new Response(new Uint8Array(16));});
	for(const Url of ['https://parts.test/index00001.gif','https://unknown.test/part'])
		await(await FetchMedia(Url,new AbortController().signal,Item.requestContext)).body.cancel();
	Assert.deepEqual(Modes,['include','omit']);
});

Test('carries an origin-only Referer to explicitly authorized playlist resources without sharing credentials', async T =>
{
	const Stored={}, Updates=[];
	globalThis.chrome={runtime:{id:'extension'},storage:{session:{get:async K=>({[K]:Stored[K]}),set:async V=>Object.assign(Stored,V)}},
		declarativeNetRequest:{getSessionRules:async()=>[],updateSessionRules:async V=>Updates.push(V)}};
	T.after(()=>{delete globalThis.chrome;});
	const Context={origin:'https://player.test',referer:'https://player.test/',serverOrigin:'https://playlist.test',includeCredentials:true};
	await SetScopedHlsRequestRules(Context,['https://playlist.test/c.html','https://new-cdn.test/part.gif'],'job');
	Assert.deepEqual(Updates.at(-1).addRules.map(R=>R.condition.urlFilter),['|https://playlist.test/c.html|','|https://new-cdn.test/part.gif|']);
	Assert.deepEqual(Updates.at(-1).addRules[1].action.requestHeaders,[{header:'Referer',operation:'set',value:'https://player.test/'},{header:'Origin',operation:'set',value:'https://player.test'}]);
	await SetScopedHlsRequestRules({...Context,referer:'https://player.test/watch?private=token'},['https://new-cdn.test/part.gif'],'private');
	Assert.equal(Stored['hls-header-owners'].private,undefined,'a full page URL must not spread to an unobserved CDN');
});

Test('retains observed full Referer and cookie mode for fMP4 CDNs even when their response is a direct-media candidate',async T=>
{
	const Stored={},Updates=[];
	globalThis.chrome={runtime:{id:'extension'},permissions:{contains:async()=>true},storage:{session:{get:async K=>({[K]:Stored[K]}),set:async V=>Object.assign(Stored,V)}},
		declarativeNetRequest:{getSessionRules:async()=>[],updateSessionRules:async V=>Updates.push(V)}};
	T.after(()=>{delete globalThis.chrome;});
	const Referer='https://player.test/watch?session=private', Base={tabId:2020,frameId:0,documentId:'doc',initiator:'https://player.test',method:'GET'};
	for(const [Id,Url,Mime]of [['master','https://master.test/c.html','application/vnd.apple.mpegurl'],['init','https://parts.test/chunk','video/mp4']])
	{
		const Request={...Base,requestId:Id,url:Url};
		ObserveRequest({...Request,requestHeaders:[{name:'Origin',value:Base.initiator},{name:'Referer',value:Referer},{name:'Cookie',value:'private-cookie'}]});
		await ObserveResponse({...Request,statusCode:200,responseHeaders:[{name:'Content-Type',value:Mime}]});
	}
	const Item=(await NetworkCandidates(Base.tabId,'doc')).find(V=>V.format==='M3U8');
	Assert.deepEqual(Item.requestContext.resources,[{origin:Base.initiator,referer:Referer,serverOrigin:'https://parts.test',includeCredentials:true}]);
	await SetScopedHlsRequestRules(Item.requestContext,['https://parts.test/part','https://unknown.test/part'],'job');
	Assert.deepEqual(Updates.at(-1).addRules.map(R=>R.condition.urlFilter),['|https://parts.test/part|']);
	Assert.equal(JSON.stringify(Stored).includes('private-cookie'),false);
});

Test('does not attach captured headers to HTML, a different document, or a mismatched request origin', async T =>
{
	const Stored = {};
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {session: {
		get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values),
	}}};
	T.after(() => {delete globalThis.chrome;});
	for (const [Index, Mime, Document, Origin] of [
		[0, 'text/html', 'doc', 'https://player.test'],
		[1, 'application/vnd.apple.mpegurl', 'changed-doc', 'https://player.test'],
		[2, 'application/vnd.apple.mpegurl', 'doc', 'https://other.test'],
	])
	{
		const Request = {tabId: 1990 + Index, frameId: 0, documentId: 'doc', requestId: 'context-' + Index,
			url: 'https://delivery.test/resource', initiator: 'https://player.test', method: 'GET'};
		ObserveRequest({...Request, requestHeaders: [{name: 'Origin', value: Origin}, {name: 'Referer', value: Origin + '/'}]});
		await ObserveResponse({...Request, documentId: Document, statusCode: 200, responseHeaders: [{name: 'Content-Type', value: Mime}]});
		const Items = await NetworkCandidates(Request.tabId, Document);
		if (Index === 0) Assert.deepEqual(Items, []);
		else {Assert.equal(Items.length, 1); Assert.equal(Items[0].requestContext, undefined);}
	}
});
