/**
 * 원본 탭과 별개로 스트림 전송을 실행하는 오프스크린 문서입니다. 재생목록과 조각은 임시 파일에 저장하고 MP4로 합칩니다.
 * 취소는 해당 작업의 AbortController를 사용합니다. 브라우저 다운로드가 임시 파일을 계속 읽는 동안에는 파일과 객체 URL을 유지합니다.
 */
import { RuntimePolicy, InternalMediaOrigin } from './lib/runtime-policy.js';
import { ParseMaster, ParseMediaPlaylist } from './lib/hls.js';
import { ReadIndexRange, ReadPlaylist } from './lib/hls-http.js';
import { ResolveDash } from './lib/dash.js';
import { DownloadTracks, LocalPlaylist } from './lib/stream-transfer.js';
import { RemuxHls } from './lib/hls-remux.js';
import { StartHlsTrace } from './lib/hls-diagnostics.js';
import { PlaybackScratchName } from './lib/playback-hls.js';
import { HlsRequestSource } from './lib/hls-request-context.js';
import { LocalizedError, ReceivedError, SerializeError } from './lib/i18n.js';
import { RequirePickedFolder, WriteToPickedFolder } from './lib/picked-download-folder.js';
import { IsHtmlMediaType } from './lib/media.js';
import { CacheSegmentPreview } from './lib/job-preview-sample.js';
import { CreateStreamTransfers } from './lib/stream-transfers.js';
import { CreateStreamWorkspaces } from './lib/stream-workspaces.js';
import {CreateTransferSnapshots} from './lib/transfer-snapshots.js';
import {ReadFilePrefix} from './lib/partial-file.js';
import {RemuxFilePrefix} from './lib/partial-remux.js';
import {PartialOutputFilename} from './lib/partial-naming.js';
import { DebugLog } from './lib/debug-log.js';
import {CreateWebRtcTransfers} from './lib/webrtc-transfers.js';
import {CreateRecordingStore} from './lib/webrtc-recording.js';
const ScratchName = 'mdownloader-hls';
const Workspaces = CreateStreamWorkspaces(ScratchName);
const Transfers = CreateStreamTransfers((Job, Controller, FinishSignal) =>
Job.playback ? SavePlayback(Job, Controller) : Download(Job, Controller, FinishSignal));
const DirectTransfers = new Map();
const Snapshots = CreateTransferSnapshots(SavePartial);
const RecordingRoot = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('mdownloader-webrtc', {create: true});
const Recordings = CreateWebRtcTransfers({extensionId: chrome.runtime.id, report: LocalReport, snapshots: Snapshots,
	async createStore(Job) { return CreateRecordingStore(await (await RecordingRoot()).getDirectoryHandle(Job.requestId, {create: true})); },
	async release(Id)
	{
		await (await RecordingRoot()).removeEntry(Id, {recursive: true});
		await LocalReport(Id, 'recordingReleased').catch(() => {});
	},
	saveFile: (Job, File, Signal) => SaveMediaFile(Job, File, Signal, undefined, File.type),
});
async function LocalReport(RequestId, Action, Fields = {})
{
	if (DebugLog.IsEnabled() && Action === 'progress')
	{
		DebugLog.Record('TransferProgress', () => ({ requestId: RequestId, received: Fields.received, finished: Fields.finished }));
	}
	const Result = await chrome.runtime.sendMessage({ type: 'hlsUpdate', requestId: RequestId, action: Action, ...Fields });
	if (!Result?.ok)
	{
		throw ReceivedError(Result?.error, 'stream_runner_disconnected');
	}
	if (DebugLog.IsEnabled() && Action === 'folderSaved')
	{
		DebugLog.Record('SaveFinished', () => ({ requestId: RequestId, bytes: Fields.bytes, result: 'complete' }));
	}
	return Result.data;
}

function CachePreview(Id, Workspace, Playlist, Signal)
{
	// 오프스크린 문서에서 Cache API는 사용할 수 있지만 작업 저장소는 직접 조회하지 않습니다.
	// 샘플을 쓰기 직전에 워커에 작업이 아직 등록돼 있는지 확인합니다.
	return CacheSegmentPreview(Id, Workspace, Playlist, Signal, () => LocalReport(Id, 'previewAccess')).catch(() =>
	{
	});
}

