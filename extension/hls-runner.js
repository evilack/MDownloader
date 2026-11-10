/**
 * 원본 탭과 별개로 스트림 전송을 실행하는 오프스크린 문서입니다. 재생목록과 조각은 임시 파일에 저장하고 MP4로 합칩니다.
 * 취소는 해당 작업의 AbortController를 사용합니다. 브라우저 다운로드가 임시 파일을 계속 읽는 동안에는 파일과 객체 URL을 유지합니다.
 */
import { RuntimePolicy, InternalMediaOrigin } from './lib/runtime-policy.js';
import { ParseMaster, ParseMediaPlaylist } from './lib/hls.js';
import { ReadIndexRange, ReadPlaylist } from './lib/hls-http.js';
import { ResolveDash } from './lib/dash.js';
import { DownloadTracks, LocalPlaylist } from './lib/stream-transfer.js';
import { RemuxHls,RemuxCapturedHls } from './lib/hls-remux.js';
import {CreateHlsCaptureSource} from './lib/hls-capture-source.js';
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
import {StartWebRtcReceiver} from './lib/webrtc-receiver.js';
import {AssertMediaAllowed} from './lib/youtube-source-policy.js';
import {ReadSubtitles, FindHlsSubtitles, FindDashSubtitles} from './lib/subtitles.js';
import {MuxSubtitles} from './lib/subtitle-mux.js';
import {TranslateMissingSubtitle} from './lib/subtitle-translation.js';
import {TranslateWithProvider} from './lib/translation-providers.js';
import {SubtitleStatus} from './lib/subtitle-status.js';
import {PrepareCaptionOutput,FinalizeCaptionInput,TranslateOutputSubtitles,SaveCaptionArtifacts,ReleaseCaptionOutput} from './lib/caption-output-pipeline.js';
import {SelectSubtitleTracks} from './lib/download-options-selection.js';
import {AlignRecordingSubtitles, SubtitleTracksForOutput} from './lib/subtitle-timing.js';
import {YoutubeAvailable, HandleYoutubeRunner} from './features/youtube/entry.js';
import {PrepareCaptionBlob,FinishCaptionSave,CaptionTiming,CaptionStage,ConcurrentCaptions} from './lib/local-captions-runner.js';
import {RemuxCaptionAudio} from './lib/hls-remux.js';
import {CreateCaptionWindowSource} from './lib/caption-window-source.js';
import {CaptionOutputSession,FindCaptionOutputSession,RetainCaptionSource,ReleaseCaptionOutputSession,CancelCaptionOutputSession,CaptionOutputSessionIds,ClearCaptionOutputExpiry,ExpireCaptionOutputSession} from './lib/caption-output-session.js';
import {CreateCaptionJournal,CreateCommittedFileStore,SealCaptionJournal,StartCommittedCaptions} from './lib/caption-committed-input.js';
import {DirectCaptionMetadata} from './lib/media-range-source.js';
import {RecordingMimeTypes} from './lib/recording-format.js';
import {CaptionOptionsKey} from './lib/local-captions-settings.js';
const ScratchName = 'mdownloader-hls';
const Workspaces = CreateStreamWorkspaces(ScratchName);
const Transfers = CreateStreamTransfers((Job, Controller, FinishSignal) =>
Job.playback ? SavePlayback(Job, Controller) : Download(Job, Controller, FinishSignal));
const DirectTransfers = new Map();
const PreparedCaptionTracks = new Map();
const Snapshots = CreateTransferSnapshots(SavePartial);
const Receivers = new Map();
const RecordingRoot = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('mdownloader-webrtc', {create: true});
const RecordingOwners=new Map();
async function CollectRecording(Id){
 const Owner=RecordingOwners.get(Id);if(!Owner||Owner.producer||Owner.caption)return;
 Owner.collecting??=(async()=>{await(await RecordingRoot()).removeEntry(Id,{recursive:true});RecordingOwners.delete(Id);})();
 try{await Owner.collecting;}catch(E){Owner.collecting=null;throw E;}
}
const Recordings = CreateWebRtcTransfers({extensionId: chrome.runtime.id, report: LocalReport, snapshots: Snapshots,
	prepareJob: (Job, Signal) => LoadJobSubtitles(Job, Signal),
	async createStore(Job,Signal) {
	 const Directory=await(await RecordingRoot()).getDirectoryHandle(Job.requestId,{create:true});
	 const Journal=CreateCaptionJournal(Job,'recording',Signal,RuntimePolicy.Transfer.MaxScratchBytes);
	 const Owner={producer:true,caption:!!Journal};RecordingOwners.set(Job.requestId,Owner);
	 if(Journal)RetainCaptionSource(Job,async()=>{Owner.caption=false;await CollectRecording(Job.requestId);});
	 return CreateRecordingStore(Directory,{journal:Journal});
	},
	startCaptions:(Job,Store,Signal)=>StartCommittedCaptions(Job,Store.journal,Store.workspace,Signal,{resample:{async:1}}),
	async release(Id)
	{
		Receivers.delete(Id);
		PreparedCaptionTracks.delete(Id);
		const Session=FindCaptionOutputSession(Id),Owner=RecordingOwners.get(Id);
		if(Owner)Owner.producer=false;
		if(Session?.controller.signal.aborted||Session&&!Session.rawFile){await ConcurrentCaptions.cancel(Id);await ReleaseCaptionOutputSession(Id);}
		await CollectRecording(Id);
		await LocalReport(Id, 'recordingReleased').catch(() => {});
	},
	saveFile: (Job, File, Signal) => SaveMediaFile(Job, File, Signal, undefined, File.type),
});

