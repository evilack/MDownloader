import Assert from 'node:assert/strict';
import { createHash as CreateHash } from 'node:crypto';
import { test as Test } from 'node:test';
Test('a known master 403 is shown as an independent failed job without another request', async T =>
{
	const Url = 'https://player.test/video.m3u8';
	const Page = 'https://player.test/watch';
	const Scan = {
		scanId: 'scan', documentId: 'document', page: Page,
		candidates: [{ id: 0, url: Url, name: 'video.m3u8', format: 'M3U8', supported: true,
				documentId: 'document', initiator: 'https://player.test' }],
	};
	const Denied = {
		source: CreateHash('sha256').update(Url).digest('hex').slice(0, 16),
		events: [{ stage: 'master-request', result: 'http-error', status: 403, challenge: false }],
	};
	const Storage = Entries => ({
		async get(Key)
		{
			return { [Key]: Entries[Key] };
		},
		async set(Values)
		{
			Object.assign(Entries, Values);
		},
	});
	const Session = { 'scan:17': Scan };
	const Local = { 'hls-diagnostic:inspection': Denied };
	let OnMessage;
	const PassiveEvent = { addListener()
		{
		} };
	const RequestId = '52c7a2e9-709c-419e-87bd-d2aa04065e34';
	T.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
	globalThis.chrome = {
		runtime: {
			onConnect: PassiveEvent,
			getURL: Path => 'chrome-extension://test/' + Path,
			onMessage: { addListener(Listener)
				{
					OnMessage = Listener;
				} },
			sendMessage: async () => null,
		},
		debugger: {},
		webRequest: { onHeadersReceived: PassiveEvent, onBeforeRequest: PassiveEvent },
		downloads: { onChanged: PassiveEvent },
		permissions: { contains: async () => true, onRemoved: PassiveEvent },
		scripting: { executeScript: async () => [{ result: { page: Page, active: true } }] },
		storage: { local: Storage(Local), session: Storage(Session), onChanged: PassiveEvent },
		tabs: { onRemoved: PassiveEvent, onUpdated: PassiveEvent, onActivated: PassiveEvent },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await import('../extension/background.js');
	const Send = Message => new Promise(Resolve => OnMessage({
		tabId: 17, scanId: 'scan', candidateId: 0, ...Message,
	}, { url: chrome.runtime.getURL('popup.html') }, Resolve));
	Assert.deepEqual(await Send({ type: 'enqueue', requestId: RequestId }), { ok: true, data: { state: 'failed' } });
	const Job = Local['job:' + RequestId];
	Assert.match(Job.filename, /^player_test_video_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/);
	Assert.equal(Job.state, 'failed');
	Assert.equal(Job.finished, 0);
	Assert.equal(Job.diagnostic.stage, 'master-request');
	Assert.equal(Job.diagnostic.status, 403);
	Assert.equal(Job.diagnostic.fromPreviousAttempt, true);
	Assert.equal(Job.tabId, undefined);
	Assert.equal(fetch.mock.callCount(), 0);
	const Cdn = 'https://xszcdn11.com';
	const Origin = 'https://en.xsz-av.com';
	const RequestContext = { serverOrigin: Cdn, origin: Origin, referer: Origin + '/' };
	const Qualities = [1080, 720, 480].map(Height => ({
		url: Cdn + '/' + Height + '.m3u8', resolution: Height * 16 / 9 + 'x' + Height, bandwidth: Height * 1000,
	}));
	Scan.candidates[0].qualities = Qualities;
	Scan.candidates[0].observedVariants = Qualities.slice(0, 2).map(Quality => ({
		...Quality, documentId: 'document', initiator: Origin, requestContext: RequestContext,
	}));
	chrome.runtime.getContexts = async () => [{}];
	let Launched;
	chrome.runtime.sendMessage = async Message =>
	{
		Launched = Message;
		return { ok: true };
	};
	const Preview = await Send({ type: 'hlsQualities' });
	Assert.equal(Preview.ok, true);
	Assert.deepEqual(Preview.data.map(Quality => Quality.url), Qualities.slice(0, 2).map(Quality => Quality.url));
	Assert.equal(Launched, undefined);
	const ChosenId = '1db6da7d-45bf-4aba-8e59-9c7c7e327caf';
	Assert.deepEqual(await Send({ type: 'enqueue', requestId: ChosenId, variantUrl: Qualities[1].url }),
	{ ok: true, data: { state: 'started' } });
	Assert.deepEqual(Launched, { type: 'hlsRun', debugLogging: false, job: {
			requestId: ChosenId, url: Qualities[1].url, variantUrl: undefined, requestContext: RequestContext,
		} });
	Assert.equal(fetch.mock.callCount(), 0);
	// A rendition observed during playback can contain video only. Its master's
	// separate audio declaration must survive the direct-rendition launch path.
	Qualities[1].audioUrl = Cdn + '/audio.m3u8?signature=a%2Bb';
	const AudioId = '4a288cad-dbc8-4b93-8353-c94f8ec78671';
	Assert.deepEqual(await Send({ type: 'enqueue', requestId: AudioId, variantUrl: Qualities[1].url }),
	{ ok: true, data: { state: 'started' } });
	Assert.equal(Launched.job.url, Qualities[1].url);
	Assert.equal(Launched.job.audioUrl, Qualities[1].audioUrl,
		'observed video must retain the separate audio declared for the chosen quality');
	Assert.equal(Launched.job.variantUrl, undefined);
	Assert.equal(fetch.mock.callCount(), 0, 'master denial must not cause another master request');
	Qualities[0].audioUrl = Cdn + '/default-audio.m3u8';
	const DefaultId = '9bab5bb0-224f-4f82-a212-6a1c2ef77606';
	Assert.deepEqual(await Send({ type: 'enqueue', requestId: DefaultId }), {ok: true, data: {state: 'started'}});
	Assert.equal(Launched.job.url, Qualities[0].url);
	Assert.equal(Launched.job.audioUrl, Qualities[0].audioUrl, 'the default download also keeps its matching audio');
});
