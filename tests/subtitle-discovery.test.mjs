import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import Vm from 'node:vm';
import {DiscoverSubtitles, ReadPageSubtitles} from '../extension/lib/subtitle-discovery.js';

const PageUrl = 'https://player.test/watch/one';
const MediaUrl = 'https://cdn.test/movie.mp4';
const Clone = Value => JSON.parse(JSON.stringify(Value));
function Track(Attributes = {})
{
	return {kind: 'subtitles', srclang: 'en', label: 'English', ...Attributes,
		getAttribute(Name) {return this[Name] ?? null;}};
}
function Player({url = MediaUrl, id = 'main', tracks = [], textTracks = [], hidden = false, card = false, wrapped = false} = {})
{
	return {id, currentSrc: url, src: url, hidden, textTracks, tagName: 'VIDEO',
		getAttribute(Name) {return this[Name] ?? null;},
		getBoundingClientRect() {return {width: 640, height: hidden ? 0 : 360};},
		closest(Selector) {return card && Selector.includes('[data-card]') || wrapped && /a\[href\]|article|\bli\b/.test(Selector) ? {} : null;},
		querySelectorAll(Selector) {return Selector.includes('track') ? tracks : [];},
		contains(Other) {return Other === this;}};
}
function Page({players = [Player()], scripts = [], page = PageUrl, options = {}} = {})
{
	const Context = Vm.createContext({URL, TextEncoder, location: {href: page},
		getComputedStyle: Element => ({display: Element.hidden ? 'none' : 'block', visibility: 'visible'}),
		document: {baseURI: page, scripts: scripts.map(Item => typeof Item === 'string' ? {textContent: Item, type: ''} : Item),
			querySelectorAll() {return players;},
			getElementById(Id) {return players.find(Item => Item.id === Id) ?? null;}}});
	Context.Options = {page: PageUrl, urls: [MediaUrl], ...options};
	return {context: Context, run: () => Clone(Vm.runInContext(`(${ReadPageSubtitles.toString()})(Options)`, Context))};
}

Test('discovers every language on the exact media owner and deduplicates resource/language', () =>
{
	const Subject = Page({players: [Player({tracks: [Track({src: '/en.vtt'}), Track({src: '/en.vtt'}),
		Track({src: '/ko.vtt', srclang: 'ko', label: '한국어'}), Track({kind: 'metadata', src: '/chapters.vtt'})]}),
		Player({url: 'https://cdn.test/other.mp4', tracks: [Track({src: '/unrelated.vtt'})]})]});
	Assert.deepEqual(Subject.run(), [
		{url: 'https://player.test/en.vtt', language: 'en', label: 'English', format: 'vtt'},
		{url: 'https://player.test/ko.vtt', language: 'ko', label: '한국어', format: 'vtt'},
	]);
});

Test('copies readable in-memory cues without changing track mode or selecting one language', () =>
{
	let ModeWrites = 0;
	const TextTrack = {kind: 'captions', language: 'fr', label: 'Français',
		cues: [{startTime: 1.25, endTime: 3, text: 'Bonjour'}],
		get mode() {return 'hidden';}, set mode(Value) {ModeWrites++;}};
	const Result = Page({players: [Player({textTracks: [TextTrack]})]}).run();
	Assert.equal(Result.length, 1);
	Assert.equal(Result[0].language, 'fr');
	Assert.match(Result[0].text, /00:00:01\.250 --> 00:00:03\.000\nBonjour/);
	Assert.equal(ModeWrites, 0);
});

Test('uses only the sole visible non-card opaque player and rejects ambiguity and hidden/cards', () =>
{
	const Main = Player({url: 'blob:https://player.test/one', tracks: [Track({src: '/main.vtt'})]});
	Assert.equal(Page({players: [Main]}).run().length, 1);
	Assert.deepEqual(Page({players: [Main, Player({url: 'blob:https://player.test/two'})]}).run(), []);
	Assert.deepEqual(Page({players: [Player({hidden: true, tracks: [Track({src: '/hidden.vtt'})]}),
		Player({card: true, tracks: [Track({src: '/card.vtt'})]})]}).run(), []);
	Assert.deepEqual(Page({players: [Player({url: 'https://cdn.test/other.mp4', tracks: [Track({src: '/wrong.vtt'})]})]}).run(), []);
});

