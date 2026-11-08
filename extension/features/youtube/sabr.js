import {CanUseYoutube} from '../../lib/distribution-policy.js';
import {YoutubeError} from './evaluator.js';
const Fail = Code => {throw new YoutubeError(Code);};
/** 일반 공개 watch 응답의 데이터만 사용하며 페이지 코드는 실행하지 않습니다. */
export function NormalizeWatchPlayer(Player, VideoId, Client = {})
{
	if (Player?.videoDetails?.videoId !== VideoId) Fail('youtube_session_changed');
	if (Player.playabilityStatus?.status !== 'OK' || Player.videoDetails.isLive || Player.videoDetails.isUpcoming) Fail('youtube_restricted');
	const Url = new URL(Player.streamingData?.serverAbrStreamingUrl ?? 'about:blank');
	if (Url.protocol !== 'https:' || !(Url.hostname === 'googlevideo.com' || Url.hostname.endsWith('.googlevideo.com'))) Fail('youtube_unexpected_host');
	const Config = Player.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig;
	if (typeof Config !== 'string' || !Config.length || Config.length > 1024 * 1024) Fail('youtube_sabr_config_missing');
	const Formats = (Player.streamingData?.adaptiveFormats ?? []).filter(Format => !Format.drmFamilies?.length && !Format.drmTrackType && !Format.fairPlayKeyUri);
	return {videoId: VideoId, title: Player.videoDetails.title ?? '', duration: Number(Player.videoDetails.lengthSeconds), url: Url.href,
		ustreamerConfig: Config, formats: Formats, clientInfo: {clientName: 1, clientVersion: Client.clientVersion ?? ''}};
}

/** SABR/UMP의 영상·음성 출력을 독립 파일에 순서대로 씁니다. 실패한 출력을 저장 완료로 올리지 않습니다. */
export async function ReceiveSabrTracks(Config, Selection, {createStream, createWriter, fetch: Fetch = globalThis.fetch, hasPermission = async () => false,
	signal: Signal = new AbortController().signal, report = () => {}, limit: Limit = 16 * 1024 ** 3, keepReceivedOnFailure: KeepReceived = false} = {})
{
	if (!CanUseYoutube()) Fail('youtube_distribution_disabled');
	Signal.throwIfAborted();
	const Factory = createStream ?? (await import('../../vendor/youtube/sabr-bundle.mjs')).CreateSabrStream;
	const Bytes = {video: 0, audio: 0};
	let Failure;
	let PendingAttestations = 0;
	let AttestationBytes = -1;
	const Receiver = Factory(Config, async (Input, Init) =>
	{
		Signal.throwIfAborted();
		const RequestValue = new Request(Input, Init), Url = new URL(RequestValue.url);
		if (Url.protocol !== 'https:' || !(Url.hostname === 'googlevideo.com' || Url.hostname.endsWith('.googlevideo.com'))) Fail('youtube_unexpected_host');
		if (!await hasPermission(Url.origin)) Fail('youtube_permission_denied');
		const Response = await Fetch(new Request(RequestValue, {redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([Signal, RequestValue.signal, AbortSignal.timeout(30000)])}));
		report({stage: 'sabr-http', status: Response.status});
		if (!Response.ok) {await Response.body?.cancel(); Fail(Response.status === 403 ? 'youtube_automated_request_rejected' : 'youtube_network_failed');}
		return Response;
	});
	Receiver.on('streamProtectionStatusUpdate', Status =>
	{
		report({stage: 'sabr-protection', status: Status.status});
		const Received = Bytes.video + Bytes.audio;
		PendingAttestations = Received > AttestationBytes ? 0 : PendingAttestations + 1;
		AttestationBytes = Received;
		if (Status.status === 3 || (Status.status === 2 && (!Config.poToken || PendingAttestations > 3))) {Failure = new YoutubeError('youtube_sabr_attestation_required'); void Receiver.abort();}
	});
	Receiver.on('error', ErrorValue => {Failure ??= ErrorValue instanceof YoutubeError ? ErrorValue : new YoutubeError('youtube_sabr_receive_failed');});
	const Abort = () => {void Receiver.abort();};
	Signal.addEventListener('abort', Abort, {once: true});
	const Writers = [];
	let Copies = [];
	let Reserved = 0;
	try
	{
		const ExactFormat = Kind =>
		{
			const Index = Selection[Kind + 'FormatIndex'];
			if (Index !== undefined)
			{
				if (!Number.isInteger(Index) || Index < 0 || Config.formats[Index]?.itag !== Selection[Kind] || Receiver.formats?.[Index]?.itag !== Selection[Kind]) Fail('youtube_format_unavailable');
				return Receiver.formats[Index];
			}
			if (Config.formats.filter(Format => Format.itag === Selection[Kind]).length > 1) Fail('youtube_format_unavailable');
			return Selection[Kind];
		};
		const Started = Receiver.start({videoFormat: ExactFormat('video'), audioFormat: ExactFormat('audio'), isPostLiveDvr: false, maxRetries: 0});
		Copies = ['video', 'audio'].map(async Kind =>
		{
			const Writer = await createWriter(Kind); Writers.push(Writer);
			const Reader = Started[Kind + 'Stream'].getReader();
			try
			{
				for (;;)
				{
					Signal.throwIfAborted(); if (Failure) throw Failure;
					const {value: Chunk, done: Done} = await Reader.read(); if (Done) break;
					if (Chunk.byteLength > 32 * 1024 ** 2 || Reserved + Chunk.byteLength > Limit) Fail('youtube_sabr_size_limit');
					Reserved += Chunk.byteLength;
					await Writer.write(Chunk); Bytes[Kind] += Chunk.byteLength;
					report({stage: 'sabr-bytes', video: Bytes.video, audio: Bytes.audio});
				}
				if (Failure) throw Failure;
				if (!Bytes[Kind]) Fail('youtube_sabr_receive_failed');
			}
			finally {Reader.releaseLock();}
		});
		await Promise.all(Copies);
		for (const Kind of ['video', 'audio'])
		{
			const Format = Started.selectedFormats?.[Kind + 'Format'] ?? Config.formats.find(Item => Item.itag === Selection[Kind]);
			const Precise = Number(Format?.approxDurationMs ?? Format?.approx_duration_ms);
			const PageDuration = Config.duration * 1000;
			if (Precise > 0 && Number.isFinite(PageDuration) && Math.abs(Precise - PageDuration) > 1000) Fail('youtube_sabr_receive_failed');
			const ExpectedEnd = Precise > 0 ? Precise - 250 : PageDuration - (Number.isInteger(Config.duration) ? 500 : 250);
			if (Number.isFinite(ExpectedEnd) && (!Number.isFinite(Receiver[Kind + 'EndTimeMs']) || Receiver[Kind + 'EndTimeMs'] < ExpectedEnd)) Fail('youtube_sabr_receive_failed');
		}
		await Promise.all(Writers.map(Writer => Writer.close()));
		return {bytes: Bytes, selectedFormats: Started.selectedFormats};
	}
	catch (ErrorValue)
	{
		await Receiver.abort(); await Promise.allSettled(Copies);
		await Promise.allSettled(Writers.map(Writer => KeepReceived ? Writer.close() : Writer.abort()));
		Signal.throwIfAborted();
		throw Failure ?? (ErrorValue instanceof YoutubeError ? ErrorValue : new YoutubeError('youtube_sabr_receive_failed'));
	}
	finally {Signal.removeEventListener('abort', Abort);}
}