async function MuxAndSave(Job, Workspace, Playlist, Progress, Signal, Trace, AudioPlaylist, AudioShift, OutputWorkspace = Workspace)
{
	const Id = Job.requestId;
	await Trace.begin('mp4-mux');
	await LocalReport(Id, 'progress', { ...Progress, muxing: true });
	const Destination = await OutputWorkspace.getFileHandle('result.mp4', { create: true });
	const Stream = await Destination.createWritable();
	try
	{
		await RemuxHls(Playlist, async Path => (await Workspace.getFileHandle(Path)).getFile(), Stream, Signal, AudioPlaylist, AudioShift);
	}
	catch (ErrorValue)
	{
		await Stream.abort().catch(() =>
		{
		});
		throw ErrorValue;
	}
	Signal.throwIfAborted();
	const MediaFile = await Destination.getFile();
	await Trace.finish({ bytes: MediaFile.size });
	await SaveMediaFile(Job, MediaFile, Signal, Trace, 'video/mp4');
}

/** 생성한 파일의 저장 수명은 해당 작업이 소유합니다. 원래 전송과 부분 저장의
 * 브라우저 다운로드 ID·객체 URL·폴더 파일을 서로 덮어쓰지 않습니다.
 */
async function SaveMediaFile(Job, MediaFile, Signal, Trace, MimeType)
{
	const Id = Job.requestId;
	await Trace?.begin('browser-save');
	if (Job.pickedDownloadFolder)
	{
		const Folder = await RequirePickedFolder(Job.pickedDownloadFolder);
		const Filename = await WriteToPickedFolder(Folder, Job.filename, MediaFile.stream(), Signal);
		await LocalReport(Id, 'folderSaved', { filename: Filename, bytes: MediaFile.size });
		await Trace?.finish({ bytes: MediaFile.size });
		return;
	}

	const ObjectUrl = URL.createObjectURL(new Blob([MediaFile], { type: MimeType }));
	try
	{
		await LocalReport(Id, 'save', { objectUrl: ObjectUrl });

		// Chrome이 파일을 모두 읽을 때까지 객체 URL과 원본 임시 파일을 유지합니다.
		let bCancelSent = false;
		for (; ; )
		{
			if (Signal.aborted && !bCancelSent)
			{
				await LocalReport(Id, 'cancelSave');
				bCancelSent = true;
			}
			const State = await LocalReport(Id, 'saving');
			if (State !== 'in_progress')
			{
				if (DebugLog.IsEnabled())
				{
					DebugLog.Record('SaveFinished', () => ({ requestId: Id, bytes: MediaFile.size, result: State === 'complete' ? 'complete' : bCancelSent ? 'canceled' : 'failed' }));
				}
				if (State === 'complete')
				{
					await Trace?.finish({ bytes: MediaFile.size });
				}
				else
				{
					await Trace?.fail(undefined, bCancelSent);
				}
				break;
			}
			await new Promise(Resolve => setTimeout(Resolve, RuntimePolicy.Transfer.BrowserSavePollMs));
		}
	}
	finally
	{
		URL.revokeObjectURL(ObjectUrl);
	}
}

async function SavePartial(Job, Snapshot, Signal)
{
	const Id = Job.requestId;
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('SnapshotStarted', () => ({ requestId: Id, bPartial: true }));
	}
	await LocalReport(Id, 'partialStarted');
	let Output;
	let Trace;
	try
	{
		Output = await Workspaces.create(Id);
		Trace = await StartHlsTrace(undefined, Id, Diagnostic => LocalReport(Id, 'diagnostic', {diagnostic: Diagnostic}));
		if (Snapshot.direct || Snapshot.recording)
		{
			await Trace.begin('partial-read');
			let Prefix;
			if (Snapshot.recording)
			{
				const File = await Snapshot.recording.readFile();
				Prefix = {file: File, total: File.size, partial: true};
			}
			else Prefix = await ReadFilePrefix(Snapshot.direct, Output, Signal, Progress => LocalReport(Id, 'progress', Progress));
			await Trace.finish({received: Prefix.file.size});
			await Trace.begin('partial-mux');
			await LocalReport(Id, 'progress', {received: Prefix.file.size, count: 1, finished: 1, muxing: true});
			const Handle = await Output.getFileHandle('result.media', {create: true});
			const Writer = await Handle.createWritable();
			let Format;
			try
			{
				Format = await RemuxFilePrefix(Prefix, (Snapshot.recording || Snapshot.direct).format, Writer, Signal);
			}
			catch (ErrorValue)
			{
				await Writer.abort().catch(() =>
				{
				});
				throw ErrorValue;
			}
			const Prepared = {...Job, filename: PartialOutputFilename(Job.filename, Format.extension)};
			await LocalReport(Id, 'partialFormat', {extension: Format.extension});
			await Trace.finish({bytes: (await Handle.getFile()).size});
			await SaveMediaFile(Prepared, await Handle.getFile(), Signal, Trace, Format.mimeType);
		}
		else
		{
			await MuxAndSave(Job, Snapshot.workspace, LocalPlaylist(Snapshot.video), Snapshot.progress, Signal, Trace,
			Snapshot.audio && LocalPlaylist(Snapshot.audio), Snapshot.audioShift, Output);
		}
	}
	catch (ErrorValue)
	{
		await ReportFailure(Id, Signal, Trace, ErrorValue);
		throw ErrorValue;
	}
	finally
	{
		if (Output)
		{
			await Workspaces.release(Id);
		}
	}
}

