import { test as Test } from 'node:test';
import Assert from 'node:assert/strict';
import Vm from 'node:vm';
import { readFile as ReadFile } from 'node:fs/promises';
import { DeclaredStreamPageTask } from '../extension/lib/declared-streams.js';
const Providers = JSON.parse(await ReadFile(new URL('../extension/data/source-providers.json', import.meta.url), 'utf8'));
function Page({ username: Username = 'Channel_Name', status: Status = 'public', template: Template = 'https://edge.test/hls/{streamName}/master/{streamName}{suffix}.m3u8', card: bCard = false } = {})
{
	const Requests = [];
	class MediaStream
	{
		getVideoTracks()
		{
			return [{ readyState: 'live' }];
		}
	}
	const Config = { initialStaticConfig: { initialStatic: { hlsStreamUrlTemplate: Template, hlsStreamHost: 'cdn.test' } },
		featuresConfig: { features: { hlsPlayer: { desktopResolutionType: 'auto', lowLatencyMode: true } } } };
	const Context = Vm.createContext({ URL, AbortSignal, TextDecoder, MediaStream, HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
		location: { href: 'https://page.test/Channel_Name', origin: 'https://page.test', pathname: '/Channel_Name' },
		document: { scripts: [{ textContent: 'window.CONFIG_PRELOADER_SSR_DATA = ' + JSON.stringify(Config) + ';' }],
			querySelectorAll()
			{
				return [{ srcObject: new MediaStream(), videoWidth: 1280, readyState: 4, paused: false,
						closest()
						{
							return bCard ? {} : null;
						}, getBoundingClientRect()
						{
							return { width: 640, height: 360 };
						} }];
			} },
		performance: { getEntriesByType()
			{
				return [{ name: 'https://page.test/api/front/v2/broadcasts/345' }];
			} },
		async fetch(Url)
		{
			Requests.push(Url);
			return new Response(JSON.stringify({ item: { username: Username, streamName: 'live-345', isLive: true, status: Status } }));
		},
	});
	Context.Input = { mode: 'discover', page: Context.location.href, provider: Providers.mouflon, maxBytes: 1024 * 1024,
		timeoutMs: 1000, maxMetadataRequests: 5 };
	return { requests: Requests, context: Context, run: () => Vm.runInContext('(' + DeclaredStreamPageTask.toString() + ')(Input)', Context) };
}

Test('uses the site-provided template and observed public broadcast metadata for a main MediaStream', async () =>
{
	const Subject = Page();
	const Source = await Subject.run();
	Assert.equal(Source.url, 'https://edge.test/hls/live-345/master/live-345_auto.m3u8?playlistType=lowLatency');
	Assert.deepEqual(Subject.requests, ['https://page.test/api/front/v2/broadcasts/345']);
});
Test('does not probe preview cards, private broadcasts or another channel', async () =>
{
	const Card = Page({ card: true });
	Assert.equal(await Card.run(), null);
	Assert.deepEqual(Card.requests, []);
	for (const Options of [{ username: 'Other_Channel' }, { status: 'private' }, { template: 'file:///{streamName}' }])
	{
		Assert.equal(await Page(Options).run(), null);
	}
});
Test('uses document-bound observed metadata after the site clears resource timings', async () =>
{
	const Subject = Page();
	Subject.context.performance.getEntriesByType = () => [];
	Subject.context.Input.metadataUrls = ['https://page.test/api/front/v2/broadcasts/345', 'https://other.test/api/front/v2/broadcasts/999'];
	Assert.equal((await Subject.run()).url, 'https://edge.test/hls/live-345/master/live-345_auto.m3u8?playlistType=lowLatency');
	Assert.deepEqual(Subject.requests, ['https://page.test/api/front/v2/broadcasts/345']);
});
Test('reads only the current player identity when metadata requests originate in a worker', async () =>
{
	const Subject = Page();
	Subject.context.performance.getEntriesByType = () => [];
	const Original = Subject.context.document.querySelectorAll;
	Subject.context.document.querySelectorAll = () => Original().map(Player => Object.assign(Player, {
		parentElement: { __reactFiber_test: { memoizedProps: { modelId: 345, renderVideoElement()
					{
					} }, return: null } },
	}));
	Assert.equal((await Subject.run()).url, 'https://edge.test/hls/live-345/master/live-345_auto.m3u8?playlistType=lowLatency');
	Assert.deepEqual(Subject.requests, ['https://page.test/api/front/v2/broadcasts/345']);
});
Test('reads the explicit public runtime configuration when guest SSR only contains mode', async () =>
{
	const Subject = Page();
	Subject.context.document.scripts[0].textContent = 'window.CONFIG_PRELOADER_SSR_DATA = {"mode":"guest"};';
	Subject.context.performance.getEntriesByType = () => [];
	const State = { configV3: { initialCommon: { hlsStreamUrlTemplate: 'https://edge.test/{streamName}{suffix}.m3u8', hlsStreamHost: 'cdn.test' } },
		featuresConfig: { features: { hlsPlayer: { desktopResolutionType: 'auto', lowLatencyMode: true } } } };
	Object.defineProperty(State, 'account', { enumerable: true, get()
		{
			Assert.fail('Account state must not be inspected');
		} });
	const Original = Subject.context.document.querySelectorAll;
	Subject.context.document.querySelectorAll = () => Original().map(Player => Object.assign(Player, {
		parentElement: { __reactFiber_test: { memoizedProps: { modelId: 345, renderVideoElement()
					{
					} },
				return: { memoizedProps: { value: { store: { getState: () => State } } }, return: null } } },
	}));
	Assert.equal((await Subject.run()).url, 'https://edge.test/live-345_auto.m3u8?playlistType=lowLatency');
});