Test('matches declared variants to their exact standard media owner', () =>
{
	const Subject = Page({players: [Player({url: 'https://cdn.test/high.mp4', tracks: [Track({src: '/variant.vtt'})]})],
		options: {urls: [MediaUrl, 'https://cdn.test/high.mp4']}});
	Assert.equal(Subject.run()[0].url, 'https://player.test/variant.vtt');
});

Test('matches the same HTTP source with a media fragment while retaining signed query distinctions', () =>
{
	Assert.equal(Page({players: [Player({url: MediaUrl + '#t=1', tracks: [Track({src: '/en.vtt'})]})]}).run().length, 1);
	Assert.deepEqual(Page({players: [Player({url: MediaUrl + '?token=other', tracks: [Track({src: '/en.vtt'})]})]}).run(), []);
});

Test('allows a link/article-wrapped main player while excluding tracked previews and stale SPA owners', () =>
{
	const Main = Player({wrapped: true, url: 'blob:https://player.test/main', tracks: [Track({src: '/en.vtt'})]});
	const Subject = Page({players: [Main]});
	Assert.equal(Subject.run().length, 1);
	Subject.context.MDownloaderMediaPage = {previewOnly: true};
	Assert.deepEqual(Subject.run(), []);
	Subject.context.MDownloaderMediaPage = {players: new Map([[Main, {page: PageUrl + '/old'}]])};
	Assert.deepEqual(Subject.run(), []);
});

Test('associates native MediaStream captions only by the candidate live track identity', () =>
{
	class MediaStream
	{
		getVideoTracks() {return [{id: 'live-track', readyState: 'live'}];}
	}
	const Main = Player({url: '', tracks: [Track({src: '/recording.vtt'})]});
	Main.srcObject = new MediaStream();
	const Subject = Page({players: [Main], options: {urls: ['webrtc:live-track'], trackId: 'live-track'}});
	Subject.context.MediaStream = MediaStream;
	Assert.equal(Subject.run()[0]?.url, 'https://player.test/recording.vtt');
	Subject.context.Options.trackId = 'other-track';
	Assert.deepEqual(Subject.run(), []);
});

Test('snapshots a selected native recording clock once and attaches it to every language descriptor', () =>
{
	class MediaStream {getVideoTracks() {return [{id: 'recording-track', readyState: 'live'}];}}
	const Main = Player({url: '', tracks: [Track({src: '/en.vtt'}), Track({src: '/ko.vtt', srclang: 'ko'})]});
	Main.srcObject = new MediaStream();
	let TimeReads = 0;
	Object.defineProperty(Main, 'currentTime', {get() {TimeReads++; return 120;}});
	Main.playbackRate = 1;
	Main.paused = false;
	const Subject = Page({players: [Main], options: {urls: [], trackId: 'recording-track', recording: true}});
	Subject.context.MediaStream = MediaStream;
	Subject.context.Date = {now: () => 1800000000123};
	const Result = Subject.run();
	Assert.equal(Result.length, 2);
	for (const Descriptor of Result)
		Assert.deepEqual(Descriptor.recordingClock, {time: 120, sampledAt: 1800000000123, rate: 1});
	Assert.equal(TimeReads, 1);
});

Test('reports an unsupported recording clock only when captions were found', () =>
{
	for (const Fields of [{currentTime: NaN, paused: false, playbackRate: 1},
		{currentTime: 120, paused: true, playbackRate: 1}, {currentTime: 120, paused: false, playbackRate: 2}])
	{
		const Main = Object.assign(Player({tracks: [Track({src: '/en.vtt'})]}), Fields);
		const Subject = Page({players: [Main], options: {recording: true, reportErrors: true}});
		Assert.deepEqual(Subject.run(), {error: 'subtitle_unsupported'});
	}
	Assert.deepEqual(Page({options: {recording: true}}).run(), []);
});

