import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import * as Naver from '../extension/lib/naver-clip.js';
import {Scan, ResolveCandidate, CandidatePreviews, PreviewCandidate, ReadCandidateThumbnail} from '../extension/detection.js';
import {RuntimePolicy} from '../extension/lib/runtime-policy.js';

const Id = '8FE4B3731735D2AB0B33346FF3FB11FE605A';
const OtherId = 'F2287CE0B471B4F4C9BDB816532E6763AFE4';
const Page = `https://m.naver.com/shorts/?seedMediaId=${Id}&serviceType=CLIP`;
const Url = Height => `https://b02-kr-smp-vod.pstatic.net/clip-home/${Id}/pd/${Height}.mp4?hdnts=a%2Bb%7Ec`;
function Metadata(MediaId = Id)
{
	return {header: {code: 0}, body: {card: {content: {mediaId: MediaId, description: '현재 클립', status: 'EXPOSURE',
		vod: {playable: true, type: 'PLAY_API_3_0', playback: {MPD: [{Period: [{AdaptationSet: [
			{'@mimeType': 'video/mp4', Representation: [1280, 640, 854].map(Height => ({'@id': 'PD_' + Height,
				'@width': String(Height === 854 ? 480 : Height * 9 / 16), '@height': String(Height),
				'@mimeType': 'video/mp4', '@codecs': 'avc1.4d401f,mp4a.40.2', BaseURL: [Url(Height)]}))},
			{Representation: [{'@id': 'hls', '@nvod:m3u': 'https://cdn.test/movie.m3u8', BaseURL: ['https://cdn.test/hls/']}]},
			{Representation: [{'@id': 'cmaf', BaseURL: ['https://cdn.test/part.m4v'], SegmentTemplate: [{}]}]},
		]}]}]}}}}}};
}

Test('identifies only supported Naver Clip pages and preserves the exact current media identity', () =>
{
	for (const Address of [Page, `https://clip.naver.com/contents?seedMediaId=${Id}&serviceType=CLIP`,
		`https://m.naver.com/shorts/?mediaId=${Id}&serviceType=CLIP`])
	{
		const Identity = Naver.IdentifyNaverClipPage(Address);
		Assert.equal(Identity.mediaId, Id);
		const Api = new URL(Identity.apiUrl);
		Assert.equal(Api.origin, 'https://creatorhub-api.naver.com');
		Assert.equal(Api.searchParams.get('seedMediaId'), Id);
	}
	for (const Address of ['https://m.naver.com/', Page.replace('m.naver.com', 'm.naver.com.evil.test'),
		Page.replace('https:', 'http:'), Page.replace('CLIP', 'OTHER'), Page.replace(Id, 'bad-id'),
		Page.replace('m.naver.com', 'user:password@m.naver.com'), Page + '&seedMediaId=' + OtherId])
		Assert.equal(Naver.IdentifyNaverClipPage(Address), null, Address);
});

Test('extracts complete MP4s for the current card, highest resolution first, without recommendations or fragments', () =>
{
	const Json = Metadata();
	Json.body.cards = [Metadata(OtherId).body.card];
	const Items = Naver.ParseNaverClip(Json, Id);
	Assert.deepEqual(Items.map(Item => Item.url), [Url(1280), Url(854), Url(640)]);
	Assert.deepEqual(Items.map(Item => Item.name), ['현재 클립_720x1280.mp4', '현재 클립_480x854.mp4', '현재 클립_360x640.mp4']);
	Assert.ok(Items.every(Item => Item.format === 'MP4' && Item.supported && Item.live === false));
	Assert.equal(Naver.ParseNaverClip(Json, OtherId).length, 0);
});

