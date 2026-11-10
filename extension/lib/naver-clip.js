/** Naver Clip embeds its playback manifest in card JSON and can request TS parts without any playlist request. */
import {RuntimePolicy} from './runtime-policy.js';
import {ClassifyMediaUrl} from './media.js';
const Cached = new Map();
const Pending = new Map();

export function IdentifyNaverClipPage(Page)
{
	try
	{
		const Address = new URL(Page);
		if (Address.protocol !== 'https:' || Address.username || Address.password || Address.port ||
		!((Address.hostname === 'm.naver.com' && /^\/shorts\/?$/.test(Address.pathname)) ||
		(Address.hostname === 'clip.naver.com' && /^\/contents\/?$/.test(Address.pathname))) ||
		(Address.searchParams.has('serviceType') && Address.searchParams.get('serviceType') !== 'CLIP') ||
		['seedMediaId', 'mediaId', 'serviceType'].some(Name => Address.searchParams.getAll(Name).length > 1)) return null;
		const MediaId = Address.searchParams.get('seedMediaId') ?? Address.searchParams.get('mediaId');
		if (!/^[a-f\d]{32,40}$/i.test(MediaId ?? '')) return null;
		const Api = new URL('https://creatorhub-api.naver.com/api/v9.0/clipviewer/card');
		Api.search = new URLSearchParams({seedMediaId: MediaId, serviceType: 'CLIP', deviceType: 'html5_mo'}).toString();
		return {mediaId: MediaId, apiUrl: Api.href};
	}
	catch {return null;}
}

/** Only complete progressive files explicitly declared by the matching card are direct-download candidates. */
export function ParseNaverClip(Data, MediaId)
{
	const Content = Data?.body?.card?.content;
	const Vod = Content?.vod;
	if (Data?.header?.code !== 0 || Content?.mediaId !== MediaId || Content.status !== 'EXPOSURE' ||
	Vod?.playable !== true || Vod.type !== 'PLAY_API_3_0' || !Array.isArray(Vod.playback?.MPD)) return [];
	const Items = new Map();
	const Title = (typeof Content.description === 'string' && Content.description.trim() ||
		typeof Content.title === 'string' && Content.title.trim() || 'Naver Clip').replace(/\s+/g, ' ').slice(0, RuntimePolicy.Filename.MaxStemLength);
	const List = Value => Array.isArray(Value) ? Value.slice(0, RuntimePolicy.Dash.MaxRepresentations) : [];
	for (const Mpd of List(Vod.playback.MPD))
	{
		if (Mpd?.['@nvod:videoId'] && Mpd['@nvod:videoId'] !== MediaId) continue;
		for (const Period of List(Mpd?.Period)) for (const Set of List(Period?.AdaptationSet))
		{
			if (Set?.SegmentTemplate || Set?.SegmentList) continue;
			for (const Rep of List(Set?.Representation))
			{
				if (!Rep || !/^PD_/.test(Rep['@id'] ?? '') || Rep.SegmentTemplate || Rep.SegmentList ||
				(Rep['@mimeType'] ?? Set['@mimeType']) !== 'video/mp4') continue;
				const Width = Number(Rep['@width']), Height = Number(Rep['@height']);
				if (![Width, Height].every(Value => Number.isSafeInteger(Value) && Value > 0 && Value <= 16384)) continue;
				for (const Value of List(Rep.BaseURL))
				{
					if (typeof Value !== 'string' || Value.length > RuntimePolicy.Detection.MaxUrlChars) continue;
					const Item = ClassifyMediaUrl(Value);
					if (Item?.format !== 'MP4') continue;
					const Address = new URL(Item.url);
					if (Address.protocol !== 'https:' || Address.port || !Address.hostname.endsWith('.pstatic.net')) continue;
					if (!Items.has(Item.url)) Items.set(Item.url, {...Item, name: `${Title}_${Width}x${Height}.mp4`,
						live: false, width: Width, height: Height, sourceIdentity: `naver-clip:${MediaId}:${Width}x${Height}`});
					if (Items.size >= RuntimePolicy.Detection.MaxObservedMedia) break;
				}
				if (Items.size >= RuntimePolicy.Detection.MaxObservedMedia) break;
			}
		}
	}
	return [...Items.values()].sort((A, B) => B.width * B.height - A.width * A.height).slice(0, RuntimePolicy.Detection.MaxObservedMedia);
}