async function ReportFailure(Id, Signal, Trace, ErrorValue)
{
	const bCanceled = Signal.reason?.name === 'AbortError';
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('StreamFailed', () => ({ requestId: Id, bCanceled: bCanceled, result: bCanceled ? 'canceled' : 'failed', error: ErrorValue, status: ErrorValue?.status }));
	}
	await Trace?.fail(Signal.reason || ErrorValue, bCanceled);
	await LocalReport(Id, 'failure', {
		canceled: bCanceled,
		error: bCanceled ? undefined : SerializeError(Signal.reason || ErrorValue, 'stream_download_failed'),
	}).catch(() =>
	{
	});
}

async function SavePlayback(Job, { signal: Signal })
{
	const Id = Job.requestId;
	const { playlist: Playlist, count: Count, bytes: Bytes } = Job.playback;
	let Trace;
	try
	{
		// 수집 패널이 잠금을 놓기 전에 전송 문서가 다음 소유자로 대기하도록 등록합니다.
		await navigator.locks.request(PlaybackScratchName, { signal: Signal }, async () =>
		{
			const Root = await navigator.storage.getDirectory();
			const Workspace = await Root.getDirectoryHandle(PlaybackScratchName);
			try
			{
				Trace = await StartHlsTrace(undefined, Id, Diagnostic => LocalReport(Id, 'diagnostic', { diagnostic: Diagnostic }));
				const Preview = (async () =>
				{
					const [First] = ParseMediaPlaylist(Playlist, InternalMediaOrigin + '/').segments;
					const Path = Url => new URL(Url).pathname.slice(1);
					const Sample = LocalPlaylist([{ ...First, path: Path(First.url), init: First.init && Path(First.init.url) }]);
					await CachePreview(Id, Workspace, Sample, Signal);
				})().catch(() =>
				{
				});
				try
				{
					await MuxAndSave(Job, Workspace, Playlist, { received: Bytes, finished: Count, count: Count }, Signal, Trace);
				}
				finally
				{
					await Preview;
				}
			}
			finally
			{
				await Root.removeEntry(PlaybackScratchName, { recursive: true }).catch(() =>
				{
				});
			}
		});
	}
	catch (ErrorValue)
	{
		await ReportFailure(Id, Signal, Trace, ErrorValue);
	}
}

async function ReadTracks(Job, Authorize, Signal, Trace)
{
	const { url: Url, format: Format, requestContext: RequestContext } = Job;
	await Trace.begin('master-access');
	await Authorize([Url]);
	await Trace.finish();
	await Trace.begin('master-request');
	const TextValue = await ReadPlaylist(Url, Signal, !!RequestContext);
	await Trace.finish({ status: 200 });
	if (Format === 'MPD')
	{
		await Trace.begin('media-parse');
		const { video: Video, audio: LocalAudio } = await ResolveDash(TextValue, Url, async (Address, LocalRange) =>
		{
			await Authorize([Address]);
			return ReadIndexRange(Address, LocalRange, Signal);
		});
		await Trace.finish({ segments: Video.segments.length + (LocalAudio?.segments.length ?? 0) });
		return [{ playlist: Video }, ...(LocalAudio ? [{ playlist: LocalAudio, audio: true }] : [])];
	}

	await Trace.begin('master-parse');
	const Variants = ParseMaster(TextValue, Url);
	await Trace.finish({ variants: Variants?.length ?? 0 });
	let Playlists = [TextValue];
	let Urls = [Url];
	if (Variants || Job.variantUrl !== undefined)
	{
		await Trace.begin('variant-selection');
		const Selected = Job.variantUrl === undefined ? Variants?.at(-1)
		: Variants?.find(Variant => Variant.url === Job.variantUrl);
		if (!Selected)
		{
			throw new LocalizedError('stream_hls_variant_not_found');
		}
		Urls = Selected.audioUrl ? [Selected.url, Selected.audioUrl] : [Selected.url];
		await Trace.finish({ resolution: Selected.resolution, bandwidth: Selected.bandwidth });
		await Trace.begin('variant-access');
		await Authorize(Urls);
		await Trace.finish();
		await Trace.begin('variant-request');
		Playlists = await Promise.all(Urls.map(Address => ReadPlaylist(Address, Signal, !!RequestContext)));
		await Trace.finish({ status: 200 });
	}
	await Trace.begin('media-parse');
	const Tracks = Playlists.map((Playlist, Index) => ({
		url: Urls[Index], playlist: ParseMediaPlaylist(Playlist, Urls[Index]), audio: Index === 1,
	}));
	await Trace.finish({ segments: Tracks.reduce((Count, Track) => Count + Track.playlist.segments.length, 0) });
	return Tracks;
}