Test('rejects unavailable cards, invalid structures, unsafe URLs and segmented MP4 representations', () =>
{
	for (const Change of [
		Json => {Json.header.code = 500;}, Json => {Json.body.card.content.vod.playable = false;},
		Json => {Json.body.card.content.status = 'DELETED';}, Json => {Json.body.card.content.vod.playback.MPD = {};},
		Json => {Json.body.card.content.vod.type = 'OTHER';},
	]) {const Json = Metadata(); Change(Json); Assert.deepEqual(Naver.ParseNaverClip(Json, Id), []);}
	for (const Bad of ['https://evil.test/movie.mp4', 'http://b02-kr-smp-vod.pstatic.net/movie.mp4',
		'https://pstatic.net.evil.test/movie.mp4', 'https://user:pass@b02-kr-smp-vod.pstatic.net/movie.mp4',
		'https://b02-kr-smp-vod.pstatic.net/part.ts', 'blob:https://m.naver.com/a'])
	{
		const Json = Metadata();
		Json.body.card.content.vod.playback.MPD[0].Period[0].AdaptationSet[0].Representation.forEach(Rep => {Rep.BaseURL = [Bad];});
		Assert.deepEqual(Naver.ParseNaverClip(Json, Id), [], Bad);
	}
	const Json = Metadata();
	Json.body.card.content.vod.playback.MPD[0].Period[0].AdaptationSet[0].SegmentTemplate = [{}];
	Assert.deepEqual(Naver.ParseNaverClip(Json, Id), []);
	for (const Value of [null, {}, {body: null}, []]) Assert.deepEqual(Naver.ParseNaverClip(Value, Id), []);
});

function Setup(T, TabId = 910)
{
	const Data = {}, Reads = [];
	const Player = {currentSrc: 'blob:https://m.naver.com/current', readyState: 4, videoWidth: 720, videoHeight: 1280,
		closest: () => null, getBoundingClientRect: () => ({top: 10, left: 10, bottom: 510, right: 310, width: 300, height: 500})};
	const State = {players: [Player], page: Page, documentId: 'naver-' + TabId};
	globalThis.location = {get href() {return State.page;}};
	globalThis.document = {querySelectorAll: () => State.players, title: 'NAVER'};
	globalThis.window = {innerHeight: 768, innerWidth: 1280};
	T.mock.method(globalThis, 'fetch', async (Address, Options) =>
	{
		Reads.push({url: Address, options: Options});
		return new Response(JSON.stringify(Metadata()), {headers: {'content-type': 'application/json'}});
	});
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {
		session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values)},
		local: {get: async () => ({})}}, scripting: {executeScript: async ({func: Func, args: Args = []}) =>
		{
			if (Func.name === 'CollectVideos') return [{documentId: State.documentId,
				result: {page: State.page, sources: [Player.currentSrc], playlists: [], observerReady: true, opaquePlayer: true}}];
			if (Func.name === 'ReadNaverClipPage') return [{documentId: State.documentId, result: await Func(...Args)}];
			if (Func.name === 'ReadSelectedHls') return [{documentId: State.documentId, result: null}];
			if (Func.name === 'CollectPlayerPreviews') return [{documentId: State.documentId, result: []}];
			return [{documentId: State.documentId, result: {page: State.page, active: true, pageTitle: 'NAVER'}}];
		}}};
	T.after(() => {for (const Key of ['chrome', 'document', 'location', 'window']) delete globalThis[Key];});
	return {State, Player, Data, Reads, TabId};
}

Test('detects JSON-only playback through Scan and resolves its direct MP4 with no extra CDN permission', async T =>
{
	const {Reads, TabId, State} = Setup(T);
	const Result = await Scan(TabId);
	Assert.equal(Result.candidates?.length, 3);
	Assert.equal(Result.candidates[0].name, '현재 클립_720x1280.mp4');
	Assert.ok(Result.candidates.every(Item => Item.format === 'MP4' && !Item.serverPermission));
	const Resolved = await ResolveCandidate(TabId, Result.scanId, Result.candidates[0].id);
	Assert.equal(Resolved.url, Url(1280));
	Assert.equal(Reads.length, 1);
	Assert.equal(Reads[0].options.credentials, 'omit');
	State.page = Page.replace(Id, OtherId);
	await Assert.rejects(ResolveCandidate(TabId, Result.scanId, 0), /candidate_changed/);
});

