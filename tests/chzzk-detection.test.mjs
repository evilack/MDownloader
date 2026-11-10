import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {IsHlsFragmentUrl} from '../extension/lib/media.js';
import {ObserveResponse, ReadMediaContext, IsAuxiliaryMedia, NetworkCandidates} from '../extension/network.js';
import {FindMedia} from '../extension/detection.js';
import {ReadNativeHlsManifest} from '../extension/lib/native-hls-discovery.js';

const Page = 'https://chzzk.naver.com/live/de6a400d191c13b9523717896a7e4e2f';
const Directory = '/chzzk/lip2_kr/edge/broadcast/hdntl=exp=123~acl=*%2Fbroadcast%2F*~hmac=test/1080p/';
const Chunklist = 'broadcast_chunklist.m3u8';
const Part = '1080p_3722113587_1794190746212_2034_0_487_0.m4v';
const Segment = '1080p_3722113587_1794190746212_2034_0_487.m4v';
const Query = '?channel_id=22110281_llhls_h264_1080p_61532405&piece_id=487&partial_id=0&stream_id=1';

Test('recognizes CHZZK full and partial M4V segments beside their CDN and P2P chunklist', () =>
{
	for (const Origin of ['https://ex-nlive-streaming.navercdn.com', 'http://localhost:17080', 'http://127.0.0.1:17080'])
	{
		const Playlist = Origin + Directory + Chunklist + '?channel_id=live&stream_id=1&_HLS_msn=487';
		Assert.equal(IsHlsFragmentUrl(Playlist, Origin + Directory + Part + Query), true, Origin + ' partial');
		Assert.equal(IsHlsFragmentUrl(Playlist, Origin + Directory + Segment), true, Origin + ' complete segment');
	}
});

Test('keeps direct M4V files and unrelated origins, qualities and directories', () =>
{
	const Origin = 'http://localhost:17080', Playlist = Origin + Directory + Chunklist;
	for (const Resource of [
		Origin + Directory + 'trailer.m4v', Origin + Directory + '1080p_highlights.m4v',
		Origin + Directory + Part.replace('1080p_', '720p_'),
		Origin + Directory.replace('/broadcast/', '/another-broadcast/') + Part,
		'http://localhost:17081' + Directory + Part,
		'https://ex-nlive-streaming.navercdn.com' + Directory + Part,
	]) Assert.equal(IsHlsFragmentUrl(Playlist, Resource), false, Resource);
	Assert.equal(IsHlsFragmentUrl(Origin + '/movies/1080p/' + Chunklist, Origin + '/movies/1080p/' + Part), false);
	Assert.equal(IsHlsFragmentUrl(Origin + Directory + 'holiday.m3u8', Origin + Directory + Part), false);
});

Test('hides earlier P2P fragments and rejects new ones without suppressing direct files or another document', async T =>
{
	const Data = {}, TabId = 870, Origin = 'http://localhost:17080';
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {session: {
		get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values),
	}}};
	T.after(() => delete globalThis.chrome);
	const Request = {tabId: TabId, frameId: 0, documentId: 'chzzk', initiator: 'https://chzzk.naver.com', method: 'GET', statusCode: 200};
	const Response = (Url, Mime, Extra) => ObserveResponse({...Request, url: Url, responseHeaders: [{name: 'Content-Type', value: Mime}], ...Extra});
	const Early = Origin + Directory + Part + Query;
	const Late = Origin + Directory + Part.replace('_487_0.', '_487_1.') + Query.replace('partial_id=0', 'partial_id=1');
	const Direct = Origin + Directory + 'highlights.m4v';
	const Playlist = Origin + Directory + Chunklist + '?channel_id=live&stream_id=1';
	await Response(Early, 'video/x-m4v');
	await Response(Playlist, 'application/vnd.apple.mpegurl');
	await Response(Late, 'video/x-m4v');
	await Response(Direct, 'video/x-m4v');
	await Response(Early, 'video/x-m4v', {documentId: 'other-document'});
	const Context = await ReadMediaContext(TabId);
	const Visible = (await NetworkCandidates(TabId, 'chzzk')).filter(Item => !IsAuxiliaryMedia(Context, Item.url, Item.documentId));
	Assert.deepEqual(Visible.map(Item => Item.url).sort(), [Direct, Playlist].sort());
	Assert.equal(Data['network:' + TabId].some(Item => Item.url === Late), false, 'new partials must not fill the network cache');
	Assert.equal(IsAuxiliaryMedia(Context, Early, 'other-document'), false);
	Assert.equal(Visible.find(Item => Item.url === Playlist).url, Playlist, 'P2P parameters and transport stay intact');
});

