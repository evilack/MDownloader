import { DebugLog } from './lib/debug-log.js';
/**
 * 다운로드 작업의 등록, 상태 변경, 삭제를 담당합니다. 저장한 작업 ID는 앱의 식별자이고 Chrome이 발급한 다운로드 ID와 별개입니다.
 * 작업 데이터는 브라우저 저장소에 남깁니다. 현재 실행 중인 요청만 메모리에서 합쳐 같은 작업이 중복 등록되는 것을 막습니다.
 */
import { RuntimePolicy, InternalMediaOrigin } from './lib/runtime-policy.js';
import { ClassifyResponseMedia, HostPattern, IsStreamFormat, StreamPreviewPath } from './lib/media.js';
import { NormalizeDownloadFolder, SafeFilename } from './lib/download-folder.js';
import { RecordDownloadLog } from './lib/download-log.js';
import { LocalizedError, MessageRef, SerializeError } from './lib/i18n.js';
import { ReadCandidateThumbnail, ResolveCandidate, CaptureResolvedCandidatePreview } from './detection.js';
import {
	IsHlsActive, ActiveTransfers, CancelHls, FinishLive, SavePartialHls, LaunchDirectToFolder, LaunchHls, LaunchPlaybackHls, RequireHlsHosts,
} from './hls-jobs.js';
import { KnownMasterDenial, SaveTransferTrace } from './lib/hls-diagnostics.js';
import { HlsRequestSource, SetHlsRequestRules, SetScopedHlsRequestRules } from './lib/hls-request-context.js';
import { DeleteStoredJob, JobKey, ListStoredJobs, ReadJob, WriteJob } from './lib/job-storage.js';
import { GetSetting, GetSettings, SettingKeys } from './lib/settings.js';
import { RequirePickedFolder } from './lib/picked-download-folder.js';
import { DeleteJobPreview, PreviewSourceKey, SaveJobPreviewSource, SaveJobThumbnail, ReadJobThumbnail } from './lib/job-preview-cache.js';
import { DownloadNamedFile } from './lib/browser-download.js';
import { GetBrowserDownload, JobGroup, LoadBrowserDownloads, SummarizeJob } from './lib/browser-job-state.js';
import {PartialFilename, PartialOutputFilename} from './lib/partial-naming.js';
import {CanFinishJob} from './lib/job-actions.js';
import {RevealPickedMedia} from './lib/explorer-bridge.js';
import {LocalMediaUrl} from './lib/saved-media.js';
import {LaunchWebRtc, ControlWebRtc, ForgetWebRtcControl} from './webrtc-jobs.js';
import {AssertMediaAllowed, AssertJobMayRestart, IsYoutubeSource} from './lib/youtube-source-policy.js';
import {RequirePlaybackAuthorization} from './lib/playback-authorization.js';
import {DiscoverSubtitles} from './lib/subtitle-discovery.js';
import {SubtitleStatus, ValidateSubtitleStatus} from './lib/subtitle-status.js';
import {SelectSubtitleTracks} from './lib/download-options-selection.js';
import {ResolveYoutubeSelection, CancelYoutube, FinishYoutube, SavePartialYoutube} from './features/youtube/entry.js';
const Pending = new Map();
const Removing = new Set();
const PendingSnapshots = new Set();
async function RegisterMediaJob(Key, Job, TabId, Candidate, PreparePreview = true)
{
	const {subtitleTranslation: StoredSettings = {}} = await chrome.storage.local.get('subtitleTranslation');
	const Settings = Job.subtitleOptions?.translation ?? StoredSettings;
	Job.subtitleStatus = {...SubtitleStatus(Candidate.subtitles || [], Settings), completed:0};
	if (Job.youtube && Job.subtitleOptions?.trackIds.length)
		Job.subtitleStatus = {...SubtitleStatus(Job.subtitleOptions.trackIds.map(() => ({language:'und'})), Settings), completed:0};
	Object.assign(Job, {sourcePolicyVersion: 1, youtubeSource: IsYoutubeSource({pageUrl: Candidate.page, frameUrl: Candidate.previewPage ?? Candidate.initiator, mediaUrl: Candidate.url})});
	await WriteJob(Key, Job);
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('JobRegistered', () => ({ requestId: Job.requestId, tabId: TabId }));
	}
	if (PreparePreview) void PrepareJobPreview(Job, TabId, Candidate).catch(() =>
	{
	});
}