Test('keeps each selected file resolution in thumbnail, hover and job previews even without a bound Blob frame', async T =>
{
	const {TabId} = Setup(T, 917);
	const Result = await Scan(TabId);
	const Expected = [{width: 720, height: 1280}, {width: 480, height: 854}, {width: 360, height: 640}];
	const Input = {tabId: TabId, scanId: Result.scanId, candidateIds: [0, 1, 2]};
	const Tiles = await CandidatePreviews(Input);
	Assert.deepEqual(Tiles.map(Item => Item.resolution), Expected);
	Assert.deepEqual(Tiles.map(Item => Item.id), [0, 1, 2]);
	for (const [Index, Resolution] of Expected.entries())
	{
		const Hover = await PreviewCandidate({...Input, candidateId: Index});
		Assert.deepEqual(Hover.resolution, Resolution);
		const Candidate = await ResolveCandidate(TabId, Result.scanId, Index);
		Assert.deepEqual((await ReadCandidateThumbnail(TabId, Candidate)).resolution, Resolution);
	}
	// A page may decode 720p while the selected download is 360p. The file's metadata takes precedence.
	const Execute = chrome.scripting.executeScript;
	T.mock.method(chrome.scripting, 'executeScript', async Options => Options.func.name === 'CollectPlayerPreviews'
		? [{documentId: 'naver-' + TabId, result: Options.args[0].map(Item => ({id: Item.id,
			still: 'data:image/jpeg;base64,page', duration: 78.8, resolution: Expected[0]}))}]
		: Execute(Options));
	const WithFrame = await CandidatePreviews(Input);
	Assert.deepEqual(WithFrame.map(Item => Item.resolution), Expected);
	Assert.ok(WithFrame.every(Item => Item.still && Item.duration === 78.8));
	Assert.deepEqual((await PreviewCandidate({...Input, candidateId: 2})).resolution, Expected[2]);
});

Test('reuses bounded metadata for repeated scans but revalidates the page, player and document', async T =>
{
	const {Reads, TabId, Player, State} = Setup(T, 911);
	Assert.equal((await Naver.DiscoverNaverClip(TabId, State.documentId, Page)).length, 3);
	Assert.equal((await Naver.DiscoverNaverClip(TabId, State.documentId, Page)).length, 3);
	Assert.equal(Reads.length, 1);
	State.players = [];
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
	State.players = [Player];
	State.documentId = 'new-document';
	Assert.equal((await Naver.DiscoverNaverClip(TabId, State.documentId, Page)).length, 3);
	Assert.equal(Reads.length, 2);
	State.page = Page.replace(Id, OtherId);
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
});

Test('does not borrow metadata from a changed page or player, multiple/hidden players or mismatching documents', async T =>
{
	const {State, TabId, Player, Reads} = Setup(T, 912);
	State.players = [Player, {...Player}];
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
	State.players = [{...Player, closest: () => ({})}];
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
	Assert.equal(Reads.length, 0);
	State.players = [Player];
	T.mock.method(globalThis, 'fetch', async () => {Player.currentSrc = 'blob:https://m.naver.com/replaced'; return new Response(JSON.stringify(Metadata()));});
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
	T.mock.method(globalThis, 'fetch', async () => {State.page = Page.replace(Id, OtherId); return new Response(JSON.stringify(Metadata()));});
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
	State.page = Page;
	T.mock.method(chrome.scripting, 'executeScript', async () => [{documentId: 'other-document', result: JSON.stringify(Metadata())}]);
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
});

