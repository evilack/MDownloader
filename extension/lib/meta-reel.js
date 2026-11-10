/** Resolve only the current post's declared progressive MP4; DASH ranges are not full files. */
import {ClassifyMediaUrl} from './media.js';
import {RuntimePolicy} from './runtime-policy.js';
// Short-lived read sharing only; the authoritative candidates remain in session scan storage.
const Probes = new Map();

export function MetaReelIdentity(Page)
{
	const Url = new URL(Page);
	if (!['http:', 'https:'].includes(Url.protocol)) return null;
	const Facebook = /^(?:www\.|m\.)?facebook\.com$/i.test(Url.hostname);
	const Instagram = /^(?:www\.)?instagram\.com$/i.test(Url.hostname);
	const Match = Facebook ? /^\/reel\/(\d+)\/?$/.exec(Url.pathname)
		: Instagram ? /^\/(?:reels?|p|tv)\/([\w-]+)(?:\/embed)?\/?$/.exec(Url.pathname) : null;
	return Match ? {site: Facebook ? 'Facebook' : 'Instagram', id: Match[1]} : null;
}

export async function DiscoverMetaReel(TabId, DocumentId, Page)
{
	const Identity = MetaReelIdentity(Page);
	if (!Identity) return null;
	const Key = JSON.stringify([TabId, DocumentId, Page]), Previous = Probes.get(Key);
	if (Previous?.pending) return Previous.pending;
	if (Previous?.until > Date.now()) return Previous.value;
	const Probe = {};
	Probes.set(Key, Probe);
	if (Probes.size > RuntimePolicy.Detection.MaxObservedMedia) Probes.delete(Probes.keys().next().value);
	Probe.pending = (async () =>
	{
		try
		{
			const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]},
				func: ReadMetaReelPage, args: [Page, Identity, {maxBytes: RuntimePolicy.Transfer.MaxSnapshotMetadataBytes,
					timeoutMs: RuntimePolicy.Detection.NativeManifestTimeoutMs, maxNodes: 20_000}]}).catch(() => []);
			const Result = Frame?.result;
			if (Frame?.documentId !== DocumentId || Result?.page !== Page || Result.id !== Identity.id) return null;
			const Item = ClassifyMediaUrl(Result.url);
			if (Item?.format !== 'MP4' || !/^https:\/\/[^/]+\.(?:fbcdn\.net|cdninstagram\.com)\//i.test(Item.url)) return null;
			Probe.value = {...Item, name: `${Identity.site}-${Identity.id}.mp4`, documentId: DocumentId,
				sourceIdentity: `${Identity.site}:${Identity.id}`,
				...([Result.width, Result.height].every(Value => Number.isSafeInteger(Value) && Value > 0)
					? {width: Result.width, height: Result.height} : {})};
			Probe.until = Date.now() + RuntimePolicy.Detection.MetadataRefreshMs;
			return Probe.value;
		}
		finally
		{
			Probe.pending = undefined;
			if (!Probe.value && Probes.get(Key) === Probe) Probes.delete(Key);
		}
	})();
	return Probe.pending;
}