async function PrepareJobPreview(Job, TabId, Candidate)
{
	const bProtectedRequest = !!Candidate.requestContext || !!Candidate.observedVariants?.length;
	const Source = { format: Candidate.format, protectedRequest: bProtectedRequest, streamPath: StreamPreviewPath(Candidate.url, Candidate.format) };
	if (Candidate.format === 'YOUTUBE')
	{
		// The canonical watch URL identifies the source; it is never a playable URL.
		Source.pageCandidate = {tabId: TabId, item: {id: Candidate.id, url: Candidate.url, format: Candidate.format,
			page: Candidate.page, previewPage: Candidate.previewPage, documentId: Candidate.documentId, singleStream: true}};
	}
	else if (!bProtectedRequest)
	{
		Source.url = Candidate.url;
	}
	// 서명된 주소는 브라우저 세션에만 둡니다.
	// 재시작 후 기록을 읽을 때 필요한 작은 썸네일과 미리보기 샘플만 디스크에 남깁니다.
	const StillRegistered = () => ReadJob(JobKey(Job.requestId));
	if (!await SaveJobPreviewSource(Job.requestId, Source, StillRegistered).catch(() => false))
	{
		return;
	}
	const Preview = await ReadCandidateThumbnail(TabId, Candidate);
	if ((!Preview && !Candidate.recordingResolution) || !await ReadJob(JobKey(Job.requestId)))
	{
		return;
	}
	const { still: Still, duration: Duration } = Preview ?? {};
	const Resolution = Candidate.recordingResolution ?? Preview?.resolution;
	const Frame = Still?.startsWith('data:image/jpeg;base64,') ? Still : undefined;
	if (/^https?:\/\//i.test(Still))
	{
		await SaveJobPreviewSource(Job.requestId, { ...Source, still: Still }, StillRegistered).catch(() =>
		{
		});
	}
	if (Frame || Number.isFinite(Duration) || Resolution)
	{
		await SaveJobThumbnail(Job.requestId, { still: Frame, duration: Duration, resolution: Resolution }, StillRegistered);
	}
	await chrome.runtime.sendMessage({ type: 'jobPreviewReady', requestId: Job.requestId });
}

async function DownloadTarget(Name, PageTitle, PageUrl)
{
	const { usePageTitle: UsePageTitle, useDownloadDateTime: UseDownloadDateTime, downloadFolder: DownloadFolder, pickedDownloadFolder: PickedDownloadFolder } = await GetSettings([
		SettingKeys.usePageTitle, SettingKeys.useDownloadDateTime, SettingKeys.downloadFolder, SettingKeys.pickedDownloadFolder,
	]);
	if (PickedDownloadFolder)
	{
		await RequirePickedFolder(PickedDownloadFolder);
	}
	return {
		// 등록 시 한 번만 정합니다. 라이브 종료·재시도·MP4 저장 때 이름과 시각이 달라지지 않습니다.
		filename: SafeFilename(Name, UsePageTitle ? PageTitle : undefined, UseDownloadDateTime ? new Date() : undefined, '.mp4', PageUrl),
		downloadFolder: DownloadFolder, ...(PickedDownloadFolder ? { pickedDownloadFolder: PickedDownloadFolder } : {}),
	};
}

async function SaveDownload(Url, Job)
{
	// 이전 버전에서 저장한 작업에 폴더 값이 없거나 표기가 다를 수 있어 저장 직전에 정규화합니다.
	const Folder = NormalizeDownloadFolder(Job.downloadFolder);
	const Filename = Folder ? `${Folder}/${Job.filename}` : Job.filename;
	const DownloadId = await DownloadNamedFile(Url, Filename);
	await RecordDownloadLog('started', { requestId: Job.requestId, downloadId: DownloadId, stage: 'browser-save' });
	return DownloadId;
}

export function Enqueue(Input)
{
	return EnqueueOnce(Input.requestId, Key => StartJob(Key, Input));
}

export async function EnqueuePlayback({ requestId: RequestId, playlist: Playlist, count: Count, bytes: Bytes, pageTitle: PageTitle, pageUrl: PageUrl })
{
	const PlaybackSource = await RequirePlaybackAuthorization(RequestId);
	if (typeof Playlist !== 'string' || Playlist.length > RuntimePolicy.Transfer.MaxPlaylistBytes ||
	!Number.isInteger(Count) || Count < 1 || Count > RuntimePolicy.Transfer.MaxSegments ||
	!Number.isSafeInteger(Bytes) || Bytes < 1 || Bytes > RuntimePolicy.Transfer.MaxStreamScratchBytes)
	{
		throw new LocalizedError('job_invalid_capture');
	}
	return EnqueueOnce(RequestId, async Key =>
	{
		if (await ReadJob(Key))
		{
			return;
		}
		await RecordDownloadLog('started', { requestId: RequestId });
		const Job = {
			requestId: RequestId, ...await DownloadTarget(undefined, PageTitle, PageUrl), created: Date.now(), state: 'active',
			sourcePolicyVersion: 1, youtubeSource: false, subtitleCount: PlaybackSource?.subtitles?.length ?? 0,
			hls: true, bytesReceived: Bytes, finished: Count, count: Count, muxing: true,
		};
		await WriteJob(Key, Job);
		try
		{
			await LaunchPlaybackHls(Job, { playlist: Playlist, count: Count, bytes: Bytes }, PlaybackSource?.subtitles);
		}
		catch (ErrorValue)
		{
			await DeleteStoredJob(Key);
			throw ErrorValue;
		}
	});
}

function EnqueueOnce(RequestId, Start)
{
	if (!/^[a-f\d-]{36}$/i.test(RequestId))
	{
		throw new LocalizedError('job_invalid_request');
	}
	const Key = JobKey(RequestId);
	if (!Pending.has(Key))
	{
		const Task = Start(Key).catch(async ErrorValue =>
		{
			await RecordDownloadLog('failed', { requestId: RequestId, reason: ErrorValue instanceof LocalizedError ? ErrorValue.key : undefined });
			throw ErrorValue;
		}).finally(() => Pending.delete(Key));
		Pending.set(Key, Task);
	}
	return Pending.get(Key);
}

async function StartJob(Key, { tabId: TabId, scanId: ScanId, candidateId: CandidateId, requestId: RequestId, variantUrl: VariantUrl, quality: Quality, scope: Scope, subtitleOptions: SubtitleOptions })
{
	const Existing = await ReadJob(Key);
	if (Existing)
	{
		return { state: Existing.downloadId !== undefined || Existing.state === 'active' ? 'started' : Existing.state };
	}

	await RecordDownloadLog('started', { requestId: RequestId });
	const Item = await ResolveCandidate(TabId, ScanId, CandidateId, Scope);
	if (SubtitleOptions)
	{
		const T = SubtitleOptions.translation;
		if (!Array.isArray(SubtitleOptions.trackIds) || SubtitleOptions.trackIds.length > 128 || !T || typeof T.enabled !== 'boolean' ||
			!['targetLanguage','sourceLanguage'].every(K => typeof T[K] === 'string' && /^[a-z0-9-]{1,35}$/i.test(T[K])) ||
			!['deepl','google','azure','gemini','deepseek','openai','kakao'].includes(T.provider) ||
			!['model','effort'].every(K => typeof T[K] === 'string' && T[K].length <= 200)) throw new LocalizedError('subtitle_invalid');
	}
	AssertMediaAllowed(Item);
	if (VariantUrl) AssertMediaAllowed({url: VariantUrl});
	if (Item.format === 'YOUTUBE')
	{
		const Job = {requestId: RequestId, mediaKey: Item.mediaKey, ...await DownloadTarget(undefined, Item.pageTitle, Item.page),
			created: Date.now(), state: 'active', youtube: true, bytesReceived: 0, waiting: !!Quality?.scheduled, live: !!Quality?.live,
			includeYoutubeAutoCaptions: await GetSetting(SettingKeys.includeYoutubeAutoCaptions), ...(SubtitleOptions ? {subtitleOptions: SubtitleOptions} : {})};
		await RegisterMediaJob(Key, Job, TabId, Item);
		try { await ResolveYoutubeSelection(Job, Item, Quality); }
		catch (ErrorValue) { await WriteJob(Key, {...Job, state: 'failed', error: SerializeError(ErrorValue)}); throw ErrorValue; }
		await OpenDebugView(RequestId); return {state: 'started'};
	}
	// 자막 주소는 이 등록 호출과 전송 문서 안에서만 유지합니다. 영속 기록에는 개수만 남깁니다.
	const ManifestSubtitles = (VariantUrl ? Item.qualities?.find(Value => Value.url === VariantUrl) : Item.qualities?.[0])?.subtitles ?? [];
	let Subtitles = [...ManifestSubtitles, ...await DiscoverSubtitles(TabId, Item)];
	// HLS/DASH sources are complete only after the runner resolves the chosen manifest.
	if (SubtitleOptions && !IsStreamFormat(Item.format)) Subtitles = await SelectSubtitleTracks(Subtitles, SubtitleOptions.trackIds, SubtitleOptions.translation);
	Item.subtitles = Subtitles;
	if (Item.format === 'WEBRTC')
	{
		const Job = {requestId: RequestId, mediaKey: Item.mediaKey, ...await DownloadTarget(undefined, Item.pageTitle, Item.page),
			created: Date.now(), state: 'active', recording: true, live: true, bytesReceived: 0, finished: 0, subtitleCount: Subtitles.length, ...(SubtitleOptions ? {subtitleOptions: SubtitleOptions} : {})};
		await RegisterMediaJob(Key, Job, TabId, Item, false);
		try
		{
			const Started = await LaunchWebRtc(Job, Item, TabId, Quality);
			const Resolution = Started.width > 0 && Started.height > 0 ? `${Started.width}x${Started.height}` : undefined;
			void PrepareJobPreview(Job, TabId, {...Item, recordingResolution: Resolution}).catch(() => {});
		}
		catch (ErrorValue)
		{
			if (ErrorValue.name === 'AbortError')
			{
				await WriteJob(Key, {...await ReadJob(Key), state: 'canceled'});
				return {state: 'canceled'};
			}
			await WriteJob(Key, {...await ReadJob(Key), state: 'failed', error: SerializeError(ErrorValue)});
			throw ErrorValue;
		}
		await OpenDebugView(RequestId);
		return {state: 'started'};
	}
	if (IsStreamFormat(Item.format))
	{
		const Observed = VariantUrl === undefined ? Item.observedVariants?.[0]
		: Item.observedVariants?.find(Variant => Variant.url === VariantUrl);
		const Source = Observed ?? Item;
		const Job = {
			requestId: RequestId, mediaKey: Item.mediaKey,
			...await DownloadTarget(Item.name.replace(/\.(m3u8|mpd)$/i, '') + '.mp4', Item.pageTitle, Item.page),
			created: Date.now(), state: 'active', hls: true, bytesReceived: 0, finished: 0, subtitleCount: Subtitles.length, ...(SubtitleOptions ? {subtitleOptions: SubtitleOptions} : {}),
			// 감지 단계에서 확인한 라이브는 첫 진행 응답 전에도 관리자에 표시합니다.
			...(typeof Item.live === 'boolean' ? {live: Item.live} : {}),
		};
		const Denial = await KnownMasterDenial(HlsRequestSource(Source.url, Source.requestContext));
		if (Denial)
		{
			await RegisterMediaJob(Key, {
				...Job, state: 'failed', error: MessageRef('job_playlist_denied'),
				diagnostic: { ...Denial, fromPreviousAttempt: true },
			}, TabId, Item);
			await RecordDownloadLog('failed', {
				requestId: RequestId, stage: Denial.stage, status: Denial.status, reason: 'job_playlist_denied',
			});
			await OpenDebugView(RequestId);
			return { state: 'failed' };
		}
		await RegisterMediaJob(Key, Job, TabId, Item);
		try
		{
			await LaunchHls(Job, Source.url, Observed ? undefined : VariantUrl, Source.requestContext, Item.format, Subtitles);
		}
		catch (ErrorValue)
		{
			await WriteJob(Key, { ...Job, state: 'failed', error: SerializeError(ErrorValue) });
			throw ErrorValue;
		}
		await OpenDebugView(RequestId);
		return { state: 'started' };
	}
	const Job = {
		requestId: RequestId, mediaKey: Item.mediaKey, ...await DownloadTarget(Item.name, Item.pageTitle, Item.page), created: Date.now(), state: 'starting', ...(SubtitleOptions ? {subtitleOptions: SubtitleOptions} : {}),
	};
	if (Job.pickedDownloadFolder || Subtitles.length)
	{
		await RequireHlsHosts([Item.url]);
		const FolderJob = { ...Job, state: 'active', ...(Subtitles.length ? {subtitleMux: true, subtitleCount: Subtitles.length} : {}) };
		await RegisterMediaJob(Key, FolderJob, TabId, Item);
		try
		{
			await LaunchDirectToFolder(FolderJob, Item.url, Subtitles);
		}
		catch (ErrorValue)
		{
			await WriteJob(Key, { ...FolderJob, state: 'failed', error: SerializeError(ErrorValue) });
			throw ErrorValue;
		}
		return { state: 'started' };
	}
	await RegisterMediaJob(Key, Job, TabId, Item);
	let DownloadId;
	try
	{
		DownloadId = await SaveDownload(Item.url, Job);
	}
	catch
	{
		await WriteJob(Key, { ...Job, state: 'failed', error: MessageRef('job_browser_start_failed') });
		await RecordDownloadLog('failed', { requestId: RequestId, reason: 'job_browser_start_failed' });
		return { state: 'failed' };
	}
	await WriteJob(Key, { ...Job, downloadId: DownloadId, state: 'started' });
	return { state: 'started' };
}

async function OpenDebugView(RequestId)
{
	try
	{
		if (!await GetSetting(SettingKeys.debugDownloads))
		{
			return;
		}
		const Url = new URL(chrome.runtime.getURL('sidepanel.html'));
		Url.searchParams.set('debug', '1');
		Url.searchParams.set('job', RequestId);
		await chrome.tabs.create({ url: Url.href });
	}
	catch (ErrorValue)
	{
		if (DebugLog.IsEnabled())
		{
			DebugLog.Record('DebugViewFailed', () => ({ error: ErrorValue }));
		}
	}
}

export async function UpdateHls(Message)
{
	const Key = JobKey(Message.requestId);
	const Job = await ReadJob(Key);
	if (!Job?.hls && !Job?.recording && !Job?.youtube && !Job?.pickedDownloadFolder && !Job?.subtitleMux)
	{
		throw new LocalizedError('job_hls_not_found');
	}
	if (Message.action === 'recordingReleased' && Job.recording) return ForgetWebRtcControl(Job.requestId);
	if (Message.action === 'previewAccess')
	{
		return true;
	}
	if (Message.action === 'partialStarted' && Job.snapshot && Job.state === 'starting')
	{
		return WriteJob(Key, {...Job, state: 'active'});
	}
	if (Message.action === 'diagnostic')
	{
		const Diagnostic = Message.diagnostic.events.at(-1);
		await Promise.all([
			SaveTransferTrace(Message.diagnostic),
			WriteJob(Key, { ...Job, diagnostic: Diagnostic }),
			RecordDownloadLog(Diagnostic.result, {
				requestId: Job.requestId, stage: Diagnostic.stage, status: Diagnostic.status,
			}),
		]);
		return;
	}
	if (Message.action === 'clearRequestHeaders')
	{
		return SetHlsRequestRules(undefined, [], Job.requestId);
	}
	if (Message.action === 'saving' || Message.action === 'cancelSave')
	{
		const Item = await GetBrowserDownload(Job.downloadId);
		if (Message.action === 'cancelSave' && Item?.state === 'in_progress')
		{
			await chrome.downloads.cancel(Item.id);
		}
		return Item?.state ?? 'missing';
	}
	if (Job.state !== 'active' || Job.downloadId !== undefined)
	{
		throw new LocalizedError('job_hls_wrong_state');
	}
	switch (Message.action)
	{
		case 'subtitleStatus':
		if (!ValidateSubtitleStatus(Message.status)) throw new LocalizedError('subtitle_invalid');
		return WriteJob(Key, {...Job, subtitleStatus: Message.status});
		case 'subtitleCount':
		if (!Number.isInteger(Message.count) || Message.count < 1 || Message.count > 128) throw new LocalizedError('subtitle_invalid');
		return WriteJob(Key, {...Job, subtitleCount: Message.count});
		case 'subtitleReady':
		if (!Number.isInteger(Message.count) || Message.count < 1) throw new LocalizedError('subtitle_invalid');
		const SubtitleFilename = PartialOutputFilename(Job.filename, '.mp4');
		await WriteJob(Key, {...Job, filename: SubtitleFilename, subtitleCount: Message.count,
			...(Number.isSafeInteger(Message.bytes) && Message.bytes > 0 ? {bytesReceived: Message.bytes} : {})});
		return SubtitleFilename;
		case 'youtubePartial':
		{
		if (!Job.youtube) throw new LocalizedError('job_hls_wrong_state');
		const Filename = Job.partial || Job.snapshot ? Job.filename : PartialFilename(Job.filename);
		await WriteJob(Key, {...Job, partial: true, filename: Filename, receipt: Message.receipt});
		return Filename;
		}
		case 'youtubeReceived':
		if (!Job.youtube) throw new LocalizedError('job_hls_wrong_state');
		return WriteJob(Key, {...Job, receipt: Message.receipt});
		case 'youtubeCaptions':
		if (!Job.youtube) throw new LocalizedError('job_hls_wrong_state');
		return WriteJob(Key, {...Job, captionReceipt: Message.receipt, subtitleCount: Message.receipt.count,
			subtitleStatus: {phase:['unavailable','not-selected'].includes(Message.receipt.phase) ? 'undetected' : Message.receipt.phase,
				count:Message.receipt.count,completed:Message.receipt.completed,languages:(Message.receipt.tracks ?? []).map(Track=>Track.language),targetLanguage:'',translation:'off'}});
		case 'streamPartial':
		if (!Job.hls || Job.snapshot || Job.muxing)
		{
			throw new LocalizedError('job_state_changed');
		}
		const Filename = Job.partial ? Job.filename : PartialFilename(Job.filename);
		await WriteJob(Key, {...Job, filename: Filename, partial: true});
		return Filename;
		case 'recordingFormat':
		{
			if (!Job.recording || !/^video\/(mp4|webm)(?:;|$)/.test(Message.mimeType)) throw new LocalizedError('job_hls_wrong_state');
			let Filename = PartialOutputFilename(Job.filename, Message.mimeType.startsWith('video/mp4') ? '.mp4' : '.webm');
			if (Message.partial && !Job.partial) Filename = PartialFilename(Filename);
			await WriteJob(Key, {...Job, filename: Filename, partial: !!Message.partial,
				recordingInterrupted: !!Message.partial, recordingEndReason: Message.reason,
				outputFormat: Message.mimeType.startsWith('video/mp4') ? 'MP4' : 'WEBM'});
			return Filename;
		}
		case 'access': return RequireHlsHosts(Message.urls);
		case 'requestHeaders':
		await RequireHlsHosts(Message.urls);
		return SetScopedHlsRequestRules(Message.context, Message.urls, Job.requestId);
		case 'progress': return WriteJob(Key, {
			...Job, bytesReceived: Message.received, finished: Message.finished,
			count: Message.count, muxing: !!Message.muxing, live: !!(Message.live ?? Job.live), waiting: !!Message.waiting, totalBytes: Message.totalBytes,
			snapshotAvailable: !!Message.snapshotAvailable,
		});
		case 'partialFormat':
		if (!Job.snapshot)
		{
			throw new LocalizedError('job_hls_wrong_state');
		}
		return WriteJob(Key, {...Job, filename: PartialOutputFilename(Job.filename, Message.extension), outputFormat: Message.extension.slice(1).toUpperCase()});
		case 'failure':
		{
			const State = Message.canceled ? 'canceled' : 'failed';
			await WriteJob(Key, { ...Job, state: State, error: Message.error });
			await RecordDownloadLog(State, {
				requestId: Job.requestId, reason: Message.error?.key,
				status: Message.error?.key === 'job_browser_error' ? Message.error.args?.[0] : undefined,
			});
			return;
		}
		case 'save':
		{
			if ((!Job.hls && !Job.recording && !Job.youtube && !Job.subtitleMux) || Job.pickedDownloadFolder || !Message.objectUrl.startsWith('blob:' + chrome.runtime.getURL('')))
			{
				throw new LocalizedError('job_invalid_mp4_url');
			}
			const DownloadId = await SaveDownload(Message.objectUrl, Job);
			await WriteJob(Key, { ...Job, downloadId: DownloadId, state: 'started' });
			return DownloadId;
		}
		case 'folderSaved':
		{
			if (!Job.pickedDownloadFolder)
			{
				throw new LocalizedError('job_hls_wrong_state');
			}
			await WriteJob(Key, {
				...Job, filename: Message.filename, bytesReceived: Message.bytes, totalBytes: Message.bytes,
				state: Job.recordingInterrupted ? 'interrupted' : 'complete', endTime: new Date().toISOString(), exists: true,
				error: Job.recordingInterrupted ? MessageRef('webrtc_interrupted_saved') : undefined,
			});
			await RecordDownloadLog('complete', { requestId: Job.requestId });
			return;
		}
		default: throw new LocalizedError('job_hls_unsupported');
	}
}

export async function ListJobs(RequestIds, LocalMediaKeys)
{
	if (LocalMediaKeys !== undefined && (!Array.isArray(LocalMediaKeys) || LocalMediaKeys.some(Key => typeof Key !== 'string' || !Key)))
	{
		throw new LocalizedError('job_invalid_request');
	}
	const Scope = LocalMediaKeys && new Set(LocalMediaKeys);
	if (Scope?.size === 0)
	{
		return [];
	}
	// 작업 등록, 전송 문서 응답, Chrome ID 발급은 각각 다른 시점에 도착할 수 있습니다.
	// 이 조회를 시작할 때 등록 중이었던 작업은 같은 스냅샷의 진행 중 상태로 처리합니다.
	const Registering = new Set(Pending.keys());
	const Stored = await ListStoredJobs(RequestIds);
	// 팝업에는 현재 후보의 작업만 필요하므로 먼저 추린 뒤 Chrome 다운로드 정보를 조회합니다.
	// 관리자에서는 저장된 전체 작업을 읽습니다.
	const Jobs = Scope ? Stored.filter(Job => Scope.has(Job.mediaKey)) : Stored;
	for (const Key of Pending.keys())
	{
		Registering.add(Key);
	}
	const bNeedsRunner = Jobs.some(Job => (Job.hls || Job.recording || Job.youtube || Job.pickedDownloadFolder || Job.subtitleMux) &&
	Job.state === 'active' && Job.downloadId === undefined &&
	!Registering.has(JobKey(Job.requestId)));
	const [Own, Runners] = await Promise.all([LoadBrowserDownloads(Jobs), bNeedsRunner ? ActiveTransfers() : undefined]);
	return Promise.all(Jobs.map(async Job =>
	{
		const Item = Own.get(Job.downloadId);
		const Summary = SummarizeJob(Job, Item, Runners, Registering.has(JobKey(Job.requestId)));
		if (Job.hls || Job.recording || Job.youtube || Job.snapshot || !['active', 'paused'].includes(Summary.state))
		{
			return Summary;
		}
		const Source = await DirectSnapshotSource(Job, Item);
		if (!Source)
		{
			return Summary;
		}
		const Origin = HostPattern(Source.url);
		const Allowed = await chrome.permissions.contains({origins: [Origin]});
		return {...Summary, snapshotAvailable: true, snapshotPermission: Allowed ? undefined : Origin};
	}));
}

export async function JobUrl(RequestId)
{
	const Job = await ReadJob(JobKey(RequestId));
	const Item = await GetBrowserDownload(Job?.downloadId);
	if (!Item || !/^https?:\/\//i.test(Item.url))
	{
		throw new LocalizedError('job_source_unknown');
	}
	return Item.url;
}

export async function PreviewJob(RequestId)
{
	if (typeof RequestId !== 'string' || !/^[a-f\d-]{36}$/i.test(RequestId))
	{
		throw new LocalizedError('job_invalid_request');
	}
	const Job = await ReadJob(JobKey(RequestId));
	if (!Job)
	{
		throw new LocalizedError('job_not_found');
	}
	const SourceKey = PreviewSourceKey(RequestId);
	const Source = (await chrome.storage.session.get(SourceKey))[SourceKey];
	AssertMediaAllowed({...Job, youtubeSource: Job.youtube || Job.youtubeSource}); AssertMediaAllowed(Source?.pageCandidate?.item);
	if (Job.pickedDownloadFolder && ['complete', 'interrupted'].includes(Job.state))
	{
		return {
			...Source, format: Job.outputFormat ?? (Job.hls ? 'MP4' : Source?.format) ??
			ClassifyResponseMedia(InternalMediaOrigin + '/' + encodeURIComponent(Job.filename), '')?.format,
			localFile: { folder: Job.pickedDownloadFolder, name: Job.filename },
		};
	}
	if (Job.youtube && Source?.pageCandidate)
	{
		const [Thumbnail] = await JobThumbnails([RequestId]);
		return {...Source, ...Thumbnail, url: undefined};
	}
	if (Source)
	{
		return Source;
	}
	const Item = await GetBrowserDownload(Job.downloadId);
	if (Item && !Job.hls && /^https?:\/\//i.test(Item.url))
	{
		return { url: Item.url, format: ClassifyResponseMedia(Item.url, Item.mime)?.format };
	}
	return {};
}

export async function JobThumbnails(RequestIds)
{
	if (!Array.isArray(RequestIds) || RequestIds.length > 128 || RequestIds.some(Id => typeof Id !== 'string' || !/^[a-f\d-]{36}$/i.test(Id))) throw new LocalizedError('job_invalid_request');
	return Promise.all(RequestIds.map(async Id =>
	{
		const Job = await ReadJob(JobKey(Id));
		if (!Job) return {id: Id};
		AssertMediaAllowed({...Job, youtubeSource: Job.youtube || Job.youtubeSource});
		const Key = PreviewSourceKey(Id), Source = (await chrome.storage.session.get(Key))[Key];
		AssertMediaAllowed(Source?.pageCandidate?.item);
		let Thumbnail = await ReadJobThumbnail(Id).catch(() => undefined);
		if (Job.youtube && Source?.pageCandidate && Job.state === 'active')
		{
			const {tabId: TabId, item: Item} = Source.pageCandidate;
			const Fresh = await ReadCandidateThumbnail(TabId, Item).catch(() => undefined);
			if (Fresh?.still)
			{
				Thumbnail = Fresh;
				if (Fresh.still.startsWith('data:image/jpeg;base64,')) await SaveJobThumbnail(Id, Fresh, () => ReadJob(JobKey(Id)));
			}
		}
		return {...Thumbnail, id: Id};
	}));
}

export async function CaptureJobPreview(RequestId)
{
	if (typeof RequestId !== 'string' || !/^[a-f\d-]{36}$/i.test(RequestId)) throw new LocalizedError('job_invalid_request');
	const Job = await ReadJob(JobKey(RequestId));
	if (!Job) throw new LocalizedError('job_not_found');
	AssertMediaAllowed({...Job, youtubeSource: Job.youtube || Job.youtubeSource});
	const Key = PreviewSourceKey(RequestId), Source = (await chrome.storage.session.get(Key))[Key];
	if (!Job.youtube || !Source?.pageCandidate) return null;
	return CaptureResolvedCandidatePreview(Source.pageCandidate.tabId, Source.pageCandidate.item);
}

export async function SavedLocation(RequestId)
{
	if (typeof RequestId !== 'string' || !/^[a-f\d-]{36}$/i.test(RequestId)) throw new LocalizedError('job_invalid_request');
	const Job = await ReadJob(JobKey(RequestId));
	if (!Job?.pickedDownloadFolder || !['complete', 'interrupted'].includes(Job.state) || !Job.exists) throw new LocalizedError('job_state_changed');
	AssertMediaAllowed({...Job, youtubeSource: Job.youtube || Job.youtubeSource});
	return {folder: Job.pickedDownloadFolder, name: Job.filename};
}

export async function RemoveJob(RequestId, DeleteFile, ExpectedGroup)
{
	const Key = JobKey(RequestId);
	if (Pending.has(Key) || Removing.has(Key))
	{
		throw new LocalizedError('job_busy');
	}

	Removing.add(Key);
	try
	{
		const Job = await ReadJob(Key);
		if (!Job)
		{
			if (ExpectedGroup)
			{
				return;
			}
			throw new LocalizedError('job_not_found');
		}
		const BrowserItem = ExpectedGroup ? await GetBrowserDownload(Job.downloadId) : undefined;
		// 클릭 이후 다른 화면에서 재개하거나 완료한 작업은 원래 섹션의 일괄 삭제에서 제외합니다.
		if (ExpectedGroup && JobGroup(SummarizeJob(Job, BrowserItem).state) !== ExpectedGroup)
		{
			return;
		}
		if (Job.hls || Job.recording || Job.youtube)
		{
			const bSaving = Job.downloadId === undefined ? Job.youtube ? (await ActiveTransfers()).youtubeIds?.includes(RequestId) : Job.recording ? (await ActiveTransfers()).recordingIds?.includes(RequestId) : await IsHlsActive(RequestId)
			: (ExpectedGroup ? BrowserItem : await GetBrowserDownload(Job.downloadId))?.state === 'in_progress';
			if (bSaving)
			{
				throw new LocalizedError('job_cancel_first');
			}
		}
		if ((Job.pickedDownloadFolder || Job.subtitleMux) && !Job.hls && (await ActiveTransfers()).directIds?.includes(RequestId))
		{
			throw new LocalizedError('job_cancel_first');
		}
		if (DeleteFile === true)
		{
			const Item = await GetBrowserDownload(Job.downloadId);
			if (!Item)
			{
				throw new LocalizedError('job_file_unknown');
			}
			if (Item.state !== 'complete')
			{
				throw new LocalizedError('job_delete_after_finish');
			}
			try
			{
				await chrome.downloads.removeFile(Item.id);
			}
			catch
			{
				throw new LocalizedError('job_delete_failed');
			}
		}
		await DeleteStoredJob(Key);
		await Promise.allSettled([
			DeleteJobPreview(RequestId),
		]);
	}
	finally
	{
		Removing.delete(Key);
	}
}

/** 눌렀을 때 그 섹션에 있던 기록만 삭제합니다. 한 항목에서 실패해도 나머지는 계속 처리합니다. */
export async function RemoveJobs(RequestIds, Group)
{
	if (!['attention', 'complete'].includes(Group) || !Array.isArray(RequestIds) ||
	RequestIds.some(Id => typeof Id !== 'string' || !Id))
	{
		throw new LocalizedError('job_invalid_request');
	}
	let FirstError;
	for (const Id of new Set(RequestIds))
	{
		try
		{
			await RemoveJob(Id, false, Group);
		}
		catch (ErrorValue)
		{
			FirstError ??= ErrorValue;
		}
	}
	if (FirstError)
	{
		throw FirstError;
	}
}

export async function ControlJob(RequestId, Action)
{
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('JobControlRequested', () => ({ requestId: RequestId, action: Action }));
	}
	const Job = await ReadJob(JobKey(RequestId));
	if (['show','play'].includes(Action) && Job?.pickedDownloadFolder)
	{
		const Location = await SavedLocation(RequestId);
		if (Action === 'show')
		{
			if((await chrome.runtime.getPlatformInfo()).os==='mac')return chrome.downloads.showDefaultFolder();
			return RevealPickedMedia(Location);
		}
		return chrome.tabs.create({url: chrome.runtime.getURL('saved-media.html') + '?job=' + encodeURIComponent(RequestId)});
	}
	if (Job?.youtube && Job.state === 'active' && Action === 'cancel' && await CancelYoutube(RequestId)) return;
	if (Job?.youtube && CanFinishJob(Job) && Action === 'finish' && await FinishYoutube(RequestId)) return;
	if (Job?.recording && Job.state === 'active' && ['finish', 'cancel'].includes(Action) && await ControlWebRtc(RequestId, Action)) return;
	if (Action === 'snapshot')
	{
		return SaveCurrentJob(Job);
	}
	if (!Job?.youtube && CanFinishJob(Job) && Action === 'finish' && await FinishLive(RequestId))
	{
		return;
	}
	if (Job?.hls && Job.state === 'active' && Action === 'cancel' && await CancelHls(RequestId))
	{
		return;
	}
	if ((Job?.pickedDownloadFolder || Job?.subtitleMux) && !Job.hls && Job.state === 'active' && Action === 'cancel')
	{
		const Result = await chrome.runtime.sendMessage({ type: 'folderCancel', requestId: RequestId }).catch(() => null);
		if (Result?.ok)
		{
			return;
		}
	}
	const Item = await GetBrowserDownload(Job?.downloadId);
	if (Item)
	{
		if (Action === 'resume') AssertJobMayRestart({...Job, url: Item.url, finalUrl: Item.finalUrl, pageUrl: Item.referrer});
		const State = SummarizeJob(Job, Item).state;
		if (Action === 'pause' && State === 'active' && !Job.hls)
		{
			return chrome.downloads.pause(Item.id);
		}
		if (Action === 'resume' && Item.canResume && ['paused', 'failed'].includes(State))
		{
			if (Removing.has(JobKey(RequestId)))
			{
				throw new LocalizedError('job_busy');
			}
			return chrome.downloads.resume(Item.id);
		}
		if (Action === 'cancel' && ['active', 'paused'].includes(State))
		{
			return chrome.downloads.cancel(Item.id);
		}
		if (Action === 'show' && ['complete', 'interrupted'].includes(State) && Item.exists)
		{
			if((await chrome.runtime.getPlatformInfo()).os==='mac')return chrome.downloads.showDefaultFolder();
			return chrome.downloads.show(Item.id);
		}
		if (Action === 'play' && ['complete','interrupted'].includes(State) && Item.exists)
		{
			return chrome.tabs.create({url:LocalMediaUrl(Item.filename)});
		}
	}
	throw new LocalizedError('job_state_changed');
}

/** 원본 Chrome 다운로드의 중간 파일을 읽거나 이름을 바꾸지 않습니다. 현재 보고된
 * 범위를 고정하고 같은 자원의 prefix를 독립 수신기에 요청합니다.
 */
async function DirectSnapshotSource(Job, Item)
{
	AssertJobMayRestart(Job);
	const Stored = Item ? undefined : (await chrome.storage.session.get(PreviewSourceKey(Job.requestId)))[PreviewSourceKey(Job.requestId)];
	const Url = Item?.finalUrl || Item?.url || Stored?.url;
	AssertMediaAllowed({...Job, url: Url, pageUrl: Item?.referrer});
	const Bytes = Item?.bytesReceived ?? Job.bytesReceived;
	if (!HostPattern(Url) || !(Bytes > 0))
	{
		return null;
	}
	const Format = ClassifyResponseMedia(Url, Item?.mime ?? '')?.format ?? Stored?.format;
	return {url: Url, bytes: Bytes, totalBytes: Item?.totalBytes ?? Job.totalBytes, format: Format};
}

async function SaveCurrentJob(Job)
{
	if (!Job?.requestId)
	{
		throw new LocalizedError('job_snapshot_unavailable');
	}
	if (PendingSnapshots.has(Job.requestId))
	{
		throw new LocalizedError('job_snapshot_busy');
	}
	PendingSnapshots.add(Job.requestId);
	try
	{
		return await SaveCurrentJobOnce(Job);
	}
	finally
	{
		PendingSnapshots.delete(Job.requestId);
	}
}

async function SaveCurrentJobOnce(Job)
{
	if (!Job || Job.snapshot || Job.muxing)
	{
		throw new LocalizedError('job_snapshot_unavailable');
	}
	const LocalStream = Job.hls || Job.recording || Job.youtube;
	const Item = LocalStream ? undefined : await GetBrowserDownload(Job.downloadId);
	const State = Item ? SummarizeJob(Job, Item).state : Job.state;
	if (!['active', 'paused'].includes(State))
	{
		throw new LocalizedError('job_snapshot_unavailable');
	}
	if (Item && Item.state !== 'in_progress')
	{
		throw new LocalizedError('job_snapshot_unavailable');
	}
	const Source = LocalStream ? undefined : await DirectSnapshotSource(Job, Item);
	if ((!LocalStream && !Source) || (Job.recording || Job.youtube) && !Job.snapshotAvailable)
	{
		throw new LocalizedError('job_snapshot_unavailable');
	}
	if (Source)
	{
		await RequireHlsHosts([Source.url]);
	}
	const Partial = {requestId: crypto.randomUUID(), filename: PartialFilename(Job.filename), created: Date.now(),
		state: 'starting', hls: !Job.youtube, ...(Job.youtube ? {youtube: true, includeYoutubeAutoCaptions: Job.includeYoutubeAutoCaptions,
			captionReceipt: Job.captionReceipt} : {}), snapshot: true, snapshotDirect: !!Source, snapshotParent: Job.requestId,
		subtitleCount: Job.subtitleCount ?? 0, subtitleStatus: Job.subtitleStatus,
		downloadFolder: Job.downloadFolder, pickedDownloadFolder: Job.pickedDownloadFolder,
		bytesReceived: 0, finished: 0, count: Source?.bytes ?? 1};
	const Key = JobKey(Partial.requestId);
	await WriteJob(Key, Partial);
	try
	{
		if (Job.youtube) await SavePartialYoutube(Job.requestId, Partial);
		else await SavePartialHls(Job.requestId, Partial, Source);
	}
	catch (ErrorValue)
	{
		const Current = await ReadJob(Key);
		if (['starting', 'active'].includes(Current?.state))
		{
			await WriteJob(Key, {...Current, state: 'failed', error: SerializeError(ErrorValue)});
		}
		throw ErrorValue;
	}
}
