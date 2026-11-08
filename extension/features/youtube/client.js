import {CanUseYoutube} from '../../lib/distribution-policy.js';
import {IdentifyYoutubeUrl} from '../../lib/youtube-source-policy.js';
import {CreateEvaluator, YoutubeError} from './evaluator.js';
const Fail = Code => {throw new YoutubeError(Code);};
function Captions(Info, Id)
{
	const Tracks = Info.captions?.caption_tracks ?? [];
	if (Tracks.length > 128) Fail('subtitle_limit');
	return Tracks.map((Track, Index) => {
		let Url; try { Url = new URL(Track.base_url); } catch { Fail('youtube_unexpected_host'); }
		if (Url.protocol !== 'https:' || !['www.youtube.com', 'youtube.com'].includes(Url.hostname) || Url.username || Url.password ||
			Url.pathname !== '/api/timedtext' || Url.searchParams.get('v') !== Id) Fail('youtube_unexpected_host');
		Url.searchParams.set('fmt', 'vtt');
		const Label = String(Track.name ?? Track.language_code ?? 'Subtitles');
		return {id: String(Index), identity: JSON.stringify([Track.language_code, Track.kind ?? '', Track.vss_id ?? Label]),
			url: Url.href, format: 'vtt', language: Track.language_code || 'und', label: Label, kind: Track.kind};
	});
}
const DefaultPermission = async Url =>
{
	const Origin = new URL(Url).origin;
	if (chrome.permissions) return chrome.permissions.contains({origins: [Origin + '/*']});
	// 실제 offscreen에는 runtime 외 확장 API를 노출하지 않습니다. 워커가 권한을 소유합니다.
	const Result = await chrome.runtime.sendMessage({type: 'youtubePermission', origin: Origin});
	return Result?.allowed === true;
};
/** URL/쿠키/토큰/플레이어 스크립트는 세션 메모리 밖으로 기록하지 않습니다. */
export function CreateYoutubeClient({createInnertube, hasPermission = DefaultPermission, fetch: Fetch = globalThis.fetch, evaluate = CreateEvaluator(), report = () => {}} = {})
{
	const Sessions = new Map();
	async function Permission(Url)
	{
		if (!await hasPermission(Url))
		{
			const ErrorValue = new YoutubeError('youtube_permission_denied');
			ErrorValue.permissionOrigin = new URL(Url).origin;
			throw ErrorValue;
		}
	}
	async function SafeFetch(Input, Init = {}, Signal = new AbortController().signal)
	{
		const RequestValue = new Request(Input, Init);
		const Url = new URL(RequestValue.url);
		if (Url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'youtubei.googleapis.com'].includes(Url.hostname)) Fail('youtube_unexpected_host');
		await Permission(Url.href);
		let ResponseValue;
		try { ResponseValue = await Fetch(new Request(RequestValue, {credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.any([Signal, RequestValue.signal, AbortSignal.timeout(20000)])})); }
		catch { Signal.throwIfAborted(); Fail('youtube_network_failed'); }
		const Diagnostic = {stage: Url.pathname.startsWith('/s/player/') ? 'player-script' : Url.pathname.includes('/player') ? 'player-api' : Url.pathname.includes('/config') ? 'config-api' : 'session', status: ResponseValue.status, method: RequestValue.method};
		if (!ResponseValue.ok)
		{
			const Text = await ResponseValue.clone().text();
			try
			{
				const ErrorData = JSON.parse(Text)?.error;
				if (Number.isInteger(ErrorData?.code)) Diagnostic.apiCode = ErrorData.code;
				if (['PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT', 'FAILED_PRECONDITION'].includes(ErrorData?.status)) Diagnostic.apiStatus = ErrorData.status;
			}
			catch { /* HTML/프록시 응답 본문은 진단에 남기지 않습니다. */ }
			Diagnostic.markers = ['origin', 'referer', 'API key', 'unusual traffic', 'automated', 'bot', 'Forbidden', 'blocked'].filter(Marker => Text.toLowerCase().includes(Marker.toLowerCase()));
		}
		report(Diagnostic);
		if (ResponseValue.status === 403 && Diagnostic.markers?.some(Marker => ['automated', 'bot'].includes(Marker))) Fail('youtube_automated_request_rejected');
		return ResponseValue;
	}
	return {
		async DiscoverYoutube({pageUrl: PageUrl, transport: Transport = 'direct'}, Signal = new AbortController().signal)
		{
			if (!CanUseYoutube()) Fail('youtube_distribution_disabled');
			Signal.throwIfAborted();
			const Identity = IdentifyYoutubeUrl(PageUrl);
			if (!Identity) return null;
			await Permission(Identity.canonicalUrl);
			let Tube, Info;
			try
			{
				const Create = createInnertube ?? (await import('../../vendor/youtube/client-bundle.mjs')).CreateInnertube;
				Tube = await Create({fetch: (Input, Init) => SafeFetch(Input, Init, Signal), evaluate});
				Info = await Tube.getBasicInfo(Identity.videoId, {client: 'WEB'});
			}
			catch (ErrorValue)
			{
				if (ErrorValue instanceof YoutubeError) throw ErrorValue;
				report({stage: 'extraction', category: ['PlayerError', 'InnertubeError', 'ParsingError', 'TypeError', 'SyntaxError'].includes(ErrorValue.name) ? ErrorValue.name : 'Error'});
				Fail('youtube_extraction_failed');
			}
			Signal.throwIfAborted();
			if (Info.basic_info?.id !== Identity.videoId) Fail('youtube_session_changed');
			if (Info.playability_status?.status !== 'OK' || Info.basic_info?.is_live || Info.basic_info?.is_upcoming) Fail('youtube_restricted');
			let CaptionTracks = Captions(Info, Identity.videoId);
			let Profile;
			if (Transport === 'sabr')
			{
				Profile = (await import('../../vendor/youtube/client-bundle.mjs')).SabrClientProfile;
				try { Info = await Tube.getBasicInfo(Identity.videoId, {client: Profile.name}); }
				catch (ErrorValue) { if (ErrorValue instanceof YoutubeError) throw ErrorValue; Fail('youtube_extraction_failed'); }
				if (Info.basic_info?.id !== Identity.videoId) Fail('youtube_session_changed');
				if (Info.playability_status?.status !== 'OK' || Info.basic_info?.is_live || Info.basic_info?.is_upcoming) Fail('youtube_restricted');
				const CaptionUnion = new Map(CaptionTracks.map(Track => [Track.identity, Track]));
				for (const Track of Captions(Info, Identity.videoId)) CaptionUnion.set(Track.identity, Track);
				CaptionTracks = [...CaptionUnion.values()].map((Track, Index) => ({...Track, id:String(Index)}));
			}
			const Streaming = Info.streaming_data;
			const Formats = [...(Streaming?.formats ?? []), ...(Streaming?.adaptive_formats ?? [])].filter(Format => !Format.drm_families?.length && !Format.drm_track_type && !Format.fair_play_key_uri && !Format.is_type_otf && (Transport === 'sabr' || Format.url || Format.signature_cipher || Format.cipher) && (Format.has_audio || Format.has_video));
			if (!Formats.length) Fail(Streaming?.server_abr_streaming_url ? 'youtube_sabr_unsupported' : 'youtube_no_clear_formats');
			let Sabr;
			if (Transport === 'sabr')
			{
				const Url = new URL(Streaming?.server_abr_streaming_url ?? 'about:blank');
				if (Url.protocol !== 'https:' || !Url.hostname.endsWith('.googlevideo.com')) Fail('youtube_unexpected_host');
				const Config = Info.player_config?.media_common_config?.media_ustreamer_request_config?.video_playback_ustreamer_config;
				if (typeof Config !== 'string' || !Config.length || Config.length > 1024 * 1024) Fail('youtube_sabr_config_missing');
				if (!Number.isFinite(Info.basic_info.duration) || Info.basic_info.duration <= 0) Fail('youtube_session_changed');
				Sabr = {videoId: Identity.videoId, title: Info.basic_info.title ?? '', duration: Info.basic_info.duration, url: Url.href, ustreamerConfig: Config, formats: Formats, clientInfo: Profile.clientInfo};
			}
			const SessionKey = crypto.randomUUID();
			Sessions.set(SessionKey, {tube: Tube, videoId: Identity.videoId, formats: Formats, created: Date.now(), sabr: Sabr, captions: CaptionTracks});
			while (Sessions.size > 8) Sessions.delete(Sessions.keys().next().value);
			return {...Identity, ...(Sabr ? {transport: 'sabr'} : {}), title: Info.basic_info.title ?? '', duration: Info.basic_info.duration,
				captions: CaptionTracks.map(({url: _Url, identity: _Identity, ...Track}) => Track),
				thumbnail: Info.basic_info.thumbnail?.[0]?.url, sessionKey: SessionKey,
				formats: Formats.map((Format, Index) => ({id: Sabr ? `${Format.itag}:${Index}` : String(Format.itag), kind: Format.has_video ? Format.has_audio ? 'muxed' : 'video' : 'audio',
					container: Format.mime_type?.split(';')[0].split('/')[1], codecs: Format.mime_type?.match(/codecs="([^"]+)"/)?.[1].split(',').map(Value => Value.trim()) ?? [],
					width: Format.width, height: Format.height, fps: Format.fps, bitrate: Format.bitrate, contentLength: Format.content_length, language: Format.language}))};
		},
		async ResolveYoutubeCaptions({sessionKey: Key, videoId: Id}, Signal = new AbortController().signal)
		{
			if (!CanUseYoutube()) Fail('youtube_distribution_disabled');
			Signal.throwIfAborted();
			const Session = Sessions.get(Key);
			if (!Session || Session.videoId !== Id || Date.now() - Session.created > 30 * 60 * 1000) Fail('youtube_session_changed');
			await Permission('https://www.youtube.com/');
			for (const Track of Session.captions)
			{
				const Url = new URL(Track.url);
				if (Number(Url.searchParams.get('expire') || Infinity) * 1000 <= Date.now() + 30000) Fail('youtube_url_expired');
				await Permission(Track.url); Signal.throwIfAborted();
			}
			return Session.captions.map(Track => ({...Track}));
		},
		async ResolveYoutubeSelection({sessionKey: Key, videoId: Id, selection: Selection}, Signal = new AbortController().signal)
		{
			if (!CanUseYoutube()) Fail('youtube_distribution_disabled');
			Signal.throwIfAborted();
			const Session = Sessions.get(Key);
			if (!Session || Session.videoId !== Id || Date.now() - Session.created > 30 * 60 * 1000) Fail('youtube_session_changed');
			await Permission('https://www.youtube.com/');
			if (Session.sabr)
			{
				const VideoIndex = Session.formats.findIndex((Format, Index) => `${Format.itag}:${Index}` === Selection.videoFormatId && Format.has_video);
				const AudioIndex = Session.formats.findIndex((Format, Index) => `${Format.itag}:${Index}` === Selection.audioFormatId && Format.has_audio && !Format.has_video);
				const Video = Session.formats[VideoIndex], Audio = Session.formats[AudioIndex];
				if (!Video || !Audio || !Video.mime_type?.includes('avc1') || !Audio.mime_type?.includes('mp4a')) Fail('youtube_format_unavailable');
				let Url;
				try { Url = new URL(await Session.tube.session.player.decipher(Session.sabr.url)); }
				catch (ErrorValue) { if (ErrorValue instanceof YoutubeError) throw ErrorValue; Fail('youtube_evaluator_failed'); }
				if (Url.protocol !== 'https:' || !Url.hostname.endsWith('.googlevideo.com')) Fail('youtube_unexpected_host');
				if (Number(Url.searchParams.get('expire') || Infinity) * 1000 <= Date.now() + 30000) Fail('youtube_url_expired');
				await Permission(Url.href); Signal.throwIfAborted();
				return {transport: 'sabr', config: {...Session.sabr, url: Url.href}, selection: {video: Video.itag, audio: Audio.itag, videoFormatIndex: VideoIndex, audioFormatIndex: AudioIndex}};
			}
			const Tracks = [];
			for (const [Kind, FormatId] of [['video', Selection.videoFormatId], ['audio', Selection.audioFormatId]])
			{
				if (!FormatId) continue;
				const Format = Session.formats.find(Item => String(Item.itag) === FormatId && (Kind === 'video' ? Item.has_video : Item.has_audio));
				if (!Format) Fail('youtube_format_unavailable');
				let Url;
				try { Url = new URL(await Format.decipher(Session.tube.session.player)); }
				catch (ErrorValue) { if (ErrorValue instanceof YoutubeError) throw ErrorValue; Fail('youtube_evaluator_failed'); }
				if (Url.protocol !== 'https:' || !(Url.hostname === 'googlevideo.com' || Url.hostname.endsWith('.googlevideo.com'))) Fail('youtube_unexpected_host');
				if (Url.searchParams.get('sabr') === '1') Fail('youtube_sabr_unsupported');
				if (Number(Url.searchParams.get('expire') || Infinity) * 1000 <= Date.now() + 30000) Fail('youtube_url_expired');
				await Permission(Url.href);
				Tracks.push({kind: Format.has_video && Format.has_audio ? 'muxed' : Kind, url: Url.href, formatId: FormatId, contentLength: Format.content_length, mimeType: Format.mime_type});
			}
			Signal.throwIfAborted();
			if (!Tracks.length) Fail('youtube_format_unavailable');
			return {tracks: Tracks};
		},
		dispose() { Sessions.clear(); },
	};
}