async function ReportSubtitleError(Job, Signal, Status = Job.subtitleStatus)
{
 Signal?.throwIfAborted();
 const Current = Status || {...SubtitleStatus(Job.subtitles || Job.subtitleTracks || []), completed:0};
 const {unavailable: _Legacy, ...Fields} = Current;
 Job.subtitleStatus = {...Fields, phase:'failed', errorCount:(Fields.errorCount || 0)+(_Legacy || 0)+1, translation:['pending','translating','no_source'].includes(Fields.translation) ? 'unknown' : Fields.translation};
 await LocalReport(Job.requestId,'subtitleStatus',{status:Job.subtitleStatus});
}
async function LoadJobSubtitles(Job, Signal, Extra = [])
{
 if (Job.subtitleTracks) return Job.subtitleTracks;
 let Tracks=[], Sources=[], Status=Job.subtitleStatus;
 let HadError=Status?.phase==='failed';
 let ErrorCount=Status?.errorCount || (HadError?1:0);
 try
 {
  Sources=[...new Map([...(Job.subtitles ?? []),...Extra].map(Source=>[JSON.stringify([Source.language ?? 'und',Source.url ?? Source.text,Source.segments]),Source])).values()];
  if(Job.subtitleOptions)Sources=await SelectSubtitleTracks(Sources,Job.subtitleOptions.trackIds,Job.subtitleOptions.translation);
  if(Sources.length)
  {
   let Options={},ConfigurationError=false;
   try{
    const Result=await chrome.runtime.sendMessage({type:'subtitleTranslationConfiguration',options:Job.subtitleOptions?.translation});
    if(!Result?.ok)throw ReceivedError(Result?.error,'subtitle_translation_failed');
    Options=Result.data || {};
   }catch(ErrorValue){Signal?.throwIfAborted();ConfigurationError=true;HadError=true;ErrorCount++;}

   Status={...SubtitleStatus(Sources,Options),phase:HadError?'failed':'collecting',completed:0,...(ErrorCount?{errorCount:ErrorCount}:{})};
   await LocalReport(Job.requestId,'subtitleStatus',{status:Status});
   const EarlierErrors=ErrorCount;
   Tracks=await ReadSubtitles(Sources,{signal:Signal,authorize:Urls=>LocalReport(Job.requestId,'access',{urls:Urls}),
    onError:async({failed})=>{HadError=true;ErrorCount=EarlierErrors+failed;Status={...Status,phase:'failed',errorCount:ErrorCount};await LocalReport(Job.requestId,'subtitleStatus',{status:Status});},
    onProgress:async({completed})=>{Status={...Status,completed};await LocalReport(Job.requestId,'subtitleStatus',{status:Status});}});
   Status={...SubtitleStatus(Tracks,Options),phase:HadError?'failed':'ready',count:Sources.length,completed:Tracks.length,...(ErrorCount?{errorCount:ErrorCount}:{})};
   if(HadError && !Tracks.length && Options.enabled)Status.translation='unknown';
   if(ConfigurationError)Status.translation='failed';
   if(Status.translation==='pending')
   {
    // Translation uses the finished temporary media, immediately before final output.
    const {providers:Unused,...Selection}=Options;Job.outputTranslation=Selection;
   }
   Job.subtitleStatus=Status;
   await LocalReport(Job.requestId,'subtitleStatus',{status:Status});
   await LocalReport(Job.requestId,'subtitleCount',{count:Tracks.length});
  }
 }
 catch(ErrorValue)
 {
  Signal?.throwIfAborted();
  await ReportSubtitleError(Job,Signal,Status || {...SubtitleStatus(Sources),completed:Tracks.length});
 }
 Job.subtitleTracks=Tracks;
 PreparedCaptionTracks.set(Job.requestId,Tracks);
 delete Job.subtitles;
 return Tracks;
}

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

async function MuxAndSave(Job, Workspace, Playlist, Progress, Signal, Trace, AudioPlaylist, AudioShift, OutputWorkspace = Workspace, Capture)
{
 const Id=Job.requestId,CaptureSession=Capture&&!Job.snapshot?FindCaptionOutputSession(Id):null;
 if(CaptureSession?.remuxing)throw Error('caption_busy');
 if(CaptureSession)CaptureSession.remuxing=true;
 const Mux=(async()=>{
  Signal.throwIfAborted();await Trace.begin('mp4-mux');await LocalReport(Id,'progress',{...Progress,muxing:true});
  const Destination=await OutputWorkspace.getFileHandle('result.mp4',{create:true}),Stream=await Destination.createWritable();
  try{
   Signal.throwIfAborted();
   const Timing=Capture?await RemuxCapturedHls({capture:Capture,destination:Stream,signal:Signal,audioShift:AudioShift}):await RemuxHls(Playlist,async Path=>(await Workspace.getFileHandle(Path)).getFile(),Stream,Signal,AudioPlaylist,AudioShift);
   Signal.throwIfAborted();const MediaFile=await Destination.getFile();await Trace.finish({bytes:MediaFile.size});return {Timing,MediaFile};
  }catch(E){await Stream.abort().catch(()=>{});throw E;}
 })();
 if(CaptureSession)CaptureSession.running=Mux;
 let Result;
 try{Result=await Mux;}finally{if(CaptureSession){CaptureSession.remuxing=false;if(CaptureSession.running===Mux)CaptureSession.running=null;}}
 const {Timing,MediaFile}=Result;Job.captionFinalTiming=Timing;
 if(!Job.snapshot)await CaptionTiming(Job,Timing?.start??0,{clipped:!!Job.partial,signal:Signal});
 await SaveMediaFile(Job,MediaFile,Signal,Trace,'video/mp4',Timing?.start??0);
}
/** 생성한 파일의 저장 수명은 해당 작업이 소유합니다. 원래 전송과 부분 저장의
 * 브라우저 다운로드 ID·객체 URL·폴더 파일을 서로 덮어쓰지 않습니다.
 */