Test('bounds metadata reads and handles forbidden, invalid JSON and failed requests without affecting other sites', async T =>
{
	const {TabId, State} = Setup(T, 913);
	let Index = 0;
	for (const ResponseValue of [new Response('Forbidden', {status: 403}), new Response('not json', {headers: {'content-type': 'application/json'}}),
		new Response(' '.repeat(1024 * 1024 + 1), {headers: {'content-type': 'application/json'}}),
		new Response(JSON.stringify(Metadata()), {headers: {'content-type': 'text/html'}})])
	{
		State.documentId = 'naver-failure-' + Index++;
		T.mock.method(globalThis, 'fetch', async () => ResponseValue);
		Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
	}
	State.documentId = 'naver-network-failure';
	T.mock.method(globalThis, 'fetch', async () => {throw new Error('network failure');});
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, 'https://example.test/video'), []);
});

Test('coalesces simultaneous scans, refreshes expired metadata and rejects cached results after access is revoked', async T =>
{
	const {TabId, State, Reads} = Setup(T, 914);
	const Results = await Promise.all([Naver.DiscoverNaverClip(TabId, State.documentId, Page), Naver.DiscoverNaverClip(TabId, State.documentId, Page)]);
	Assert.deepEqual(Results.map(Items => Items.length), [3, 3]);
	Assert.equal(Reads.length, 1);
	const Now = Date.now();
	T.mock.method(Date, 'now', () => Now + RuntimePolicy.Detection.MetadataRefreshMs + 1);
	Assert.equal((await Naver.DiscoverNaverClip(TabId, State.documentId, Page)).length, 3);
	Assert.equal(Reads.length, 2);
	T.mock.method(chrome.scripting, 'executeScript', async () => {throw new Error('Site access revoked');});
	Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
});

Test('backs off failed metadata reads while retrying a changed source and an expired attempt', async T =>
{
	const {TabId, State, Player} = Setup(T, 915);
	let Requests = 0;
	T.mock.method(globalThis, 'fetch', async () => {Requests++; return new Response('Forbidden', {status: 403});});
	for (let Index = 0; Index < 3; Index++) Assert.deepEqual(await Naver.DiscoverNaverClip(TabId, State.documentId, Page), []);
	Assert.equal(Requests, 1, 'popup/badge polling must not repeatedly hit an unavailable API');
	Player.currentSrc = 'blob:https://m.naver.com/new-source';
	await Naver.DiscoverNaverClip(TabId, State.documentId, Page);
	Assert.equal(Requests, 2);
	const Now = Date.now();
	T.mock.method(Date, 'now', () => Now + RuntimePolicy.Detection.MetadataRefreshMs + 1);
	await Naver.DiscoverNaverClip(TabId, State.documentId, Page);
	Assert.equal(Requests, 3);
});

Test('cancels oversized streamed JSON, checks advertised size and rejects source changes during body reads', async T =>
{
	const {Player} = Setup(T, 916);
	const Options = {...Naver.IdentifyNaverClipPage(Page), maxBytes: 32, timeoutMs: 1000, excludedSelector: '[hidden]'};
	for (const Advertised of [false, true])
	{
		let Canceled = false, Pulls = 0;
		const Body = new ReadableStream({pull(Controller) {Pulls++; Controller.enqueue(new Uint8Array(64));}, cancel() {Canceled = true;}});
		T.mock.method(globalThis, 'fetch', async () => new Response(Body,
			{headers: {'content-type': 'application/json', ...(Advertised ? {'content-length': '64'} : {})}}));
		const Result = await Naver.ReadNaverClipPage(Page, Options);
		Assert.ok(!Result?.text);
		Assert.equal(Canceled, true);
		Assert.ok(Pulls <= 2, 'the reader stops at the limit rather than buffering the response');
	}
	const Body = new ReadableStream({pull(Controller) {Player.currentSrc = 'blob:https://m.naver.com/changed'; Controller.enqueue(new Uint8Array(1)); Controller.close();}});
	T.mock.method(globalThis, 'fetch', async () => new Response(Body, {headers: {'content-type': 'application/json'}}));
	Assert.equal(await Naver.ReadNaverClipPage(Page, {...Options, maxBytes: 1024}), null);
});
