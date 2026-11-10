import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Vm from 'node:vm';
import {PagePolicy} from '../extension/lib/runtime-policy.js';

const Source = await readFile(new URL('../extension/media-context-page.js', import.meta.url), 'utf8');
const Page = 'https://rumble.com/v7i1odg-q-after-hours-ep.-43.html?e9s=src_v1_live';
const Master = 'https://rumble.com/live-hls-dvr/broadcast/playlist.m3u8?level=1';

function Subject({linked = false, roleLink = false, author = false, cover = false, nestedCover = false, nestedRoleLink = false, ad = false} = {})
{
	const Events = {}, Messages = [], Tasks = [];
	const Card = {isConnected: true, matches: () => false, contains: () => true,
		querySelector: Selector => Selector === 'a[href]' ? Link : cover || nestedCover ? {} : null,
		querySelectorAll: Selector => Selector === 'a[href]' ? [Link] : []};
	const Link = {isConnected: true, href: author ? 'https://rumble.com/c/BadlandsMedia' : 'https://rumble.com/another-video',
		matches: Selector => Selector === 'a[href]' || (Selector === '[rel~="author"]' && author),
		contains: Element => linked && Element === Player,
		closest: Selector => nestedCover || (nestedRoleLink && Selector !== PagePolicy.CardSelector) ? {}
			: roleLink && Selector === PagePolicy.CardSelector ? null : Card,
		querySelector: () => cover || nestedCover ? {} : null};
	class Media {}
	const Player = Object.assign(new Media(), {tagName: 'VIDEO', muted: true, controls: false, paused: false,
		currentSrc: 'blob:https://rumble.com/broadcast', src: '', srcObject: null,
		closest: Selector => Selector === PagePolicy.AdSlotSelector ? ad ? {} : null
			: Selector === 'a[href], [role="link"]' ? linked ? Link : roleLink ? Card : null : Card,
		matches: () => false, hasAttribute: () => false, querySelectorAll: () => []});
	const Document = {querySelectorAll: () => [Player], addEventListener: (Name, Callback) => {Events[Name] = Callback;}};
	const Context = Vm.createContext({document: Document, location: {href: Page}, HTMLMediaElement: Media,
		Element: Media, performance: {now: () => 100, timeOrigin: 1,
			getEntriesByType: () => [{name: Master, initiatorType: 'xmlhttprequest', startTime: 90}]},
		PerformanceObserver: class {observe() {}}, queueMicrotask: Task => Tasks.push(Task),
		chrome: {runtime: {sendMessage: async Message => {Messages.push(JSON.parse(JSON.stringify(Message)));}}},
		MDownloaderPagePolicy: PagePolicy, addEventListener() {}});
	Context.window = Context;
	Vm.runInContext(Source, Context);
	function Flush() {while (Tasks.length) Tasks.shift()();}
	Flush();
	return {messages: Messages, hover() {Events.pointerover({isTrusted: true, pointerType: 'mouse', target: Player});
		Events.playing({target: Player}); Flush();}};
}

Test('keeps an article main HLS player visible when its first link is the channel author', () =>
{
	const S = Subject({author: true}); S.hover();
	Assert.ok(S.messages.some(M => M.media.some(([Url, Role]) => Url === Master && Role === 'playback')));
	Assert.equal(S.messages.some(M => M.previewOnly === true), false);
	Assert.equal(S.messages.some(M => M.media.some(([, Role]) => Role === 'preview')), false);
});

Test('does not borrow a nested recommendation thumbnail or a text link to classify the article player', () =>
{
	for (const Options of [{nestedCover: true}, {}])
	{
		const S = Subject(Options); S.hover();
		Assert.ok(S.messages.some(M => M.media.some(([Url, Role]) => Url === Master && Role === 'playback')));
		Assert.equal(S.messages.some(M => M.previewOnly === true), false);
	}
});

Test('still hides a muted hovered preview owned by a linked cover or enclosing media link', () =>
{
	for (const Options of [{cover: true}, {linked: true, cover: true}])
	{
		const S = Subject(Options); S.hover();
		Assert.ok(S.messages.some(M => M.previewOnly === true));
		Assert.ok(S.messages.some(M => M.media.some(([Url, Role]) => Url === Master && Role === 'preview')));
		Assert.equal(S.messages.some(M => M.media.some(([, Role]) => Role === 'playback')), false);
	}
});

Test('keeps previews inside a role=link container auxiliary even without an article/list card', () =>
{
	const S = Subject({roleLink: true, cover: true}); S.hover();
	Assert.ok(S.messages.some(M => M.previewOnly === true));
	Assert.ok(S.messages.some(M => M.media.some(([Url, Role]) => Url === Master && Role === 'preview')));
	Assert.equal(S.messages.some(M => M.media.some(([, Role]) => Role === 'playback')), false);
});

Test('does not borrow the cover of a nested role=link recommendation inside the main article', () =>
{
	const S = Subject({nestedRoleLink: true, cover: true}); S.hover();
	Assert.ok(S.messages.some(M => M.media.some(([Url, Role]) => Url === Master && Role === 'playback')));
	Assert.equal(S.messages.some(M => M.previewOnly === true), false);
});

Test('retains the ad-slot role even when its containing article has an author link', () =>
{
	const S = Subject({author: true, ad: true}); S.hover();
	Assert.ok(S.messages.some(M => M.media.some(([Url, Role]) => Url === Master && Role === 'ad')));
	Assert.equal(S.messages.some(M => M.media.some(([, Role]) => Role === 'playback')), false);
});