async function SaveMediaFile(Job, MediaFile, ExternalSignal, Trace, MimeType, SubtitleStart = 0)
{
 const Id=Job.requestId,Session=CaptionOutputSession(Job),Captions=Job.captionPipeline==='staged'&&Job.localCaptions?.enabled&&!Job.snapshot;
 if(Session.running)return Session.running;
 ClearCaptionOutputExpiry(Session);
 Session.failureController=new AbortController();
 Session.rawFile??=MediaFile;Session.mimeType??=MimeType;Session.subtitleStart??=SubtitleStart;Session.trace??=Trace;
 if(!Session.started){Session.job=Job;Session.started=true;}
 const Abort=()=>Session.controller.abort(ExternalSignal?.reason||new DOMException('Canceled','AbortError'));
 ExternalSignal?.addEventListener('abort',Abort,{once:true});if(ExternalSignal?.aborted)Abort();
 const Signal=AbortSignal.any([Session.controller.signal,Session.failureController.signal]);
 Session.resume=()=>SaveMediaFile(Session.job,Session.rawFile,Session.controller.signal,undefined,Session.mimeType,Session.subtitleStart);
 const Task=(async()=>{
  try{
   Signal.throwIfAborted();
   if(Session.retryRecognition&&Session.retryRecognitionReason!=='caption_no_audio'){
    // Recover the same attempt's receipt (or completed-ASR finalization) before
    // a generic output retry is allowed to replace it with fresh recognition.
    if(await ConcurrentCaptions.recoverOutputRetry(Session.job,Signal))Session.retryRecognition=false;
   }
   if(Session.retryRecognition){
    const Options=Session.job.localCaptions;await ConcurrentCaptions.retryRecognition(Session.job,Signal);
    Session.job={...(Session.preCaptionJob||Session.job),localCaptions:Options,captionsFinalized:false,captionArtifacts:undefined,captionPreparationError:null,captionConcurrencyError:null,captionPreparation:null,captionConcurrentStart:null};
    Session.finalizedRecognition=null;Session.originalCaption=null;Session.generatedTracks=null;Session.captionPreparedJob=null;Session.finalFile=null;Session.artifacts=[];Session.retryRecognition=false;Session.retryRecognitionReason=null;
   }
   if(Captions)await FinalizeCaptionInput(Session.job,Session.rawFile,Signal);
   if(!Session.job.outputTranslationFinalized){Session.job=await TranslateOutputSubtitles(Session.job,Signal,LocalReport);Session.job.outputTranslationFinalized=true;}
   if(!Session.captionPreparedJob)Session.preCaptionJob=Session.job;
   Session.job=await PrepareCaptionOutput(Session.job,Session.rawFile,Signal);
   if(!Session.finalFile){
    if(Session.job.subtitleTracks?.length){
     const WorkspaceId='subtitles-'+Id,Workspace=await Workspaces.create(WorkspaceId);
     if(!Session.subtitleWorkspace){Session.subtitleWorkspace=true;Session.leases.push(()=>Workspaces.release(WorkspaceId));}
     await LocalReport(Id,'progress',{received:Session.rawFile.size,muxing:true});
     const Handle=await Workspace.getFileHandle('subtitled.mp4',{create:true}),Writer=await Handle.createWritable();
     let Muxed=false;
     try{await MuxSubtitles(Session.rawFile,SubtitleTracksForOutput(Session.job.subtitleTracks,Session.subtitleStart,!!(Session.job.partial||Session.job.snapshot)),Writer,Signal);Muxed=true;}
     catch(ErrorValue){await Writer.abort().catch(()=>{});if(Signal.aborted||Captions||Session.job.subtitleOptions?.translation?.enabled||Session.job.outputTranslation?.enabled)throw ErrorValue;await ReportSubtitleError(Session.job,Signal);}
     try{if(Muxed){Session.finalFile=await Handle.getFile();Session.mimeType='video/mp4';Session.job.filename=await LocalReport(Id,'subtitleReady',{count:Session.job.subtitleTracks.length,bytes:Session.finalFile.size});}else Session.finalFile=Session.rawFile;}
     catch(ErrorValue){if(Captions)throw ErrorValue;Session.finalFile=Session.rawFile;}
    }else Session.finalFile=Session.rawFile;
   }
   const Current=Session.job,Final=Session.finalFile;
   await Trace?.begin('browser-save');
   if(!Session.receipts.media){
    if(Current.pickedDownloadFolder){
     const Filename=await WriteToPickedFolder(await RequirePickedFolder(Current.pickedDownloadFolder),Current.filename,Final.stream(),Signal);
     Session.receipts.media={filename:Filename,bytes:Final.size,resultRevision:Current.captionResultRevision||0};
    }else{
     if(Captions){
      let Previous=await LocalReport(Id,'savedMediaState');
      while(Previous.state==='in_progress'){
       if(Signal.aborted)await LocalReport(Id,'cancelSave');
       await new Promise(Resolve=>setTimeout(Resolve,RuntimePolicy.Transfer.BrowserSavePollMs));Previous=await LocalReport(Id,'savedMediaState');
      }
      if(Previous.state==='complete')Session.receipts.media=Previous.receipt;
      else Signal.throwIfAborted();
     }
     if(!Session.receipts.media){
     const ObjectUrl=URL.createObjectURL(new Blob([Final],{type:Session.mimeType}));
     try{
      Session.downloadId=await LocalReport(Id,'save',{objectUrl:ObjectUrl});let CancelSent=false;
      for(;;){
       if(Signal.aborted&&!CancelSent){await LocalReport(Id,'cancelSave');CancelSent=true;}
       const State=await LocalReport(Id,'saving');
       if(State==='complete'){
        Session.receipts.media=await LocalReport(Id,'mediaReceipt',{bytes:Final.size,resultRevision:Current.captionResultRevision||0});break;
       }
       if(State!=='in_progress')throw Signal.aborted?Signal.reason:Error('caption_save_failed');
       await new Promise(Resolve=>setTimeout(Resolve,RuntimePolicy.Transfer.BrowserSavePollMs));
      }
     }finally{URL.revokeObjectURL(ObjectUrl);}
     }
    }
   }
   if(Captions)await CaptionStage(Current,'outputReceipt',{kind:'media',receipt:Session.receipts.media});
   Signal.throwIfAborted();
   if(Captions){
    await SaveCaptionArtifacts(Current,Session.receipts.media.filename,Signal);
    await Trace?.finish({bytes:Final.size});
    await FinishCaptionSave({...Current,filename:Session.receipts.media.filename},Final,Signal);
   }else if(Current.pickedDownloadFolder)await LocalReport(Id,'folderSaved',{filename:Session.receipts.media.filename,bytes:Final.size});
   if(!Captions)await Trace?.finish({bytes:Final.size});
   await ReleaseCaptionOutput(Current);await ConcurrentCaptions.release(Id);await ReleaseCaptionOutputSession(Id);
  }catch(ErrorValue){
   if(Captions&&!Session.controller.signal.aborted&&(ErrorValue?.name!=='AbortError'||Session.nativeFailure)){
    if(Session.nativeFailure)ErrorValue=Session.nativeFailure;
    Session.retryRecognition=!Session.finalizedRecognition||ErrorValue.message==='caption_no_audio';
    Session.retryRecognitionReason=ErrorValue.message;
    const Failure=await CaptionStage(Session.job,'failure',{code:ErrorValue.message?.startsWith('caption_')?ErrorValue.message:'caption_output_failed',retryAvailable:true,finalMediaReady:!!Session.finalFile}).catch(()=>({}));
    ExpireCaptionOutputSession(Session,async Value=>{try{await CaptionStage(Value.job,'expireOutput');}finally{await ConcurrentCaptions.release(Id);await ReleaseCaptionOutput(Value.job);await ReleaseCaptionOutputSession(Id);}},Failure?.expiresAt);
   }else{
    if(Signal.aborted)await ConcurrentCaptions.cancel(Id).catch(()=>{});
    await ReleaseCaptionOutput(Session.job);await ReleaseCaptionOutputSession(Id);
   }
   throw ErrorValue;
  }finally{ExternalSignal?.removeEventListener('abort',Abort);}
 })();
 Session.running=Task;
 try{return await Task;}finally{if(Session.running===Task)Session.running=null;}
}
async function SavePartial(Job, Snapshot, Signal)
{
	Job.subtitleTracks = Snapshot.subtitleTracks;
	const Id = Job.requestId;
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('SnapshotStarted', () => ({ requestId: Id, bPartial: true }));
	}
	await LocalReport(Id, 'partialStarted');
	if(Snapshot.subtitleError)await ReportSubtitleError(Job,Signal);
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
				await LoadJobSubtitles(Job, Signal);
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
			const View=Snapshot.capture?.freezeSelection(Snapshot.selectedByTrack);
			try{await MuxAndSave(Job, Snapshot.workspace, LocalPlaylist(Snapshot.video), Snapshot.progress, Signal, Trace,
			Snapshot.audio && LocalPlaylist(Snapshot.audio), Snapshot.audioShift, Output,View);}finally{View?.release();}
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
	const bCanceled = Signal.reason?.name === 'AbortError'||ErrorValue?.name==='AbortError';
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
				await LoadJobSubtitles(Job, Signal);
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
					const Output=await Workspaces.create(Id);
					if(Job.localCaptions?.enabled&&!Job.snapshot)RetainCaptionSource(Job,await Workspaces.retain(Id));
					try{await MuxAndSave(Job, Workspace, Playlist, { received: Bytes, finished: Count, count: Count }, Signal, Trace,undefined,undefined,Output);}
					finally{await Workspaces.release(Id);}
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
	finally {PreparedCaptionTracks.delete(Id);}
}