const ProviderScript = `var html5player = new HTML5Player('main', '42', {});
html5player.setVideoUrlHigh('https://cdn.test/movie.mp4');
if (typeof html5player.setSubtitles === 'function') { html5player.setSubtitles('en',
[{"l":"en","n":"English","f":"https://subs.test/en.vtt"},
{"l":"ko","n":"Korean","f":"https://subs.test/ko.vtt"}]); }`;

Test('reads only literal provider configuration owned by the selected player without executing scripts', () =>
{
	const Subject = Page({scripts: [ProviderScript + '; throw Error("must never execute");']});
	Assert.deepEqual(Subject.run().map(Item => Item.language), ['en', 'ko']);
	Assert.deepEqual(Page({scripts: [ProviderScript.replace("'main'", "'other'")]}).run(), []);
	Assert.deepEqual(Page({scripts: [ProviderScript.replace(MediaUrl, 'https://cdn.test/other.mp4')]}).run(), []);
	Assert.deepEqual(Page({scripts: ['/*' + ProviderScript + '*/']}).run(), []);
	Assert.deepEqual(Page({scripts: [ProviderScript.replace('[{"l"', 'build([{"l"').replace('}]);', '}]));')]}).run(), []);
});

Test('rejects page-level provider ambiguity on opaque players and ignores other provider instances', () =>
{
	const Blob = Player({url: 'blob:https://player.test/one'});
	Assert.equal(Page({players: [Blob], scripts: [ProviderScript]}).run().length, 2);
	const Extra = ProviderScript.replaceAll('html5player', 'otherplayer').replaceAll("'main'", "'other'")
		.replaceAll(MediaUrl, 'https://cdn.test/other.mp4').replaceAll('https://subs.test/', 'https://unrelated.test/');
	Assert.equal(Page({scripts: [ProviderScript + Extra]}).run().length, 2);
	Assert.deepEqual(Page({players: [Blob, Player({id: 'other', url: 'blob:https://player.test/two'})],
		scripts: [ProviderScript]}).run(), []);
});

Test('reads source-owned standard JSON track metadata but excludes an unrelated playlist item', () =>
{
	const Config = {playlist: [{file: MediaUrl, tracks: [{kind: 'captions', file: '/en.srt', label: 'English', srclang: 'en'}]},
		{file: 'https://cdn.test/other.mp4', tracks: [{kind: 'captions', file: '/wrong.vtt'}]}]};
	Assert.deepEqual(Page({scripts: [{type: 'application/json', textContent: JSON.stringify(Config)}]}).run(), [
		{url: 'https://player.test/en.srt', language: 'en', label: 'English', format: 'srt'}]);
});

Test('does not invent URLs for unreadable disabled tracks and rejects unsafe schemes', () =>
{
	const Result = Page({players: [Player({tracks: [Track({src: 'javascript:alert(1)'}), Track({src: 'data:text/vtt,WEBVTT'})],
		textTracks: [{kind: 'subtitles', language: 'en', mode: 'disabled', cues: null}]})]}).run();
	Assert.deepEqual(Result, []);
});

Test('fails explicitly on bounded subtitle metadata instead of dropping detected languages', () =>
{
	Assert.throws(() => Page({players: [Player({tracks: [Track({src: '/one.vtt'}), Track({src: '/two.vtt', srclang: 'ko'})]})],
		options: {maxDescriptors: 1}}).run(), /subtitle.*limit/i);
	Assert.throws(() => Page({scripts: [ProviderScript], options: {maxMetadataBytes: 10}}).run(), /subtitle.*limit/i);
});

