import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {FindMedia, Scan, ResolveCandidate} from '../extension/detection.js';
import {ReadBilibiliPage, ParseBilibiliProgressive} from '../extension/lib/bilibili.js';
import {RuntimePolicy} from '../extension/lib/runtime-policy.js';
const Page = 'https://www.bilibili.com/zh-Hans/video/BV1yS4q6mEan/?trackid=test&spm_id_from=test';
const Url = 'https://upos-sz-mirrorcosov.bilivideo.com/upgcxcode/32/60/43377626032/movie.mp4?token=a%2Bb';
const Metadata = () => ({code: 0, data: {quality: 64, format: 'mp4720', timelength: 793123,
	durl: [{order: 1, length: 793123, size: 81680891, url: Url}]}});

function Setup(T, TabId = 951)
{
	const Data = {}, Reads = [];
	const State = {page: Page, cid: 43377626032, bvid: 'BV1yS4q6mEan', p: 1,
		videoData: {bvid: 'BV1yS4q6mEan', title: '현재 영상', pages: [{page: 1, cid: 43377626032}]}};
	const Player = {currentSrc: 'blob:https://www.bilibili.com/current', readyState: 4};
	globalThis.location = {get href() {return State.page;}};
	globalThis.document = {querySelectorAll: () => [Player]};
	globalThis.__INITIAL_STATE__ = State;
	T.mock.method(globalThis, 'fetch', async (Address, Options) =>
	{
		Reads.push({url: Address, options: Options});
		return new Response(JSON.stringify(Metadata()), {headers: {'content-type': 'application/json'}});
	});
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {
		session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)},
		local: {get: async () => ({})}}, scripting: {executeScript: async ({func: Func, args: Args = []}) =>
		{
			if (Func.name === 'CollectVideos') return [{documentId: 'bili-doc', result: {
				page: State.page, sources: [Player.currentSrc], playlists: [], observerReady: true, opaquePlayer: true}}];
			if (Func.name === 'ReadBilibiliPage') return [{documentId: 'bili-doc', result: await Func(...Args)}];
			if (Func.name === 'ReadSelectedHls') return [{documentId: 'bili-doc', result: null}];
			if (Func.name === 'CollectPlayerPreviews') return [{documentId: 'bili-doc', result: []}];
			return [{documentId: 'bili-doc', result: {page: State.page, active: true, pageTitle: '현재 영상'}}];
		}}};
	T.after(() => {for (const Key of ['chrome', 'location', 'document', '__INITIAL_STATE__']) delete globalThis[Key];});
	return {State, Reads, TabId};
}

Test('Bilibili localized video with tracking parameters resolves to one complete audio/video MP4', async T =>
{
	const {TabId} = Setup(T);
	const Result = await Scan(TabId, 'bili-test');
	Assert.equal(Result.candidates?.length, 1);
	Assert.equal(Result.candidates[0].format, 'MP4');
	const Item = await ResolveCandidate(TabId, Result.scanId, 0, 'bili-test');
	Assert.equal(Item.url, Url);
	Assert.equal(Item.name, '현재 영상_720p.mp4');
	Assert.equal(Item.live, false);
	Assert.equal(Item.sourceIdentity, 'bilibili:BV1yS4q6mEan:43377626032:64');
});

Test('Bilibili lookup requests only the current video and part, preserving the logged-in playback session', async T =>
{
	const {State, TabId, Reads} = Setup(T, 952);
	State.page = 'https://www.bilibili.com/video/BV1yS4q6mEan/?p=2';
	State.p = 2; State.cid = 43377626033;
	State.videoData.pages.push({page: 2, cid: 43377626033});
	const Result = await FindMedia(TabId);
	Assert.equal(Result.items.length, 1);
	Assert.match(Result.items[0].sourceIdentity, /:43377626033:64$/);
	const Api = new URL(Reads[0].url);
	Assert.equal(Api.origin, 'https://api.bilibili.com');
	Assert.equal(Api.searchParams.get('bvid'), 'BV1yS4q6mEan');
	Assert.equal(Api.searchParams.get('cid'), '43377626033');
	Assert.equal(Api.searchParams.get('fnval'), '1');
	Assert.equal(Reads[0].options.credentials, 'include');
});

Test('Bilibili does not reuse old SPA video or part metadata or accept lookalike hosts', async T =>
{
	const {State, TabId, Reads} = Setup(T, 953);
	for (const Address of ['https://www.bilibili.com/video/BV1yS4q6mEan/?p=2',
		'https://www.bilibili.com/video/BV1xx411c7mD/', 'https://www.bilibili.com.evil.test/video/BV1yS4q6mEan/'])
	{
		State.page = Address;
		Assert.equal((await FindMedia(TabId)).items.length, 0);
	}
	Assert.equal(Reads.length, 0);
});

