import {CanUseYoutube} from '../../lib/distribution-policy.js';
import {IdentifyYoutubeUrl} from '../../lib/youtube-source-policy.js';
import {CreateEvaluator, YoutubeError} from './evaluator.js';
const Fail = Code => {throw new YoutubeError(Code);};
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
		async DiscoverYoutube({pageUrl: PageUrl}, Signal = new AbortController().signal)
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
			const Streaming = Info.streaming_data;
			const Formats = [...(Streaming?.formats ?? []), ...(Streaming?.adaptive_formats ?? [])].filter(Format => !Format.drm_families?.length && !Format.drm_track_type && !Format.fair_play_key_uri && !Format.is_type_otf && (Format.url || Format.signature_cipher || Format.cipher) && (Format.has_audio || Format.has_video));
			if (!Formats.length) Fail(Streaming?.server_abr_streaming_url ? 'youtube_sabr_unsupported' : 'youtube_no_clear_formats');
			const SessionKey = crypto.randomUUID();
			Sessions.set(SessionKey, {tube: Tube, videoId: Identity.videoId, formats: Formats, created: Date.now()});
			while (Sessions.size > 8) Sessions.delete(Sessions.keys().next().value);
			return {...Identity, title: Info.basic_info.title ?? '', duration: Info.basic_info.duration,
				thumbnail: Info.basic_info.thumbnail?.[0]?.url, sessionKey: SessionKey,
				formats: Formats.map(Format => ({id: String(Format.itag), kind: Format.has_video ? Format.has_audio ? 'muxed' : 'video' : 'audio',
					container: Format.mime_type?.split(';')[0].split('/')[1], codecs: Format.mime_type?.match(/codecs="([^"]+)"/)?.[1].split(',').map(Value => Value.trim()) ?? [],
					width: Format.width, height: Format.height, fps: Format.fps, bitrate: Format.bitrate, contentLength: Format.content_length, language: Format.language}))};
		},
		async ResolveYoutubeSelection({sessionKey: Key, videoId: Id, selection: Selection}, Signal = new AbortController().signal)
		{
			if (!CanUseYoutube()) Fail('youtube_distribution_disabled');
			Signal.throwIfAborted();
			const Session = Sessions.get(Key);
			if (!Session || Session.videoId !== Id || Date.now() - Session.created > 30 * 60 * 1000) Fail('youtube_session_changed');
			await Permission('https://www.youtube.com/');
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