/** Serialized by chrome.scripting: all helpers must stay inside this function. Never execute page scripts. */
export async function ReadMetaReelPage(Page, Identity, Policy)
{
	if (location.href !== Page) return null;
	let Bytes = 0, Nodes = 0;
	const FullUrl = Value =>
	{
		try
		{
			const Url = new URL(Value);
			return Url.protocol === 'https:' && !Url.username && !Url.password &&
				/\.(?:fbcdn\.net|cdninstagram\.com)$/i.test(Url.hostname) && /\.mp4$/i.test(Url.pathname) &&
				!Url.searchParams.has('bytestart') && !Url.searchParams.has('byteend') ? Url.href : null;
		}
		catch {return null;}
	};
	const Find = Root =>
	{
		const Pending = [Root];
		while (Pending.length && ++Nodes <= Policy.maxNodes)
		{
			let Value = Pending.pop();
			if (typeof Value === 'string' && /^[{[]/.test(Value))
			{
				try {Value = JSON.parse(Value);} catch {continue;}
			}
			if (!Value || typeof Value !== 'object') continue;
			if (Identity.site === 'Facebook' && String(Value.id ?? Value.video_id) === Identity.id)
			{
				const Legacy = Value.videoDeliveryLegacyFields ?? Value;
				const Url = FullUrl(Legacy?.browser_native_hd_url) || FullUrl(Legacy?.hd_src) ||
					FullUrl(Legacy?.browser_native_sd_url) || FullUrl(Legacy?.sd_src);
				if (Url) return {url: Url};
			}
			if (Identity.site === 'Instagram' && (Value.shortcode === Identity.id || Value.code === Identity.id))
			{
				const Versions = Array.isArray(Value.video_versions) ? Value.video_versions : [];
				const Best = Versions.filter(Item => FullUrl(Item?.url)).sort((A, B) =>
					(Number(B.width) * Number(B.height) || 0) - (Number(A.width) * Number(A.height) || 0))[0];
				const Url = FullUrl(Best?.url) || FullUrl(Value.video_url);
				const Dimensions = Best ?? Value.dimensions;
				if (Url) return {url: Url,
					...([Dimensions?.width, Dimensions?.height].every(Size => Number.isSafeInteger(Size) && Size > 0)
						? {width: Dimensions.width, height: Dimensions.height} : {})};
			}
			for (const Child of Object.values(Value))
			{
				if (Child && (typeof Child === 'object' || typeof Child === 'string' && /^[{[]/.test(Child))) Pending.push(Child);
				if (Pending.length > Policy.maxNodes) return null;
			}
		}
		return null;
	};
	const Read = Scripts =>
	{
		for (const Script of Scripts)
		{
			const Text = Script.textContent ?? '';
			// Runtime bundles and other posts must not consume this post's metadata budget.
			if (!Text.includes(Identity.id) || !/browser_native_(?:hd|sd)_url|videoData|video_url|video_versions|contextJSON/.test(Text)) continue;
			Bytes += Text.length;
			if (Bytes > Policy.maxBytes) break;
			if (Script.type === 'application/json' || Script.type === 'application/ld+json')
			{
				try {const Source = Find(JSON.parse(Text)); if (Source) return Source;} catch { /* Ignore malformed data blocks. */ }
			}
			// Instagram's public embed stores GraphVideo as a JSON string in a ServerJS config.
			for (const Match of Text.matchAll(/"contextJSON"\s*:\s*("(?:\\.|[^"\\])*")/g))
			{
				try {const Source = Find(JSON.parse(Match[1])); if (Source) return Source;} catch { /* No eval or script execution. */ }
			}
			// Facebook embeds declare VideoConfig.videoData inside ServerJS calls. Extract
			// only the balanced JSON array, respecting quoted brackets and escaped quotes.
			if (Identity.site === 'Facebook') for (const Match of Text.matchAll(/"videoData"\s*:\s*\[/g))
			{
				const Start = Match.index + Match[0].length - 1;
				let Depth = 0, Quoted = false, Escaped = false;
				for (let Index = Start; Index < Text.length; Index++)
				{
					const Char = Text[Index];
					if (Quoted)
					{
						if (Escaped) Escaped = false;
						else if (Char === '\\') Escaped = true;
						else if (Char === '"') Quoted = false;
						continue;
					}
					if (Char === '"') Quoted = true;
					else if (Char === '[' || Char === '{') Depth++;
					else if ((Char === ']' || Char === '}') && --Depth === 0)
					{
						try {const Source = Find(JSON.parse(Text.slice(Start, Index + 1))); if (Source) return Source;} catch { /* Invalid JSON is not executable data. */ }
						break;
					}
				}
			}
		}
		return null;
	};
	let Source = Read(document.querySelectorAll('script'));
	if (!Source)
	{
		// SPA navigation may leave only the previous post's bootstrap data. Re-read only
		// this exact post on the current origin, retaining the normal session and access checks.
		const Controller = new AbortController();
		const Timer = setTimeout(() => Controller.abort(), Policy.timeoutMs);
		try
		{
			const Path = Identity.site === 'Instagram' ? `/p/${Identity.id}/embed/`
				: '/plugins/video.php?href=' + encodeURIComponent(new URL(`/reel/${Identity.id}/`, Page).href);
			const Response = await fetch(new URL(Path, Page).href,
				{credentials: 'same-origin', signal: Controller.signal});
			if (!Response.ok || !Response.body) return null;
			const Reader = Response.body.getReader(), Decoder = new TextDecoder();
			let Text = '', Size = 0;
			try
			{
				while (true)
				{
					const {value: Chunk, done: Done} = await Reader.read();
					if (Done) break;
					if ((Size += Chunk.byteLength) > Policy.maxBytes) return null;
					Text += Decoder.decode(Chunk, {stream: true});
				}
				Text += Decoder.decode();
			}
			finally {await Reader.cancel().catch(() => {}); Reader.releaseLock();}
			Bytes = 0; Nodes = 0;
			Source = Read(new DOMParser().parseFromString(Text, 'text/html').querySelectorAll('script'));
		}
		catch {return null;}
		finally {clearTimeout(Timer);}
	}
	return Source && location.href === Page ? {page: Page, id: Identity.id, ...Source} : null;
}