function Player(Src = '')
{
	return {currentSrc: Src, src: '', closest: () => null, querySelectorAll: () => [], querySelector: () => null,
		hasAttribute: () => false, getAttribute: () => null};
}

Test('recovers the real HLS master with a Blob player plus an empty helper video', async T =>
{
	const TabId = 871, Origin = 'https://ex-nlive-streaming.navercdn.com';
	const Master = Origin + '/chzzk/lip2_kr/edge/broadcast/broadcast_playlist.m3u8?hdnts=a%2Bb';
	const Variant = Origin + Directory + Chunklist;
	const Data = {['network:' + TabId]: [Variant, Master].map(Url => ({url: Url, name: new URL(Url).pathname.split('/').at(-1),
		format: 'M3U8', supported: true, page: Page, documentId: 'chzzk-helper', initiator: 'https://chzzk.naver.com'}))};
	const Players = [Player('blob:https://chzzk.naver.com/broadcast'), Player()];
	const Entries = [Master, Variant].map(name => ({name, initiatorType: 'fetch', responseStatus: 200, startTime: 1}));
	const Document = {querySelectorAll: () => Players, querySelector: () => Players[0], title: 'CHZZK'};
	globalThis.location = {href: Page};
	globalThis.document = Document;
	globalThis.window = {document: Document, performance, length: 0};
	T.mock.method(performance, 'getEntriesByType', () => Entries);
	const Reads = [];
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Reads.push(Url);
		if (Url === Master) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8384000,RESOLUTION=1920x1080\n' + Variant + '\n');
		if (Url === Variant) return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:4.2,\n' + Segment + '\n');
		throw new Error('Unexpected fetch');
	});
	globalThis.chrome = {permissions: {contains: async () => true}, storage: {session: {
		get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values),
	}}, scripting: {executeScript: async ({func: Func, args: Args = []}) => [{documentId: 'chzzk-helper',
		result: ['CollectVideos', 'ReadNativeHlsManifest'].includes(Func.name) ? await Func(...Args) : null}]}};
	T.after(() => {for (const Key of ['chrome', 'window', 'document', 'location']) delete globalThis[Key];});
	const Found = await FindMedia(TabId);
	Assert.deepEqual(Found.items.map(Item => Item.url), [Master]);
	Assert.deepEqual(Found.items[0].qualities.map(Quality => Quality.resolution), ['1920x1080']);
	Assert.ok(Reads.includes(Master));
});

Test('reads an observed Blob playlist with an empty helper but still rejects two sourced players', async T =>
{
	const Address = 'http://localhost:17080' + Directory + Chunklist;
	let Players = [Player('blob:https://chzzk.naver.com/broadcast'), Player()];
	globalThis.location = {href: Page};
	globalThis.document = {querySelectorAll: () => Players};
	T.mock.method(performance, 'getEntriesByType', () => [{name: Address, initiatorType: 'fetch', responseStatus: 200}]);
	const Text = '#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:4.2,\n' + Segment + '\n';
	T.mock.method(globalThis, 'fetch', async () => new Response(Text));
	T.after(() => {delete globalThis.location; delete globalThis.document;});
	Assert.equal(await ReadNativeHlsManifest(Page, Address, 4096, 1000, {opaquePlayer: true}), Text);
	Players = [Players[0], Player('https://cdn.test/another.mp4')];
	Assert.equal(await ReadNativeHlsManifest(Page, Address, 4096, 1000, {opaquePlayer: true}), null);
});