Test('Bilibili rejects split, preview, unavailable, unsafe and truncated progressive responses', async T =>
{
	const {TabId} = Setup(T, 954);
	for (const Change of [Json => {Json.code = -403;}, Json => {Json.data.is_preview = 1;},
		Json => {Json.data.durl.push({...Json.data.durl[0], order: 2});},
		Json => {Json.data.durl[0].length = 10000;}, Json => {Json.data.durl[0].url = 'https://bilivideo.com.evil.test/movie.mp4';},
		Json => {Json.data.durl[0].url = 'https://user:pass@cdn.bilivideo.com/movie.mp4';},
		Json => {Json.data.durl[0].url = 'https://cdn.bilivideo.com/track.m4s';}])
	{
		T.mock.method(globalThis, 'fetch', async () => {const Json = Metadata(); Change(Json);
			return new Response(JSON.stringify(Json), {headers: {'content-type': 'application/json'}});});
		Assert.equal((await FindMedia(TabId)).items.length, 0);
	}
});

Test('Bilibili drops a playback response when the current part changes during the request', async T =>
{
	const {State, TabId} = Setup(T, 955);
	T.mock.method(globalThis, 'fetch', async () => {State.cid++; return new Response(JSON.stringify(Metadata()),
		{headers: {'content-type': 'application/json'}});});
	Assert.equal((await FindMedia(TabId)).items.length, 0);
});

Test('Bilibili shares repeated scans, keeps document ownership, and rejects cached metadata for a changed player', async T =>
{
	const {TabId, Reads, State} = Setup(T, 956);
	const [First, Second] = await Promise.all([FindMedia(TabId), FindMedia(TabId)]);
	Assert.equal(First.items[0].documentId, 'bili-doc');
	Assert.deepEqual(Second.items, First.items);
	Assert.equal((await FindMedia(TabId)).items[0].documentId, 'bili-doc');
	Assert.equal(Reads.length, 1);
	State.cid++;
	Assert.equal((await FindMedia(TabId)).items.length, 0);
});

Test('Bilibili limits streamed and advertised metadata size and cancels oversized bodies', async T =>
{
	Setup(T, 957);
	const Options = {timeoutMs: 1000, maxBytes: 8, excludedSelector: RuntimePolicy.Detection.SourcePlayerSelector};
	for (const Headers of [{'content-type': 'application/json'}, {'content-type': 'application/json', 'content-length': '100'}])
	{
		let Canceled = false;
		const Body = new ReadableStream({pull(Controller) {Controller.enqueue(new Uint8Array(16));}, cancel() {Canceled = true;}});
		T.mock.method(globalThis, 'fetch', async () => new Response(Body, {headers: Headers}));
		Assert.equal(await ReadBilibiliPage(Page, {bvid: 'BV1yS4q6mEan', part: 1}, Options), null);
		Assert.equal(Canceled, true);
	}
});

Test('Bilibili ordinary mp4 responses remain supported when no explicit pixel height is declared', () =>
{
	const Json = Metadata(); Json.data.format = 'mp4'; Json.data.quality = 16;
	const [Item] = ParseBilibiliProgressive(Json, {bvid: 'BV1yS4q6mEan', cid: 43377626032});
	Assert.equal(Item.name, 'BV1yS4q6mEan.mp4');
	Assert.equal(Item.url, Url);
});

Test('Bilibili accepts its overseas Akamai delivery host without accepting other Akamai tenants', () =>
{
	const Json = Metadata();
	Json.data.durl[0].url = 'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/32/60/43377626032/movie.mp4?token=exact';
	Assert.equal(ParseBilibiliProgressive(Json, {bvid: 'BV1yS4q6mEan', cid: 43377626032})[0]?.url, Json.data.durl[0].url);
	Json.data.durl[0].url = 'https://other.akamaized.net/movie.mp4';
	Assert.deepEqual(ParseBilibiliProgressive(Json, {}), []);
});

Test('Bilibili refuses a saved download candidate after the current player part changes at the same URL', async T =>
{
	const {State, TabId} = Setup(T, 958);
	const Result = await Scan(TabId, 'bili-stale');
	Assert.equal(Result.candidates.length, 1);
	State.cid++;
	await Assert.rejects(ResolveCandidate(TabId, Result.scanId, 0, 'bili-stale'), Error);
});

Test('Bilibili selects the declared overseas backup to avoid referer-restricted domestic delivery', () =>
{
	const Json = Metadata();
	const Backup = 'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/32/60/43377626032/movie.mp4?signature=untouched%2B';
	Json.data.durl[0].backup_url = [Backup];
	Assert.equal(ParseBilibiliProgressive(Json, {bvid: 'BV1yS4q6mEan', cid: 43377626032})[0]?.url, Backup);
});