async function ReadTracks(Job, Authorize, Signal, Trace)
{
	const { url: Url, format: Format, requestContext: RequestContext } = Job;
	await Trace.begin('master-access');
	await Authorize([Url]);
	await Trace.finish();
	await Trace.begin('master-request');
	const TextValue = await ReadPlaylist(Url, Signal, RequestContext);
	await Trace.finish({ status: 200 });
	if (Format === 'MPD')
	{
		try{Job.manifestSubtitles=FindDashSubtitles(TextValue,Url);}catch{await ReportSubtitleError(Job,Signal);}
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
	try{Job.manifestSubtitles=FindHlsSubtitles(TextValue,Url,Job.variantUrl ?? Variants?.at(-1)?.url);}catch{await ReportSubtitleError(Job,Signal);}
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
		Playlists = await Promise.all(Urls.map(Address => ReadPlaylist(Address, Signal, RequestContext)));
		await Trace.finish({ status: 200 });
	}
	else if (Job.audioUrl)
	{
		// This media playlist was selected from an observed master rendition.
		// Its separately declared audio must follow the same authorization path.
		await Trace.begin('variant-access');
		await Authorize([Job.audioUrl]);
		await Trace.finish();
		await Trace.begin('variant-request');
		Urls.push(Job.audioUrl);
		Playlists.push(await ReadPlaylist(Job.audioUrl, Signal, RequestContext));
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
	let CaptionSource;
	let Capture;
	let CapturedWorkspace,ReadCaptureSnapshot;
	if(Job.localCaptions?.enabled&&!Job.snapshot)ConcurrentCaptions.bind(Job,Signal);
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
		await LoadJobSubtitles(Job, Signal, Job.manifestSubtitles);
		delete Job.manifestSubtitles;
		await Trace.begin('temporary-storage');
		const Workspace = await Workspaces.create(Id);
		CapturedWorkspace=Workspace;
		bWorkspace = true;
		if(Job.localCaptions?.enabled&&!Job.snapshot){
		 RetainCaptionSource(Job,await Workspaces.retain(Id));
		  Capture=CreateHlsCaptureSource({signal:Signal,getFile:async Path=>(await Workspace.getFileHandle(Path)).getFile()});
		  CaptionOutputSession(Job).captionSources.add(Capture);
		  Job.captionSourceInfo={windowed:true,live:Tracks.some(T=>!T.playlist.ended),discontinuous:Tracks.some(T=>T.playlist.segments.some(S=>S.discontinuity))};
		  CaptionSource=CreateCaptionWindowSource({capture:Capture,signal:Signal,createWindowFile:()=>Workspace.getFileHandle('caption-window.m4a',{create:true})});
		  Job.captionConcurrentStart=(async()=>{try{if(!await ConcurrentCaptions.windowed(Job,CaptionSource,Signal,JSON.stringify(Tracks.map(T=>({audio:T.audio,playlist:T.playlist}))))){await CaptionSource.release();}}catch(ErrorValue){Job.captionConcurrencyError=ErrorValue;await CaptionSource.release();}})();
		}
		await Trace.finish();
		await Trace.begin('segments-transfer');
		const Result = await DownloadTracks(Tracks, {
			capture:Capture,
			liveStart: Job.liveStart,
			workspace: Workspace, controller: Controller, finishSignal: FinishSignal, authorize: Authorize, observedContext: RequestContext,
			progress: Progress => LocalReport(Id, 'progress', Progress),
			audioReady: Job.localCaptions?.enabled && !Tracks.some(T=>!T.playlist.ended) ? (Playlist,VideoReference)=>{
				Job.captionAudioShift=(Tracks[0].playlist.presentationTimeOffset ?? 0)-(Tracks[1]?.playlist.presentationTimeOffset ?? 0);
				Job.captionPreparation=(async()=>{
					let Writer;
					try{
						await Job.captionConcurrentStart;if(Job.captionMode==='windowed'||Job.captionConcurrencyError)return;
						const Handle=await Workspace.getFileHandle('caption-audio.m4a',{create:true});Writer=await Handle.createWritable();
						const Timing=await RemuxCaptionAudio(Playlist,async Path=>(await Workspace.getFileHandle(Path)).getFile(),Writer,Signal,VideoReference,Job.captionAudioShift);
						Job.captionAudioStart=Timing.start;if(Timing.aligned)Job.captionAudioShift=0;await PrepareCaptionBlob(Job,await Handle.getFile(),Signal,{early:true});
					}catch(ErrorValue){await Writer?.abort().catch(()=>{});Job.captionPrepared=false;if(ErrorValue.message?.startsWith('caption_'))Job.captionPreparationError=ErrorValue;}
				})();
			}:undefined,
			preview: Playlist =>
			{
				Preview = CachePreview(Id, Workspace, Playlist, Signal);
			},
			snapshot: Read => {ReadCaptureSnapshot=Read;Snapshots.register(Id, () =>
			{
				const Value = Read();
				return Value && {...Value, workspace: Workspace, subtitleTracks: Job.subtitleTracks,capture:Capture,
					selectedByTrack:Value.selectedByTrack||Object.fromEntries([Value.video,Value.audio].filter(Boolean).map((List,I)=>['track-'+I,List.map(S=>S.id)]))};
			});},
		});
		await Trace.finish({ received: Result.progress.received, finished: Result.progress.finished });
		const OutputJob = Result.partial ? {...Job, filename: await LocalReport(Id, 'streamPartial'), partial: true} : Job;
		// Shared raw PTS alignment is already in the capture clock. The remaining
		// DASH presentation offset is declared PTO(video)-PTO(audio), exactly once.
		const AudioShift = Result.capture?.audioShift ?? (Tracks[0].playlist.presentationTimeOffset ?? 0) - (Tracks[1]?.playlist.presentationTimeOffset ?? 0);
		OutputJob.captionSourceAudioShift=AudioShift;
		if(Job.captionMode==='windowed')OutputJob.captionAudioShift=AudioShift;
		if(Result.capture){const Session=CaptionOutputSession(OutputJob);Session.job=OutputJob;Session.captionSources.add(Result.capture);Session.capturedInput={capture:Result.capture,workspace:Workspace,reason:Result.reason};
		 Session.resume=async()=>{ClearCaptionOutputExpiry(Session);try{return await MuxAndSave(Session.job,Workspace,Result.video,Result.progress,Session.controller.signal,Trace,Result.audio,AudioShift,Workspace,Result.capture);}
		  catch(E){if(!Session.controller.signal.aborted&&!Session.rawFile){const State=await CaptionStage(Session.job,'failure',{code:E.message,retryAvailable:true}).catch(()=>({}));ExpireCaptionOutputSession(Session,async()=>{await ConcurrentCaptions.cancel(Id);await ReleaseCaptionOutputSession(Id);},State.expiresAt);}throw E;}};}
		await MuxAndSave(OutputJob, Workspace, Result.video, Result.progress, Signal, Trace, Result.audio, AudioShift,Workspace,Result.capture);
	}
	catch (ErrorValue)
	{
		const Session=FindCaptionOutputSession(Id);
		const UserCanceled=Signal.reason?.name==='AbortError'||ErrorValue.name==='AbortError';
		if(Session&&Capture&&!Session.rawFile&&!Session.capturedInput&&!UserCanceled){
		 const Prefix=ReadCaptureSnapshot?.();if(Prefix){Session.capturedInput={workspace:CapturedWorkspace,snapshot:Prefix,reason:'failure',error:ErrorValue.message};await ConcurrentCaptions.cancel(Id).catch(()=>{});}
		}
		if(!Session?.rawFile&&!Session?.capturedInput||UserCanceled){if(!Signal.aborted)Controller.abort(ErrorValue);await ConcurrentCaptions.cancel(Id).catch(()=>{});}
		else if(Session.capturedInput&&!Session.rawFile){const State=await CaptionStage(Job,'failure',{code:ErrorValue.message,retryAvailable:typeof Session.resume==='function'}).catch(()=>({}));ExpireCaptionOutputSession(Session,async()=>{await ConcurrentCaptions.cancel(Id);await ReleaseCaptionOutputSession(Id);},State.expiresAt);}
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
		await Job.captionPreparation;
		const OutputSession=FindCaptionOutputSession(Id);
		if(!OutputSession?.rawFile&&!OutputSession?.capturedInput||Signal.reason?.name==='AbortError'){await CaptionSource?.release();Capture?.release();await ReleaseCaptionOutputSession(Id);}
		await Snapshots.close(Id);
		PreparedCaptionTracks.delete(Id);
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
		const Folder = Job.pickedDownloadFolder ? await RequirePickedFolder(Job.pickedDownloadFolder) : undefined;
		await LoadJobSubtitles(Job, Signal);
		AssertMediaAllowed(Job);
		const HttpResponse = await fetch(Job.url, { credentials: 'include', redirect: 'error', signal: Signal });
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
			if (Job.subtitleTracks.length || !Folder || Job.localCaptions?.enabled || Job.subtitleOptions?.translation?.enabled)
			{
				const Workspace = await Workspaces.create(Id);
				if(Job.localCaptions?.enabled&&!Job.snapshot)RetainCaptionSource(Job,await Workspaces.retain(Id));
				try
				{
					const Journal=CreateCaptionJournal(Job,'direct',Signal),Store=CreateCommittedFileStore(Workspace,Journal);
					StartCommittedCaptions(Job,Journal,Workspace,Signal,Journal?DirectCaptionMetadata(Job,Journal,Store,HttpResponse):undefined);
					let Size = 0;
					const Limit = new TransformStream({transform(Chunk, Output)
					{
						Size += Chunk.byteLength;
						if (Size > RuntimePolicy.Transfer.MaxStreamScratchBytes) throw new LocalizedError('subtitle_limit');
						Output.enqueue(Chunk);
					}});
					try{
					 await HttpResponse.body.pipeThrough(Progress).pipeThrough(Limit).pipeTo(new WritableStream({write:Chunk=>Store.write(Chunk),close:()=>Store.close(),abort:ErrorValue=>{Journal?.fail(ErrorValue);}}),{signal:Signal});
					 if(Store.captionKnownSize!==undefined&&Store.bytes!==Store.captionKnownSize)Journal.fail(Error('caption_source_identity'));
					 SealCaptionJournal(Journal,'eof');
					}catch(ErrorValue){Journal?.fail(ErrorValue);throw ErrorValue;}
					const Mime=HttpResponse.headers.get('content-type')?.split(';')[0]||'video/mp4';
					await SaveMediaFile(Job,Store.file(Mime),Signal,undefined,Mime);
				}
				finally {await Workspaces.release(Id);}
			}
			else
			{
				const Filename = await WriteToPickedFolder(Folder, Job.filename, HttpResponse.body.pipeThrough(Progress), Signal);
				await LocalReport(Id, 'folderSaved', { filename: Filename, bytes: Received });
				if(Job.localCaptions?.enabled)await FinishCaptionSave({...Job,filename:Filename},await (await Folder.getFileHandle(Filename)).getFile(),Signal);
			}
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
		await Snapshots.close(Id);
		PreparedCaptionTracks.delete(Id);
		DirectTransfers.delete(Id);
		if(!FindCaptionOutputSession(Id)?.rawFile||Signal.aborted)await ReleaseCaptionOutputSession(Id);
	}
}

