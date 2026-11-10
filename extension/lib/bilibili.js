/** Bilibili serves DASH tracks without an MPD. Resolve its declared, complete progressive MP4 instead. */
import {RuntimePolicy} from './runtime-policy.js';
import {ClassifyMediaUrl} from './media.js';
const Probes = new Map();

export function IdentifyBilibiliPage(Page)
{
	try
	{
		const Url = new URL(Page);
		if (Url.protocol !== 'https:' || Url.username || Url.password || Url.port ||
			!['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(Url.hostname) || Url.searchParams.getAll('p').length > 1) return null;
		const Match = /^\/(?:[a-z]{2}(?:-[a-zA-Z]{2,4})?\/)?video\/(BV[\da-zA-Z]{10})\/?$/.exec(Url.pathname);
		const Part = Url.searchParams.get('p') ?? '1';
		return Match && /^[1-9]\d{0,4}$/.test(Part) ? {bvid: Match[1], part: Number(Part)} : null;
	}
	catch {return null;}
}

export function ParseBilibiliProgressive(Json, Identity)
{
	const Data = Json?.data;
	if (Json?.code !== 0 || !Data || Data.is_preview || Data.is_drm || Data.drm_tech_type ||
		!Number.isFinite(Data.timelength) || Data.timelength <= 0 || !Number.isSafeInteger(Data.quality) || Data.quality <= 0 ||
		!Array.isArray(Data.durl) || Data.durl.length !== 1) return [];
	const [File] = Data.durl;
	if (File?.order !== 1 || !Number.isFinite(File.length) || Math.abs(File.length - Data.timelength) > 1000 ||
		!Number.isSafeInteger(File.size) || File.size <= 0 || typeof File.url !== 'string' ||
		File.url.length > RuntimePolicy.Detection.MaxUrlChars) return [];
	const Files = [File.url, ...(Array.isArray(File.backup_url) ? File.backup_url.slice(0, 8) : [])].map(Value =>
	{
		if (typeof Value !== 'string' || Value.length > RuntimePolicy.Detection.MaxUrlChars) return null;
		const Item = ClassifyMediaUrl(Value);
		if (Item?.format !== 'MP4') return null;
		const Url = new URL(Item.url);
		return Url.protocol === 'https:' && !Url.port && (Url.hostname.endsWith('.bilivideo.com') ||
			Url.hostname === 'upos-hz-mirrorakam.akamaized.net') ? Item : null;
	}).filter(Boolean);
	// Use only the API's signed backup, without rewriting hostnames or authentication fields.
	const Item = Files.find(File => new URL(File.url).hostname === 'upos-hz-mirrorakam.akamaized.net') ?? Files[0];
	if (!Item) return [];
	const Height = /^mp4(\d+)$/.exec(Data.format ?? '')?.[1];
	const Title = (Identity.title?.trim() || Identity.bvid).replace(/\s+/g, ' ').slice(0, RuntimePolicy.Filename.MaxStemLength);
	return [{...Item, name: `${Title}${Height ? '_' + Height + 'p' : ''}.mp4`, live: false,
		sourceIdentity: `bilibili:${Identity.bvid}:${Identity.cid}:${Data.quality}`}];
}

/** Serialized into MAIN to read only the matching player's identity, never cookies or account data. */
export async function ReadBilibiliPage(Page, Identity, Options)
{
	function Current()
	{
		if (location.href !== Page || globalThis.MDownloaderMediaPage?.previewOnly) return null;
		const State = globalThis.__INITIAL_STATE__;
		if (State?.bvid !== Identity.bvid || State.videoData?.bvid !== Identity.bvid ||
			Number(State.p ?? 1) !== Identity.part || !Number.isSafeInteger(State.cid) || State.cid <= 0) return null;
		const Part = State.videoData.pages?.find(Entry => Entry.page === Identity.part);
		if (!Part || Part.cid !== State.cid) return null;
		const Players = [...document.querySelectorAll('video')].filter(Player =>
			!Player.closest?.(Options.excludedSelector) && Player.currentSrc && Player.readyState >= 1);
		if (Players.length !== 1) return null;
		return {bvid: Identity.bvid, cid: State.cid, title: State.videoData.title,
			source: Players[0].currentSrc};
	}
	const Before = Current();
	if (!Before) return null;
	if (Options.validateOnly) return Before;
	const IsCurrent = () => {const Now = Current(); return Now && Now.cid === Before.cid && Now.source === Before.source;};
	const Api = new URL('https://api.bilibili.com/x/player/playurl');
	Api.search = new URLSearchParams({bvid: Before.bvid, cid: Before.cid, qn: 64, fnval: 1, fnver: 0, fourk: 1}).toString();
	const Response = await fetch(Api.href, {credentials: 'include', redirect: 'error',
		signal: AbortSignal.timeout(Options.timeoutMs)});
	if (Response.status !== 200 || !/^application\/json(?:;|$)/i.test(Response.headers.get('content-type') ?? '') ||
		Number(Response.headers.get('content-length')) > Options.maxBytes || !Response.body || !IsCurrent())
	{
		await Response.body?.cancel();
		return null;
	}
	const Reader = Response.body.getReader(), Decoder = new TextDecoder();
	let Bytes = 0, Text = '';
	try
	{
		for (;;)
		{
			const {done, value} = await Reader.read();
			if (done) break;
			Bytes += value.byteLength;
			if (Bytes > Options.maxBytes || !IsCurrent()) return null;
			Text += Decoder.decode(value, {stream: true});
		}
		return IsCurrent() ? {...Before, text: Text + Decoder.decode()} : null;
	}
	finally {await Reader.cancel().catch(() => {}); Reader.releaseLock();}
}

export async function DiscoverBilibili(TabId, DocumentId, Page)
{
	const Identity = IdentifyBilibiliPage(Page);
	if (!Identity || !DocumentId) return [];
	const Key = JSON.stringify([TabId, DocumentId, Page]);
	const Previous = Probes.get(Key);
	if (Previous?.pending) return Previous.pending;
	const Probe = {};
	Probes.set(Key, Probe);
	if (Probes.size > RuntimePolicy.Detection.MaxObservedMedia) Probes.delete(Probes.keys().next().value);
	Probe.pending = (async () =>
	{
		const Options = {maxBytes: RuntimePolicy.Detection.MaxSourceConfigBytes,
			timeoutMs: RuntimePolicy.Detection.NativeManifestTimeoutMs, excludedSelector: RuntimePolicy.Detection.SourcePlayerSelector};
		async function Run(Extra = {})
		{
			const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]},
				world: 'MAIN', func: ReadBilibiliPage, args: [Page, Identity, {...Options, ...Extra}]});
			return Frame?.documentId === DocumentId ? Frame.result : null;
		}
		if (Previous?.at && Date.now() - Previous.at < RuntimePolicy.Detection.MetadataRefreshMs)
		{
			const Now = await Run({validateOnly: true});
			if (Now?.cid === Previous.cid && Now.source === Previous.source)
			{
				Object.assign(Probe, {at: Previous.at, cid: Previous.cid, source: Previous.source, items: Previous.items});
				return Previous.items;
			}
		}
		const Result = await Run();
		if (Result?.bvid !== Identity.bvid || !Number.isSafeInteger(Result.cid) || typeof Result.text !== 'string' ||
			Result.text.length > Options.maxBytes) return [];
		const Items = ParseBilibiliProgressive(JSON.parse(Result.text), Result).map(Item => ({...Item, documentId: DocumentId}));
		if (Items.length) Object.assign(Probe, {at: Date.now(), cid: Result.cid, source: Result.source, items: Items});
		return Items;
	})().catch(() => []).finally(() =>
	{
		delete Probe.pending;
		if (!Probe.items && Probes.get(Key) === Probe) Probes.delete(Key);
	});
	return Probe.pending;
}
