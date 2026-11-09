import Assert from 'node:assert/strict';
import { setImmediate as Settle } from 'node:timers/promises';
import { test as Test } from 'node:test';
Test('updates a per-tab badge from deduplicated media and ignores results overtaken by navigation', async T =>
{
	const Event = () => ({ addListener(Listener)
		{
			this.fire = Listener;
		} });
	const TabId = 7;
	const Page = 'https://media.test/watch';
	const Clip = 'https://media.test/clip.mp4';
	const Manifest = 'https://media.test/new.m3u8';
	const Teaser = 'https://media.test/clip-2.mp4';
	const Ad = 'https://media.test/clip-3.mp4';
	const CardStream = 'https://media.test/card.m3u8';
	const TimeOrigin = 100;
	const NetworkKey = 'network:' + TabId;
	const Observed = [{ url: Clip, supported: true, format: 'MP4', documentId: 'doc', initiator: new URL(Page).origin }];
	const Badges = new Map();
	const Saved = {};
	let Collections = 0;
	let GetFrame = async () => [{ documentId: 'doc', result: { page: Page, sources: [Clip, Clip], playlists: [] } }];
	globalThis.chrome = {
		action: {
			async setBadgeText({ tabId: TabId, text: Text })
			{
				Badges.set(TabId, Text);
			},
			async setBadgeBackgroundColor()
			{
			},
			async setBadgeTextColor()
			{
			},
		},
		runtime: { id: 'test', onConnect: Event(), onMessage: Event(), getURL: Path => 'chrome-extension://test/' + Path },
		permissions: { contains: async () => true, onRemoved: Event() },
		tabs: {
			get: async () => ({ url: Page, status: 'complete' }),
			onActivated: Event(), onUpdated: Event(), onRemoved: Event(),
		},
		webRequest: { onHeadersReceived: Event(), onBeforeRequest: Event() },
		downloads: { onChanged: Event() },
		scripting: { executeScript: async ({ target: Target, func: Func }) =>
			{
				if (Target.documentIds && Func.name !== 'CollectVideos')
				{
					return [{ result: { page: Page, active: true, pageTitle: 'Media' } }];
				}
				Collections++;
				return GetFrame();
			} },
		storage: { onChanged: Event(), session: {
				get: async Key => ({ [Key]: Key === NetworkKey ? Observed : Saved[Key] }),
				set: async Values => Object.assign(Saved, Values),
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await import('../extension/background.js');
	chrome.tabs.onUpdated.fire(TabId, { status: 'complete' });
	await Settle();
	Assert.equal(Badges.get(TabId), '1');
	Observed.push({ ...Observed[0], url: Manifest, format: 'M3U8' });
	chrome.storage.onChanged.fire({ [NetworkKey]: { newValue: Observed } }, 'session');
	await Settle();
	Assert.equal(Badges.get(TabId), '2');
	Assert.equal(Badges.size, 1);
	Collections = 0;
	const Result = await new Promise(Respond => chrome.runtime.onMessage.fire(
	{ type: 'scan', tabId: TabId }, { url: chrome.runtime.getURL('popup.html') }, Respond,
	));
	await Settle();
	Assert.equal(Result.data.candidates.length, 2);
	Assert.equal(Badges.get(TabId), '2');
	Assert.equal(Collections, 1, 'the popup and its badge should share the same discovery');
	const Scan = View => new Promise(Respond => chrome.runtime.onMessage.fire(
	{ type: 'scan', tabId: TabId }, { url: chrome.runtime.getURL(View + '.html') }, Respond,
	));
	const EvidenceKey = 'media-context:' + TabId;
	const Publish = async (DocumentId, Media, ReportedTimeOrigin = TimeOrigin) =>
	{
		chrome.runtime.onMessage.fire({ type: 'mdownloader-media-context', timeOrigin: ReportedTimeOrigin, media: Media }, {
			id: 'test', url: Page, tab: { id: TabId }, frameId: 0, documentId: DocumentId, documentLifecycle: 'active',
		});
		await Settle();
		chrome.storage.onChanged.fire({ [EvidenceKey]: { newValue: Saved[EvidenceKey] } }, 'session');
		await Settle();
	};
	Observed.push(...[Teaser, Ad, CardStream].map(Url => ({
		...Observed[0], url: Url, format: Url === CardStream ? 'M3U8' : 'MP4',
	})));
	GetFrame = async () => [{ documentId: 'doc', result: {
				page: Page, timeOrigin: TimeOrigin, sources: [Clip, Teaser + '#t=1', Ad], playlists: [[CardStream, TimeOrigin], [Manifest, TimeOrigin]],
			} }];
	await Publish('doc', [[Teaser, 'preview'], [Ad, 'ad'], [CardStream, 'preview']]);
	Assert.equal(Badges.get(TabId), '2');
	for (const View of ['popup', 'sidepanel'])
	{
		const ScanResult = await Scan(View);
		Assert.equal(ScanResult.data.candidates.length, 2, View);
	}

	await Publish('old-doc', [[Manifest, 'ad']], 99);
	Assert.equal(Badges.get(TabId), '2', 'another document cannot suppress the current player');
	const [CurrentFrame] = await GetFrame();
	CurrentFrame.result.sources[1] = Teaser;
	GetFrame = async () => [CurrentFrame];
	await Publish('doc', [[Teaser, 'playback']]);
	Assert.equal(Badges.get(TabId), '3', 'confirmed main playback can reuse the same media URL');
	Observed.splice(Observed.findIndex(Item => Item.url === Manifest), 1);
	const Fallback = (await Scan('popup')).data;
	const Playback = Fallback.candidates.find(Item => Item.format === 'M3U8');
	const Selected = await new Promise(Respond => chrome.runtime.onMessage.fire({
		type: 'candidateUrl', tabId: TabId, scanId: Fallback.scanId, candidateId: Playback.id,
	}, { url: chrome.runtime.getURL('popup.html') }, Respond));
	Assert.deepEqual(Selected, { ok: true, data: Manifest }, 'the main playlist can be resolved through playback timings alone');
	const { promise: PendingFrame, resolve: Resolve } = Promise.withResolvers();
	const PreviousFrame = await GetFrame();
	GetFrame = () => PendingFrame;
	chrome.tabs.onActivated.fire({ tabId: TabId });
	await Settle();
	chrome.tabs.onUpdated.fire(TabId, { status: 'loading' });
	await Settle();
	Assert.equal(Badges.get(TabId), '');
	Resolve(PreviousFrame);
	await Settle();
	Assert.equal(Badges.get(TabId), '');
});