chrome.runtime.onMessage.addListener((Message, Sender, Respond) =>
{
	if (Sender.id !== chrome.runtime.id)
	{
		return;
	}
	if(Message.type==='captionPipelineFailed'){
	 if(Sender.tab||Sender.url!==chrome.runtime.getURL('background.js'))return;
	 const Session=FindCaptionOutputSession(Message.requestId),Owner=ConcurrentCaptions.ownership(Message.requestId),Transport=Session?.job.captionSession;
	 if(Message.nativeFailureRevision&&(Transport?.nativeFailureRevision||0)>=Message.nativeFailureRevision){Respond({ok:true,stale:true});return;}
	 if(!Owner.owned&&(!Session||Transport?.attempt!==Message.attempt)){Respond({ok:true,stale:true});return;}
	 const Failure=Error(Message.code==='caption_helper_missing'?'caption_helper_missing':'caption_interrupted');
	 const Stopping=ConcurrentCaptions.fail(Message.requestId,Message.attempt,Failure);
	 if(Session&&(Transport?.attempt===Message.attempt||Owner.attempt===Message.attempt||Owner.pendingAttempt===Message.attempt)){
	  if(Transport)Transport.nativeFailureRevision=Message.nativeFailureRevision||0;
	  Session.nativeFailure=Failure;Session.failureController?.abort(Failure);
	 }
	 void Stopping.then(Result=>Respond({ok:true,...Result}),()=>Respond({ok:false}));return true;
	}
	if(Message.type==='captionPipelineCanceled'){
	 if(Sender.tab||Sender.url!==chrome.runtime.getURL('background.js'))return;
	 const Id=Message.requestId;Transfers.cancel(Id);DirectTransfers.get(Id)?.abort();
	 const Tasks=[Recordings.cancel(Id),ConcurrentCaptions.cancel(Id),CancelCaptionOutputSession(Id),...(YoutubeAvailable()?[HandleYoutubeRunner({type:'youtubeCancel',requestId:Id})]:[])];
	 void Promise.allSettled(Tasks).then(()=>Respond({ok:true}));return true;
	}
	if(['hlsCancel','folderCancel','youtubeCancel','webrtcCancel'].includes(Message.type)||Message.type==='webrtcReceiverControl'&&Message.action==='cancel'){
	 const Session=FindCaptionOutputSession(Message.requestId);
	 if(Session){
	  if(Sender.tab||Sender.url!==chrome.runtime.getURL('background.js'))return;
	  const Id=Message.requestId;Transfers.cancel(Id);DirectTransfers.get(Id)?.abort();
	  const Pending=[ConcurrentCaptions.cancel(Id),CancelCaptionOutputSession(Id),Recordings.cancel(Id),...(YoutubeAvailable()?[HandleYoutubeRunner({type:'youtubeCancel',requestId:Id})]:[])];
	  void Promise.allSettled(Pending).then(()=>Respond({ok:true,data:true}));return true;
	 }
	}
	if(Message.type==='captionPipelineResume'){
	 if(Sender.tab||Sender.url!==chrome.runtime.getURL('background.js'))return;
	 const Session=FindCaptionOutputSession(Message.requestId);
	 if(!Session?.rawFile&&!Session?.capturedInput||typeof Session.resume!=='function'||Session.running||Session.remuxing||Session.controller.signal.aborted){Respond({ok:false,error:'caption_source_missing'});return;}
	 if(Message.localCaptions&&CaptionOptionsKey(Message.localCaptions)!==CaptionOptionsKey(Session.job.localCaptions)){
	  if(Session.receipts.media){Respond({ok:false,error:'caption_state'});return;}
	  Session.job.localCaptions=Message.localCaptions;Session.retryRecognition=true;
	 }
	 void(async()=>{
	  const Transport=Session.job.captionSession||ConcurrentCaptions.bind(Session.job,Session.controller.signal).transport;Transport.retryToken=Message.retryToken;Transport.controlRevision=Message.controlRevision;
	  const Resumed=await CaptionStage(Session.job,'resumeOutput');Transport.nativeFailureRevision=Resumed.nativeFailureRevision;Session.nativeFailure=null;
	  Respond({ok:true});void Session.resume().catch(ErrorValue=>ReportFailure(Message.requestId,Session.controller.signal,undefined,ErrorValue));
	 })().catch(()=>Respond({ok:false,error:'caption_source_missing'}));return true;
	}
	if(Message.type==='captionPipelineState'){
	 if(Sender.tab||Sender.url!==chrome.runtime.getURL('background.js'))return;
	 const Session=FindCaptionOutputSession(Message.requestId);Respond({available:!!(Session?.rawFile||Session?.capturedInput&&typeof Session.resume==='function')&&!Session.controller.signal.aborted||Transfers.ids().includes(Message.requestId)||DirectTransfers.has(Message.requestId)||Recordings.ids().includes(Message.requestId)});return;
	}
	if(Message.type==='captionPipelineQuiesce'){
	 if(Sender.tab||Sender.url!==chrome.runtime.getURL('background.js'))return;
	 const Id=Message.requestId,Session=FindCaptionOutputSession(Id),Owner=ConcurrentCaptions.ownership(Id);
	 const Receiving=Transfers.ids().includes(Id)||DirectTransfers.has(Id)||Recordings.ids().includes(Id)||Owner.owned&&!Session?.rawFile&&!Session?.capturedInput;
	 if(Session?.running||Session?.remuxing){Respond({ok:false,busy:true});return;}
	 if(Receiving&&!Message.failed){Respond({ok:false,busy:true,owned:true});return;}
	 if(Receiving&&Message.failed&&!Owner.owned){Respond({ok:false,busy:true,owned:true});return;}
	 if(!Session&&!Owner.owned){Respond({ok:true,owned:false});return;}
	 if(Owner.owned&&Message.attempt!==undefined&&Owner.attempt!==Message.attempt){Respond({ok:false,busy:true,owned:true});return;}
	 if(Session?.controller.signal.aborted){Respond({ok:false,owned:true});return;}
	 void(async()=>{
	  if(!Session?.finalizedRecognition){await ConcurrentCaptions.suspend(Session?.job||{requestId:Id});if(Session)Session.retryRecognition=true;}
	  Respond({ok:true,owned:true,receiving:Receiving,finalized:!!Session?.finalizedRecognition});
	 })().catch(()=>Respond({ok:false,busy:true,owned:true}));return true;
	}
	if (['youtubeDiscover', 'youtubeRun', 'youtubeCancel', 'youtubeActive', 'youtubeSnapshot', 'youtubeFinish'].includes(Message.type))
	{
		if (Sender.tab || Sender.url !== chrome.runtime.getURL('background.js') || !YoutubeAvailable()) return;
		HandleYoutubeRunner(Message, {report: LocalReport, saveFile: SaveMediaFile}).then(
			Data => Respond({ok: true, data: Data}), ErrorValue => Respond({ok: false, error: SerializeError(ErrorValue)}));
		return true;
	}
	// 실행을 만드는 메시지는 워커에서만 받으며 실행 직전 출처를 다시 검사합니다.
	if (['hlsRun', 'folderRun', 'hlsSnapshot', 'webrtcReceive', 'webrtcPrepare'].includes(Message.type))
	{
		if (Sender.tab || Sender.url !== chrome.runtime.getURL('background.js')) return;
		try { AssertMediaAllowed(Message.job); AssertMediaAllowed(Message.source); }
		catch (ErrorValue) { Respond({ok: false, error: SerializeError(ErrorValue)}); return; }
	}
	if (Message.type.startsWith('webrtc'))
	{
		// 페이지는 직접 전송 문서를 제어하지 못합니다. SW가 원래 발신 문서를 붙인 릴레이만 검증합니다.
		if (Sender.tab) return;
		let Pending;
		switch (Message.type)
		{
			case 'webrtcReceive':
				Pending = (async () =>
				{
					const RecordingJob = {...Message.job, background: true};
					await Recordings.prepare(RecordingJob);
					const Receiver = StartWebRtcReceiver(Message.connection, {
						signal:Recordings.signal(RecordingJob.requestId),
						mimeTypes:RecordingMimeTypes(RecordingJob.localCaptions?.enabled),
						onFormat:Mime=>Recordings.setMimeType(RecordingJob.requestId,Mime),
						onStart: StartedAt =>
      {
       try{AlignRecordingSubtitles(RecordingJob.subtitleTracks,StartedAt);}
       catch{RecordingJob.subtitleTracks=[];PreparedCaptionTracks.set(RecordingJob.requestId,[]);void ReportSubtitleError(RecordingJob).catch(()=>{});}
      },
						onData: BlobValue => Recordings.appendBlob(Message.job.requestId, BlobValue),
						onEnd: Reason => Recordings.finish(Message.job.requestId, undefined, Reason),
					});
					Receivers.set(Message.job.requestId, Receiver);
					try { return {ok: true, started: await Receiver.ready}; }
					catch (ErrorValue)
					{
						await Receiver.stop(ErrorValue.message);
						const Key = ['webrtc_connection_lost', 'webrtc_media_stalled', 'webrtc_quality_unavailable',
							'webrtc_unsupported', 'webrtc_recording_failed', 'webrtc_buffer_limit'].includes(ErrorValue.message)
							? ErrorValue.message : 'webrtc_recording_failed';
						throw new LocalizedError(Key);
					}
				})();
				break;
			case 'webrtcReceiverControl':
				Pending = (async () =>
				{
					const Receiver = Receivers.get(Message.requestId);
					if (Message.action === 'cancel' || Message.action === 'finish' && !Receiver)
					{
						const Canceling = Recordings.cancel(Message.requestId);
						await Receiver?.stop('canceled');
						return {ok: await Canceling};
					}
					if (Message.action !== 'finish' || !Receiver) return {ok: false};
					await Receiver.stop('requested'); return {ok: true};
				})();
				break;
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
		void (YoutubeAvailable() ? HandleYoutubeRunner({type: 'youtubeActive'}) : Promise.resolve([])).then(YoutubeIds =>
			Respond({requestIds: [...Transfers.ids(), ...Snapshots.ids(),...CaptionOutputSessionIds()], directIds: [...DirectTransfers.keys(),...CaptionOutputSessionIds()], recordingIds: [...Recordings.ids(),...CaptionOutputSessionIds()], youtubeIds: [...YoutubeIds,...CaptionOutputSessionIds()]}));
		return true;
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
					const MissingCaptions=Message.job.subtitleCount>0 && !PreparedCaptionTracks.has(Message.parentId);
					Snapshots.register(Message.parentId,()=>({direct:Message.source,subtitleTracks:PreparedCaptionTracks.get(Message.parentId) || [],subtitleError:MissingCaptions}));
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