/** Serialized into the permitted ISOLATED world; never changes playback or reads login/account state. */
export async function ReadNaverClipPage(Page, Options)
{
	if (location.href !== Page) return null;
	function PlayerNow()
	{
		if (location.href !== Page || globalThis.MDownloaderMediaPage?.previewOnly) return null;
		const Players = [...document.querySelectorAll('video')].filter(Player =>
		{
			if (Player.closest(Options.excludedSelector) || !Player.currentSrc || Player.readyState < 2) return false;
			const Owner = globalThis.MDownloaderMediaPage?.players?.get(Player);
			if (Owner && Owner.page !== Page) return false;
			const Bounds = Player.getBoundingClientRect();
			return Bounds.width > 0 && Bounds.height > 0 && Bounds.top < window.innerHeight && Bounds.bottom > 0 &&
				Bounds.left < window.innerWidth && Bounds.right > 0;
		});
		return Players.length === 1 ? Players[0] : null;
	}
	const Player = PlayerNow();
	if (!Player) return null;
	const Source = Player.currentSrc;
	if (Options.validateOnly) return Options.source === Source;
	const IsCurrent = () => PlayerNow() === Player && Player.currentSrc === Source;
	const Unavailable = () => IsCurrent() ? {source: Source} : null;
	let Response;
	try
	{
		Response = await fetch(Options.apiUrl, {credentials: 'omit', redirect: 'error', priority: 'low',
			signal: AbortSignal.timeout(Options.timeoutMs)});
	}
	catch {return Unavailable();}
	if (Response.status !== 200 || !/^application\/json(?:;|$)/i.test(Response.headers.get('content-type') ?? '') ||
	Number(Response.headers.get('content-length')) > Options.maxBytes || !Response.body || !IsCurrent())
	{
		await Response.body?.cancel();
		return Unavailable();
	}
	const Reader = Response.body.getReader();
	const Decoder = new TextDecoder();
	let Text = '', Bytes = 0;
	try
	{
		for (;;)
		{
			const {value, done} = await Reader.read();
			if (done) break;
			Bytes += value.byteLength;
			if (!IsCurrent()) return null;
			if (Bytes > Options.maxBytes) return Unavailable();
			Text += Decoder.decode(value, {stream: true});
		}
		return IsCurrent() ? {text: Text + Decoder.decode(), source: Source} : null;
	}
	catch {return Unavailable();}
	finally
	{
		await Reader.cancel().catch(() => {});
		Reader.releaseLock();
	}
}

export async function DiscoverNaverClip(TabId, DocumentId, Page)
{
	const Identity = IdentifyNaverClipPage(Page);
	if (!Identity || !DocumentId) return [];
	const Key = JSON.stringify([TabId, DocumentId, Page]);
	if (Pending.has(Key)) return Pending.get(Key);
	if (Pending.size >= RuntimePolicy.Detection.MaxObservedMedia) return [];
	const Work = (async () =>
	{
		const Options = {...Identity, maxBytes: RuntimePolicy.Detection.MaxSourceConfigBytes,
			timeoutMs: RuntimePolicy.Detection.NativeManifestTimeoutMs, excludedSelector: RuntimePolicy.Detection.SourcePlayerSelector};
		async function Run(Extra = {})
		{
			const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]},
				world: 'ISOLATED', func: ReadNaverClipPage, args: [Page, {...Options, ...Extra}]});
			return Frame?.documentId === DocumentId ? Frame.result : null;
		}
		const Previous = Cached.get(Key);
		if (Previous && Date.now() - Previous.at < RuntimePolicy.Detection.MetadataRefreshMs &&
		await Run({validateOnly: true, source: Previous.source}) === true) return Previous.items;
		Cached.delete(Key);
		const Result = await Run();
		if (typeof Result?.source !== 'string') return [];
		let Items = [];
		if (typeof Result.text === 'string' && Result.text.length <= Options.maxBytes)
		{
			try {Items = ParseNaverClip(JSON.parse(Result.text), Identity.mediaId);}
			catch { /* Invalid metadata is retried after the same bounded interval as unavailable cards. */ }
		}
		Cached.set(Key, {at: Date.now(), source: Result.source, items: Items});
		if (Cached.size > RuntimePolicy.Detection.MaxObservedMedia) Cached.delete(Cached.keys().next().value);
		return Items;
	})().catch(() => []).finally(() => Pending.delete(Key));
	Pending.set(Key, Work);
	return Work;
}
