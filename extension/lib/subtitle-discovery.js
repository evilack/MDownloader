import {LocalizedError} from './i18n.js';
import {RuntimePolicy} from './runtime-policy.js';

/**
 * Runs serialized in the candidate document. Read-only: no playback/track-mode changes,
 * player functions, eval, network requests, or guessed subtitle addresses.
 * Options: {page, urls, trackId?, recording?, excludedSelector?, maxDescriptors?, maxMetadataBytes?,
 * maxInlineBytes?, maxCues?, reportErrors?}. Returns descriptors; reportErrors transports
 * validation failures as {error: 'subtitle_limit'|'subtitle_invalid'|'subtitle_unsupported'} for Chrome injection.
 */
export function ReadPageSubtitles(Options = {})
{
	try
	{
		const Page = Options.page;
		const CheckPage = () =>
		{
			if (!Page || location.href !== Page) throw new Error('Subtitle discovery stopped: source page navigated.');
		};
		CheckPage();
		const Limit = (Name, Default) => Number.isSafeInteger(Options[Name]) && Options[Name] > 0
			? Math.min(Options[Name], Default) : Default;
		const MaxDescriptors = Limit('maxDescriptors', 128), MaxMetadataBytes = Limit('maxMetadataBytes', 4 * 1024 * 1024);
		const MaxInlineBytes = Limit('maxInlineBytes', 2 * 1024 * 1024), MaxCues = Limit('maxCues', 100000);
		const Exceeded = () => {throw new Error('Subtitle discovery metadata limit exceeded; captions cannot be silently omitted.');};
		const Base = document.baseURI || Page;
		const HttpUrl = Value =>
		{
			if (typeof Value !== 'string' || !Value.trim()) return null;
			if (Value.length > 16384) Exceeded();
			try
			{
				const Address = new URL(Value, Base);
				return ['http:', 'https:'].includes(Address.protocol) && !Address.username && !Address.password ? Address.href : null;
			}
			catch {return null;}
		};
		const SourceKey = Value =>
		{
			const Address = HttpUrl(Value);
			if (!Address) return null;
			const Url = new URL(Address);
			Url.hash = ''; // Media fragments are not part of the fetched resource; signed queries remain exact.
			return Url.href;
		};
		const Sources = new Set((Options.urls ?? [Options.url]).map(SourceKey).filter(Boolean));
		const SourceUrls = Player => [Player.currentSrc, Player.src,
			...[...Player.querySelectorAll('source[src]')].map(Item => Item.src || Item.getAttribute('src'))].filter(Boolean);
		const IsVisible = Player =>
		{
			const Playback = globalThis.MDownloaderMediaPage;
			const ObservedOwner = Playback?.players?.get(Player);
			if (Playback?.previewOnly || ObservedOwner?.page && ObservedOwner.page !== Page) return false;
			const Excluded = Options.excludedSelector || '[hidden], [aria-hidden="true"], .preview, .hover-preview, [data-hover-preview]';
			if (Player.hidden || Player.closest(Excluded + ', [data-card], [data-preview]')) return false;
			const Bounds = Player.getBoundingClientRect();
			const Style = typeof getComputedStyle === 'function' ? getComputedStyle(Player) : null;
			return Bounds.width > 0 && Bounds.height > 0 && Style?.display !== 'none' &&
				Style?.visibility !== 'hidden' && Style?.visibility !== 'collapse' && Style?.opacity !== '0';
		};
		const AllPlayers = [...document.querySelectorAll('video, audio')];
		if (AllPlayers.length > 256) Exceeded();
		const Players = AllPlayers.filter(IsVisible);
		const PlayerSources = new Map(Players.map(Player => [Player, SourceUrls(Player)]));
		const TrackOwner = Player => typeof Options.trackId === 'string' && typeof MediaStream !== 'undefined' &&
			Player.srcObject instanceof MediaStream && MediaStream.prototype.getVideoTracks.call(Player.srcObject)
				.some(Track => Track.id === Options.trackId && Track.readyState === 'live');
		const Exact = Players.filter(Player => PlayerSources.get(Player).some(Url => Sources.has(SourceKey(Url))) || TrackOwner(Player));
		const Opaque = Player => PlayerSources.get(Player).some(Url => String(Url).startsWith('blob:'));
		// A sole blob player is usable for an observed manifest, but a sole unrelated HTTP player is not.
		const Fallback = !Exact.length && Players.length === 1 && Sources.size > 0 && Opaque(Players[0]);
		const Owners = Exact.length === 1 ? Exact : Fallback ? Players : [];
		if (!Owners.length) {CheckPage(); return [];}
		const Owner = Owners[0];
		// Sample once at ownership selection, before metadata scanning. Recording output
		// later projects this source clock against its actual recorder start wall time.
		const RecordingClock = Options.recording ? {time: Owner.currentTime, sampledAt: Date.now(), rate: Owner.playbackRate ?? 1} : null;
		const RecordingPaused = Options.recording ? Owner.paused : false;
		const Results = [], Seen = new Set(), UrlTracks = new Set();
		let InlineBytes = 0;
		const Metadata = (Value, Default, Max) =>
		{
			if (typeof Value !== 'string' || !Value.trim()) return Default;
			if (Value.length > Max) Exceeded();
			return Value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
		};
		const Add = Input =>
		{
			const Url = HttpUrl(Input.url);
			const Text = typeof Input.text === 'string' && Input.text ? Input.text : undefined;
			if (!Url && !Text) return;
			const Language = Metadata(Input.language, 'und', 64), Label = Metadata(Input.label, Language, 256);
			const Key = `${Language.toLowerCase()}\n${Url ?? Text}`;
			if (Seen.has(Key)) return;
			if (Results.length >= MaxDescriptors) Exceeded();
			const Ext = Url ? new URL(Url).pathname.match(/\.(vtt|srt|ttml|dfxp|m3u8)$/i)?.[1].toLowerCase() : 'vtt';
			const Format = Metadata(Input.format, Ext, 64);
			const Descriptor = {...(Url ? {url: Url} : {text: Text}), language: Language, label: Label,
				...(Format ? {format: Format} : {})};
			Seen.add(Key);
			Results.push(Descriptor);
		};
		const TrackElements = [...Owner.querySelectorAll('track')];
		if (TrackElements.length > 1024) Exceeded();
		for (const Element of TrackElements)
		{
			if (!['captions', 'subtitles'].includes(String(Element.kind || Element.getAttribute('kind')).toLowerCase())) continue;
			const Url = HttpUrl(Element.getAttribute('src'));
			if (!Url) continue;
			Add({url: Url, language: Element.srclang || Element.getAttribute('srclang'), label: Element.label});
			if (Element.track) UrlTracks.add(Element.track);
		}
		const Timestamp = Seconds =>
		{
			const Millis = Math.round(Seconds * 1000);
			return `${String(Math.floor(Millis / 3600000)).padStart(2, '0')}:${String(Math.floor(Millis / 60000) % 60).padStart(2, '0')}:${String(Math.floor(Millis / 1000) % 60).padStart(2, '0')}.${String(Millis % 1000).padStart(3, '0')}`;
		};
		const TextTracks = [...(Owner.textTracks ?? [])];
		if (TextTracks.length > 1024) Exceeded();
		for (const Track of TextTracks)
		{
			if (!['captions', 'subtitles'].includes(Track.kind) || UrlTracks.has(Track)) continue;
			let Cues;
			try {Cues = Track.cues;}
			catch {continue;} // Disabled/cross-origin cues are not loaded by changing mode.
			if (!Cues?.length) continue;
			if (Cues.length > MaxCues) Exceeded();
			let Text = 'WEBVTT\n\n';
			for (const Cue of Cues)
			{
				if (!Number.isFinite(Cue.startTime) || !Number.isFinite(Cue.endTime) || Cue.startTime < 0 || Cue.endTime <= Cue.startTime || typeof Cue.text !== 'string')
					throw new Error('Subtitle cue cannot be serialized safely.');
				Text += `${Timestamp(Cue.startTime)} --> ${Timestamp(Cue.endTime)}\n${Cue.text.replace(/\r\n?/g, '\n')}\n\n`;
				if (Text.length > MaxInlineBytes) Exceeded();
			}
			InlineBytes += new TextEncoder().encode(Text).byteLength;
			if (InlineBytes > MaxInlineBytes) Exceeded();
			Add({text: Text, language: Track.language, label: Track.label, format: 'vtt'});
		}

		// Lex literal declarations, skipping comments/strings/templates. No JS is evaluated.
		function Tokens(Text)
		{
			const Out = [];
			for (let Index = 0; Index < Text.length;)
			{
				const Start = Index, Char = Text[Index];
				if (/\s/.test(Char)) {Index++; continue;}
				if (Text.startsWith('//', Index)) {const End = Text.indexOf('\n', Index + 2); Index = End < 0 ? Text.length : End + 1; continue;}
				if (Text.startsWith('/*', Index)) {const End = Text.indexOf('*/', Index + 2); Index = End < 0 ? Text.length : End + 2; continue;}
				if (Char === '"' || Char === "'" || Char === '`')
				{
					Index++;
					let Value = '', Valid = Char !== '`', Closed = false;
					while (Index < Text.length)
					{
						const Next = Text[Index++];
						if (Next === Char) {Closed = true; break;}
						if (Next !== '\\') {Value += Next; continue;}
						const Escape = Text[Index++];
						const Escapes = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f', 'v': '\v', '0': '\0'};
						if (Escape === 'u' || Escape === 'x')
						{
							const Count = Escape === 'u' ? 4 : 2, Digits = Text.slice(Index, Index + Count);
							if (!new RegExp(`^[a-f\\d]{${Count}}$`, 'i').test(Digits)) Valid = false;
							else Value += String.fromCharCode(parseInt(Digits, 16));
							Index += Count;
						}
						else Value += Escapes[Escape] ?? Escape ?? '';
					}
					Out.push({value: Value, string: Valid && Closed, start: Start, end: Index});
				}
				else if (/[a-z_$]/i.test(Char))
				{
					Index++;
					while (Index < Text.length && /[a-z\d_$]/i.test(Text[Index])) Index++;
					Out.push({value: Text.slice(Start, Index), start: Start, end: Index});
				}
				else if (Char === '/' && (!Out.length || ['=', '(', '[', ',', ':', 'return', '!', '?', ';', '{', '}'].includes(Out.at(-1).value)))
				{
					// Regex literals may contain apparent player code; never inspect their contents.
					Index++; let InClass = false;
					while (Index < Text.length)
					{
						const Next = Text[Index++];
						if (Next === '\\') {Index++; continue;}
						if (Next === '[') InClass = true;
						if (Next === ']') InClass = false;
						if (Next === '/' && !InClass || Next === '\n') break;
					}
					Out.push({value: 'regex', start: Start, end: Index});
				}
				else {Out.push({value: Char, start: Index, end: ++Index});}
				if (Out.length > 300000) Exceeded();
			}
			return Out;
		}
		function ReadProvider(Text)
		{
			if (!Text.includes('setSubtitles')) return;
			const Parts = Tokens(Text), Providers = new Map();
			for (let Index = 0; Index + 7 < Parts.length; Index++)
			{
				const Item = Parts.slice(Index, Index + 8);
				if (['var', 'let', 'const'].includes(Item[0].value) && Item[2].value === '=' && Item[3].value === 'new' &&
					Item[4].value === 'HTML5Player' && Item[5].value === '(' && Item[6].string && Item[7].value === ',')
				{
					const Id = Item[1].value;
					Providers.set(Id, Providers.has(Id) ? null : {container: Item[6].value, sources: [], tracks: []});
				}
			}
			for (let Index = 0; Index + 4 < Parts.length; Index++)
			{
				const Config = Providers.get(Parts[Index].value);
				if (!Config || Parts[Index].string || Parts[Index + 1].value !== '.' || Parts[Index + 3].value !== '(') continue;
				const Method = Parts[Index + 2].value;
				if (['setVideoUrlLow', 'setVideoUrlHigh', 'setVideoHLS'].includes(Method) && Parts[Index + 4].string && Parts[Index + 5]?.value === ')')
					Config.sources.push(SourceKey(Parts[Index + 4].value));
				if (Method !== 'setSubtitles' || !Parts[Index + 4].string || Parts[Index + 5]?.value !== ',' || Parts[Index + 6]?.value !== '[') continue;
				let Depth = 0, End = Index + 6;
				for (; End < Parts.length; End++)
				{
					if (Parts[End].string) continue;
					if (Parts[End].value === '[') Depth++;
					if (Parts[End].value === ']' && --Depth === 0) break;
				}
				if (Parts[End + 1]?.value !== ')') continue;
				try
				{
					const Tracks = JSON.parse(Text.slice(Parts[Index + 6].start, Parts[End].end));
					if (Array.isArray(Tracks)) Config.tracks.push(...Tracks);
				}
				catch { /* Nonliteral provider arguments are unsupported and never executed. */ }
			}
			for (const Config of Providers.values())
			{
				if (!Config) continue;
				const Container = document.getElementById(Config.container);
				if (!Container || !(Container === Owner || Container.contains(Owner))) continue;
				if (!Config.sources.some(Url => Sources.has(Url)) && !Fallback) continue;
				for (const Track of Config.tracks)
					if (Track && typeof Track === 'object') Add({url: Track.f, language: Track.l, label: Track.n || Track.t});
			}
		}
		function ReadJson(Config)
		{
			if (!Config || typeof Config !== 'object' || Array.isArray(Config)) return;
			const ConfigSources = [Config.file, Config.src, Config.url,
				...(Array.isArray(Config.sources) ? Config.sources.map(Source => typeof Source === 'string' ? Source : Source?.file || Source?.src || Source?.url) : [])].map(SourceKey).filter(Boolean);
			const OwnerUrls = PlayerSources.get(Owner).map(SourceKey);
			if (ConfigSources.some(Url => Sources.has(Url)) && (Fallback || ConfigSources.some(Url => OwnerUrls.includes(Url))))
			{
				for (const Track of Array.isArray(Config.tracks) ? Config.tracks : [])
					if (Track && ['captions', 'subtitles'].includes(Track.kind))
						Add({url: Track.file || Track.src || Track.url, language: Track.srclang || Track.language, label: Track.label, format: Track.format});
			}
			if (Array.isArray(Config.playlist)) for (const Item of Config.playlist) ReadJsonItem(Item);
		}
		function ReadJsonItem(Item)
		{
			// Only playlist items, without arbitrary recursive site-data traversal.
			if (Item && typeof Item === 'object') ReadJson({...Item, playlist: undefined});
		}
		let MetadataBytes = 0, RelevantScripts = 0;
		const Scripts = [...document.scripts];
		for (const Script of Scripts)
		{
			const Text = Script.textContent || '';
			const IsJson = ['application/json', 'application/ld+json'].includes(Script.type);
			// Large unrelated SPA/bootstrap payloads are not subtitle metadata. Inspect only
			// possible supported declarations; no language/source/URL is inferred by this filter.
			if (IsJson ? !/"tracks"\s*:/.test(Text) || !/"kind"\s*:\s*"(?:captions|subtitles)"/.test(Text)
				: !Text.includes('setSubtitles') || !/\bnew\s+HTML5Player\s*\(/.test(Text)) continue;
			if (++RelevantScripts > 128) Exceeded();
			MetadataBytes += Text.length * 2;
			if (MetadataBytes > MaxMetadataBytes) Exceeded();
			if (IsJson)
			{
				let Config;
				try {Config = JSON.parse(Text);}
				catch {continue;}
				ReadJson(Config);
			}
			else ReadProvider(Text);
		}
		CheckPage();
		if (Results.length && RecordingClock)
		{
			if (!Number.isFinite(RecordingClock.time) || !Number.isFinite(RecordingClock.sampledAt) ||
				RecordingClock.rate !== 1 || RecordingPaused !== false)
				throw Object.assign(new Error('Subtitle recording source clock is unsupported.'), {key: 'subtitle_unsupported'});
			for (const Descriptor of Results) Descriptor.recordingClock = RecordingClock;
		}
		return Results;
	}
	catch (ErrorValue)
	{
		// Chrome does not reliably propagate exceptions thrown by injected page functions.
		if (Options.reportErrors) return {error: ErrorValue?.key === 'subtitle_unsupported' ? 'subtitle_unsupported'
			: /limit exceeded/i.test(ErrorValue?.message ?? '') ? 'subtitle_limit' : 'subtitle_invalid'};
		throw ErrorValue;
	}
}

/** Captions remain in caller memory; never persisted with download jobs. */
export async function DiscoverSubtitles(TabId, Candidate)
{
	if (!Number.isInteger(TabId) || !Candidate || !globalThis.chrome?.scripting?.executeScript) return [];
	const Page = Candidate.previewPage || Candidate.page;
	if (!Page) return [];
	const Target = Candidate.documentId ? {tabId: TabId, documentIds: [Candidate.documentId]}
		: {tabId: TabId, frameIds: [Number.isInteger(Candidate.frameId) ? Candidate.frameId : 0]};
	const Urls = [...new Set([Candidate.url, Candidate.selectedSource,
		...(Candidate.variants ?? []).map(Item => typeof Item === 'string' ? Item : Item?.url),
		...(Candidate.qualities ?? []).map(Item => Item?.url)].filter(Item => typeof Item === 'string'))];
	try
	{
		const [Frame] = await chrome.scripting.executeScript({target: Target, world: 'ISOLATED',
			func: ReadPageSubtitles, args: [{page: Page, urls: Urls, trackId: Candidate.trackId,
				recording: Candidate.format === 'WEBRTC', excludedSelector: RuntimePolicy.Detection.SourcePlayerSelector, reportErrors: true}]});
		if (Frame?.result?.error) throw new LocalizedError(['subtitle_limit', 'subtitle_unsupported'].includes(Frame.result.error) ? Frame.result.error : 'subtitle_invalid');
		// Existing callers/mocks which do not support subtitle inspection have no caption result.
		if (!Array.isArray(Frame?.result)) return [];
		if (Candidate.documentId && Frame.documentId !== Candidate.documentId)
			throw new LocalizedError('subtitle_invalid');
		const DocumentId = Candidate.documentId || Frame.documentId;
		const [After] = await chrome.scripting.executeScript({target: Target, world: 'ISOLATED',
			func: function ReadSubtitlePageIdentity() {return {page: location.href};}});
		if ((DocumentId && After?.documentId !== DocumentId) || After?.result?.page !== Page)
			throw new LocalizedError('subtitle_invalid');
		return Frame.result;
	}
	catch (ErrorValue)
	{
		if (ErrorValue instanceof LocalizedError) throw ErrorValue;
		throw new LocalizedError(/limit exceeded/i.test(ErrorValue?.message ?? '') ? 'subtitle_limit' : 'subtitle_invalid');
	}
}