Test('does not count unrelated large application scripts or JSON as subtitle metadata', () =>
{
	const Bootstrap = 'x'.repeat(5 * 1024 * 1024);
	Assert.deepEqual(Page({scripts: [`window.bootstrap = ${JSON.stringify(Bootstrap)};`,
		{type: 'application/json', textContent: JSON.stringify({bootstrap: Bootstrap})}]}).run(), []);
	Assert.throws(() => Page({scripts: [ProviderScript.replace('"English"', JSON.stringify(Bootstrap))]}).run(), /subtitle.*limit/i);
});

Test('rejects navigation both before reading and during DOM reads', () =>
{
	Assert.throws(() => Page({page: 'https://player.test/watch/two'}).run(), /navigat/i);
	const Main = Player({tracks: [Track({src: '/one.vtt'})]});
	const Subject = Page({players: [Main]});
	Main.querySelectorAll = () => {Subject.context.location.href = 'https://player.test/watch/two'; return [Track({src: '/one.vtt'})];};
	Assert.throws(() => Subject.run(), /navigat/i);
});

Test('injects into the candidate document and uses child previewPage and variant sources', async () =>
{
	const Calls = [];
	globalThis.chrome = {scripting: {async executeScript(Request)
	{
		Calls.push(Request);
		return [{documentId: 'child', result: Calls.length === 1
			? [{url: 'https://subs.test/en.vtt', language: 'en', label: 'English'}]
			: {page: 'https://embed.test/one'}}];
	}}};
	try
	{
		const Result = await DiscoverSubtitles(7, {url: MediaUrl, documentId: 'child', page: PageUrl,
			previewPage: 'https://embed.test/one', variants: ['https://cdn.test/high.mp4']});
		Assert.equal(Result.length, 1);
		Assert.deepEqual(Calls[0].target, {tabId: 7, documentIds: ['child']});
		Assert.ok(Calls.every(Call => Call.world === 'ISOLATED'));
		Assert.equal(Calls[0].args[0].page, 'https://embed.test/one');
		Assert.ok(Calls[0].args[0].urls.includes('https://cdn.test/high.mp4'));
	}
	finally {delete globalThis.chrome;}
});

Test('isolated discovery sees its stale playback ownership scope and forwards recording intent', async () =>
{
	const Main = Player({tracks: [Track({src: '/stale.vtt'})]});
	const Isolated = Page({players: [Main]});
	Isolated.context.MDownloaderMediaPage = {players: new WeakMap([[Main, {page: PageUrl + '/old'}]])};
	globalThis.chrome = {scripting: {async executeScript(Request)
	{
		Assert.equal(Request.world, 'ISOLATED');
		if (Request.func.name !== 'ReadPageSubtitles') return [{documentId: 'doc', result: {page: PageUrl}}];
		Assert.equal(Request.args[0].recording, true);
		Isolated.context.Options = Request.args[0];
		return [{documentId: 'doc', result: Isolated.run()}];
	}}};
	try {Assert.deepEqual(await DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl, documentId: 'doc', format: 'WEBRTC'}), []);}
	finally {delete globalThis.chrome;}
});

Test('recording clock failures reach the wrapper as localized unsupported errors', async () =>
{
	const Subject = Page({players: [Player({tracks: [Track({src: '/en.vtt'})]})]});
	globalThis.chrome = {scripting: {async executeScript(Request)
	{
		Subject.context.Options = Request.args[0];
		return [{documentId: 'doc', result: Subject.run()}];
	}}};
	try {await Assert.rejects(DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl, documentId: 'doc', format: 'WEBRTC'}), ErrorValue => ErrorValue.key === 'subtitle_unsupported');}
	finally {delete globalThis.chrome;}
});

Test('returns no captions for unsupported old script mocks but rejects a returned wrong document', async () =>
{
	globalThis.chrome = {scripting: {executeScript: async () => [{documentId: 'doc'}]}};
	try
	{
		Assert.deepEqual(await DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl, documentId: 'doc'}), []);
		chrome.scripting.executeScript = async () => [{documentId: 'other', result: [{url: '/en.vtt'}]}];
		await Assert.rejects(DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl, documentId: 'doc'}), ErrorValue => ErrorValue.key === 'subtitle_invalid');
	}
	finally {delete globalThis.chrome;}
});