async function Download(Job, Controller, FinishSignal)
{
	const { signal: Signal } = Controller;
	const Id = Job.requestId;
	const { requestContext: RequestContext } = Job;
	let bWorkspace = false;
	let Trace;
	let Preview;
	try
	{
		Trace = await StartHlsTrace(HlsRequestSource(Job.url, RequestContext), Id,
		Diagnostic => LocalReport(Id, 'diagnostic', { diagnostic: Diagnostic }));
		if (!RequestContext)
		{
			await LocalReport(Id, 'clearRequestHeaders');
		}
		async function Authorize(Urls)
		{
			await LocalReport(Id, 'access', { urls: Urls });
			if (RequestContext)
			{
				await LocalReport(Id, 'requestHeaders', { context: RequestContext, urls: Urls });
			}
		}
		const Tracks = await ReadTracks(Job, Authorize, Signal, Trace);
		await Trace.begin('temporary-storage');
		const Workspace = await Workspaces.create(Id);
		bWorkspace = true;
		await Trace.finish();
		await Trace.begin('segments-transfer');
		const Result = await DownloadTracks(Tracks, {
			workspace: Workspace, controller: Controller, finishSignal: FinishSignal, authorize: Authorize, observedContext: !!RequestContext,
			progress: Progress => LocalReport(Id, 'progress', Progress),
			preview: Playlist =>
			{
				Preview = CachePreview(Id, Workspace, Playlist, Signal);
			},
			snapshot: Read => Snapshots.register(Id, () =>
			{
				const Value = Read();
				return Value && {...Value, workspace: Workspace};
			}),
		});
		await Trace.finish({ received: Result.progress.received, finished: Result.progress.finished });
		const OutputJob = Result.partial ? {...Job, filename: await LocalReport(Id, 'streamPartial'), partial: true} : Job;
		const AudioShift = (Tracks[0].playlist.presentationTimeOffset ?? 0) - (Tracks[1]?.playlist.presentationTimeOffset ?? 0);
		await MuxAndSave(OutputJob, Workspace, Result.video, Result.progress, Signal, Trace, Result.audio, AudioShift);
	}
	catch (ErrorValue)
	{
		await ReportFailure(Id, Signal, Trace, ErrorValue);
	}
	finally
	{
		if (RequestContext)
		{
			await LocalReport(Id, 'clearRequestHeaders').catch(() =>
			{
			});
		}
		await Preview;
		await Snapshots.close(Id);
		if (bWorkspace)
		{
			await Workspaces.release(Id);
		}
	}
}