Test('rejects a navigation observed after discovery', async () =>
{
	let Calls = 0;
	globalThis.chrome = {scripting: {executeScript: async () => [{documentId: 'doc', result: ++Calls === 1
		? [{url: 'https://subs.test/en.vtt'}] : {page: 'https://player.test/watch/two'}}]}};
	try {await Assert.rejects(DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl, documentId: 'doc'}), ErrorValue => ErrorValue.key === 'subtitle_invalid');}
	finally {delete globalThis.chrome;}
});

Test('binds a main-frame candidate without a saved document to the discovered document across same-URL reloads', async () =>
{
	let Calls = 0;
	globalThis.chrome = {scripting: {executeScript: async Request =>
	{
		Assert.deepEqual(Request.target, {tabId: 7, frameIds: [0]});
		return ++Calls === 1 ? [{documentId: 'before', result: [{url: 'https://subs.test/en.vtt'}]}]
			: [{documentId: 'after', result: {page: PageUrl}}];
	}}};
	try {await Assert.rejects(DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl}), ErrorValue => ErrorValue.key === 'subtitle_invalid');}
	finally {delete globalThis.chrome;}
});

Test('maps injected metadata failures to stable localized subtitle errors', async () =>
{
	globalThis.chrome = {scripting: {executeScript: async () => {throw new Error('Subtitle discovery metadata limit exceeded');}}};
	try
	{
		await Assert.rejects(DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl}), ErrorValue => ErrorValue.key === 'subtitle_limit');
		chrome.scripting.executeScript = async () => {throw new Error('Source page navigated');};
		await Assert.rejects(DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl}), ErrorValue => ErrorValue.key === 'subtitle_invalid');
	}
	finally {delete globalThis.chrome;}
});

Test('transports page validation failures as serializable results when Chrome does not propagate thrown errors', async () =>
{
	const Subject = Page({players: [Player({tracks: Array.from({length: 129}, (_, Index) => Track({src: `/sub-${Index}.vtt`}))})]});
	globalThis.chrome = {scripting: {async executeScript(Request)
	{
		Subject.context.Options = Request.args[0];
		let Result;
		try {Result = Subject.run();}
		catch { /* Chromium may report injection success without propagating a page exception. */ }
		return [{documentId: 'doc', result: Result}];
	}}};
	try {await Assert.rejects(DiscoverSubtitles(7, {page: PageUrl, url: MediaUrl, documentId: 'doc'}), ErrorValue => ErrorValue.key === 'subtitle_limit');}
	finally {delete globalThis.chrome;}
});

Test('real supplied HTML declares all 23 subtitle languages on the same HTML5Player',
	{skip: process.env.MDOWNLOADER_LIVE_SUBTITLES !== '1'}, async () =>
{
	const Url = 'https://www.xvideos2.com/video.opvuutv708c/road_trip_creampie_for_step_mom_-_brianna_beach_-_mom_comes_first_-_alex_adams';
	const Response = await fetch(Url, {signal: AbortSignal.timeout(20000)});
	Assert.equal(Response.status, 200);
	const Html = await Response.text();
	const Scripts = [...Html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(Match => Match[1]);
	const Result = Page({page: Url, players: [Player({id: 'html5video', url: 'blob:https://www.xvideos2.com/actual-player'})],
		scripts: Scripts, options: {page: Url, urls: ['https://cdn.test/selected-manifest.m3u8']}}).run();
	Assert.equal(Result.length, 23);
	Assert.deepEqual(Result.map(Item => Item.language), ['da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'ga', 'hu', 'it',
		'ja', 'lt', 'lv', 'mt', 'nl', 'no', 'pt', 'ro', 'sv', 'tr', 'vi-VN', 'zh']);
	Assert.ok(Result.every(Item => Item.url.startsWith('https://')));
});