async function DownloadDirectToFolder(Job, { signal: Signal })
{
	const Id = Job.requestId;
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('TransferStarted', () => ({ requestId: Id, operation: 'folderRun' }));
	}
	try
	{
		const Folder = await RequirePickedFolder(Job.pickedDownloadFolder);
		const HttpResponse = await fetch(Job.url, { credentials: 'include', signal: Signal });
		if (HttpResponse.status !== 200 || !HttpResponse.body)
		{
			await HttpResponse.body?.cancel();
			throw new LocalizedError('job_browser_error', HttpResponse.status);
		}
		if (IsHtmlMediaType(HttpResponse.headers.get('content-type')))
		{
			await HttpResponse.body.cancel();
			throw new LocalizedError('job_not_video');
		}
		const TotalBytes = Number(HttpResponse.headers.get('content-length')) || undefined;
		let Received = 0;
		let LastReported = 0;
		const Progress = new TransformStream({
			async transform(Chunk, Output)
			{
				Received += Chunk.byteLength;
				const Now = Date.now();
				if (Now - LastReported >= RuntimePolicy.Transfer.BrowserSavePollMs)
				{
					await LocalReport(Id, 'progress', { received: Received, totalBytes: TotalBytes });
					LastReported = Now;
				}
				Output.enqueue(Chunk);
			},
		});
		try
		{
			const Filename = await WriteToPickedFolder(Folder, Job.filename, HttpResponse.body.pipeThrough(Progress), Signal);
			await LocalReport(Id, 'folderSaved', { filename: Filename, bytes: Received });
		}
		catch (ErrorValue)
		{
			await Progress.readable.cancel().catch(() =>
			{
			});
			throw ErrorValue;
		}
	}
	catch (ErrorValue)
	{
		await ReportFailure(Id, Signal, undefined, ErrorValue);
	}
	finally
	{
		DirectTransfers.delete(Id);
	}
}

chrome.runtime.onMessage.addListener((Message, Sender, Respond) =>
{
	if (Sender.id !== chrome.runtime.id)
	{
		return;
	}
	if (Message.type.startsWith('webrtc'))
	{
		// 페이지는 직접 전송 문서를 제어하지 못합니다. SW가 원래 발신 문서를 붙인 릴레이만 검증합니다.
		if (Sender.tab) return;
		let Pending;
		switch (Message.type)
		{
			case 'webrtcPrepare': Pending = Recordings.prepare(Message.job).then(() => ({ok: true})); break;
			case 'webrtcRelay': Pending = Recordings.accept(Message.message, Message.source); break;
			case 'webrtcCancel': Pending = Recordings.cancel(Message.requestId).then(Ok => ({ok: Ok})); break;
			case 'webrtcForceFinish': Pending = Recordings.finish(Message.requestId, undefined, 'webrtc_source_changed').then(Ok => ({ok: Ok})); break;
			case 'webrtcSourceLost': Pending = Recordings.sourceLost(Message.tabId, Message.page).then(() => ({ok: true})); break;
			default: return;
		}
		Pending.then(Respond, ErrorValue => Respond({ok: false, error: SerializeError(ErrorValue)}));
		return true;
	}
	// 이 값은 확장 워커가 기존 실행 메시지에만 넣습니다. 일반 페이지 메시지는 받지 않습니다.
	if (['hlsRun', 'folderRun', 'hlsSnapshot', 'debugConfiguration'].includes(Message.type))
	{
		DebugLog.SetEnabled(Message.debugLogging);
	}
	if (Message.type === 'debugConfiguration')
	{
		return Respond({ ok: true });
	}
	if (Message.type === 'hlsActive')
	{
		return Respond({ requestIds: [...Transfers.ids(), ...Snapshots.ids()], directIds: [...DirectTransfers.keys()], recordingIds: Recordings.ids() });
	}
	if (Message.type === 'hlsSnapshot')
	{
		void (async () =>
		{
			let Registered = false;
			try
			{
				if (Message.source)
				{
					Snapshots.register(Message.parentId, () => ({direct: Message.source}));
					Registered = true;
				}
				await Snapshots.save(Message.parentId, Message.job);
				Respond({ok: true});
			}
			catch (ErrorValue)
			{
				Respond({ok: false, error: SerializeError(ErrorValue)});
			}
			finally
			{
				if (Registered)
				{
					await Snapshots.close(Message.parentId);
				}
			}
		})();
		return true;
	}
	if (Message.type === 'folderRun')
	{
		const { job: Job } = Message;
		const Controller = new AbortController();
		DirectTransfers.set(Job.requestId, Controller);
		void DownloadDirectToFolder(Job, Controller);
		return Respond({ ok: true });
	}
	if (Message.type === 'folderCancel')
	{
		const Controller = DirectTransfers.get(Message.requestId);
		Controller?.abort();
		return Respond({ ok: !!Controller });
	}
	if (Message.type === 'hlsRun')
	{
		const { job: Job } = Message;
		Respond({ ok: Transfers.start(Job) });
	}
	if (Message.type === 'hlsFinish')
	{
		return Respond({ ok: Transfers.finish(Message.requestId) });
	}
	if (Message.type === 'hlsCancel')
	{
		Respond({ ok: Transfers.cancel(Message.requestId, Message.reason ? ReceivedError(Message.reason) : undefined) || Snapshots.cancel(Message.requestId) });
	}
});
