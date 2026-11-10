/**
 * 한 작업에서 영상·오디오 트랙의 조각을 받아 임시 파일에 저장합니다. 라이브 재생목록에서는 시퀀스 번호로 이미 받은 구간을 건너뜁니다.
 * 전송 실패 시 닫히지 않은 파일과 진행 바이트를 함께 되돌려, 화면의 완료 조각 수가 실제 저장 상태와 맞도록 합니다.
 */
import { RuntimePolicy, Units } from './runtime-policy.js';
import { LocalizedError } from './i18n.js';
import { ParseMediaPlaylist } from './hls.js';
import { TransferSegments } from './segment-transfer.js';
import { ReadPlaylist } from './hls-http.js';
import {HlsDecryptor, HlsResourceUrls, ReadHlsBytes, CopyHlsResource} from './hls-encryption.js';
import { HasTransportStreamSync, MPEG_TS_PACKET_BYTES } from './mpeg-ts.js';
import {ReadCommittedSnapshot} from './committed-snapshot.js';
import {InitializeHlsLiveStart} from './hls-live-start.js';
export const InitializationKey = ({ url: Url, range: LocalRange, encryption: Encryption }) => JSON.stringify([Url, LocalRange?.start, LocalRange?.end, Encryption?.id]);
const CaptureResourceIdentity=Segment=>JSON.stringify({url:Segment.url,range:Segment.range||null,parts:Segment.parts?.map(P=>({url:P.url,range:P.range||null})),encryption:Segment.encryption?.id||null});
export function LocalPlaylist(Segments)
{
	if (!Segments.length)
	{
		throw new LocalizedError('stream_no_segments');
	}
	const Target = Math.ceil(Math.max(...Segments.map(Segment => Segment.duration)));
	const Lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:' + Target];
	let Init;
	for (const Segment of Segments)
	{
		if (Segment.discontinuity)
		{
			Lines.push('#EXT-X-DISCONTINUITY');
		}
		if (Segment.init && Init !== Segment.init)
		{
			Init = Segment.init;
			Lines.push(`#EXT-X-MAP:URI="${Init}"`);
		}
		Lines.push('#EXTINF:' + Segment.duration + ',', Segment.path);
	}
	Lines.push('#EXT-X-ENDLIST', '');
	return Lines.join('\n');
}

function WaitForRefresh(Milliseconds, Signal)
{
	if (Signal.aborted)
	{
		return Promise.resolve();
	}
	return new Promise(Resolve =>
	{
		const Timer = setTimeout(Done, Milliseconds);
		function Done()
		{
			clearTimeout(Timer);
			Signal.removeEventListener('abort', Done);
			Resolve();
		}
		Signal.addEventListener('abort', Done, { once: true });
	});
}

export async function DownloadTracks(Sources, Options)
{
	// Finish has a wall-clock deadline: a trickling response can keep renewing
	// its idle timeout indefinitely. Abort only input reads, preserving output.
	const Pending = new AbortController();
	let Timer;
	const Finish = () => { Timer = setTimeout(() => Pending.abort(), RuntimePolicy.Transfer.FinishGraceMs); };
	const {finishSignal: FinishSignal, controller: Controller} = Options;
	FinishSignal.addEventListener('abort', Finish, {once: true});
	if (FinishSignal.aborted) Finish();
	try
	{
		return await DownloadTrackResources(Sources, {...Options, transferSignal: AbortSignal.any([Controller.signal, Pending.signal])});
	}
	catch(ErrorValue){Options.capture?.fail(ErrorValue);throw ErrorValue;}
	finally
	{
		clearTimeout(Timer);
		FinishSignal.removeEventListener('abort', Finish);
	}
}

async function DownloadTrackResources(Sources, {
	workspace: Workspace, controller: Controller, finishSignal: FinishSignal, authorize: Authorize, progress: Progress, observedContext: ObservedContext, preview: Preview,
	snapshot: RegisterSnapshot, audioReady: AudioReady, capture: Capture,
	liveStart: LiveStart, transferSignal: TransferSignal,
})
{
	const { signal: Signal } = Controller;
	const Decryptor = new HlsDecryptor((Resource, Limit) => ReadHlsBytes(Resource, Limit, TransferSignal, ObservedContext));
	const Tracks = Sources.map((Source,Index) => ({ ...Source, id:'track-'+Index, saved: [], identities:new Map(),next: undefined, captureEnd:0 }));
	InitializeHlsLiveStart(Tracks, LiveStart, RuntimePolicy.Transfer.LiveStartTargetDurations);
	Capture?.configure(Tracks.map(T=>({id:T.id,audio:T.audio,presentationTimeOffset:T.playlist.presentationTimeOffset})));
	// 중지 후 저장은 새 요청을 막고 제한 시간 안에 닫힌 조각의 연속 구간만 저장합니다.
	const Stop = AbortSignal.any([Signal, FinishSignal]);
	const Initialization = new Map();
	const Live = Tracks.some(Track => !Track.playlist.ended);
	let Dvr = Tracks.some(Track => Track.playlist.dvr === true);
	let Buffered = 0;
	let Receiving = 0;
	let Received = 0;
	let Finished = 0;
	let Writes = Promise.resolve();
	let Count = 0;
	let FirstPreview;
	let NextProgressAt = 0;
	let bSnapshotAvailable = false;
	const Committed = new Map();
	let AudioPublished=false;
	const ReadSnapshot=()=>Capture?Capture.snapshot():ReadCommittedSnapshot(Tracks,Committed);
	RegisterSnapshot?.(ReadSnapshot);
	const StopSelectionNotifications=Capture?.observeSelection(()=>{if(RegisterSnapshot&&!bSnapshotAvailable)void PublishProgress().catch(()=>{});});
	function PublishProgress()
	{
		NextProgressAt = performance.now() + RuntimePolicy.Transfer.ProgressReportIntervalMs;
		// 속도에는 현재 쓰고 있는 조각의 바이트도 포함합니다.
		// 완료 개수는 파일 쓰기가 끝날 때만 올리고 실패한 시도의 바이트는 되돌립니다.
		// 파일이 닫혔더라도 짧은 음성이 첫 영상 조각을 덮지 못하면 저장할 수 없습니다.
		// 연속 구간은 이후 줄어들지 않으므로 준비된 뒤에는 재계산하지 않습니다.
		if (RegisterSnapshot && !bSnapshotAvailable)
		{
			bSnapshotAvailable = !!ReadSnapshot();
		}
		const SnapshotState = RegisterSnapshot ? {snapshotAvailable: bSnapshotAvailable} : {};
		const State = {live: Live, ...(Dvr ? {dvr: true} : {}), count: Count, received: Buffered + Receiving, finished: Finished, ...SnapshotState};
		Writes = Writes.then(() => Progress(State));
		return Writes;
	}

	try{
	for (; ; )
	{
		const BatchStarted = performance.now();
		const TrackQueues = [];
		for (const Track of Tracks)
		{
			const Queue = [];
			const Admitted = [];
			TrackQueues.push(Queue);
			const { segments: Segments } = Track.playlist;
			if(Capture)for(const Segment of Segments){const Old=Track.identities.get(Segment.sequence);
				if(Old&&(Old.resourceIdentity!==CaptureResourceIdentity(Segment)||Old.initIdentity!==(Segment.init?InitializationKey(Segment.init):null)||Old.discontinuitySequence!==(Segment.discontinuitySequence??0)||Old.duration!==Segment.duration))throw Error('stream_capture_identity');}
			// 파싱한 조각은 연속 시퀀스 번호를 사용합니다.
			// 새 조각이 시작하는 위치를 바로 계산하여 이전 창과 겹치는 조각을 다시 탐색하지 않습니다.
			const Start = Segments.length && Track.next !== undefined ? Math.max(0, Track.next - Segments[0].sequence) : 0;
			if (Start < Segments.length && Track.next !== undefined && Segments[Start].sequence !== Track.next)
			{
				throw new LocalizedError('stream_live_segment_expired');
			}
			for (let Index = Start; Index < Segments.length; Index++)
			{
				const Segment = Segments[Index];
				if (Count >= RuntimePolicy.Transfer.MaxSegments)
				{
					throw new LocalizedError('stream_too_many_segments');
				}
				let Init;
				if (Segment.init)
				{
					const Key = InitializationKey(Segment.init);
					Init = Initialization.get(Key);
					if (!Init)
					{
						Init = `init-${Initialization.size}.mp4`;
						Initialization.set(Key, Init);
						Queue.push({ ...Segment.init, path: Init });
					}
				}
				const Path = `segment-${Count++}.${Init ? 'm4s' : Track.audio ? 'aac' : 'ts'}`;
				Queue.push({ ...Segment, path: Path, isMedia: true, checkTs: !Init && !Track.audio });
				const ResourceIdentity=CaptureResourceIdentity(Segment);
				const InitIdentity=Segment.init?InitializationKey(Segment.init):null;
				const Descriptor={id:JSON.stringify([Track.id,Segment.sequence,ResourceIdentity,InitIdentity]),trackId:Track.id,ordinal:Track.saved.length,
					sourceSequence:Segment.sequence,discontinuitySequence:Segment.discontinuitySequence??0,resourceIdentity:ResourceIdentity,initIdentity:InitIdentity,
					programDateTime:Segment.programDateTime??null,playlistStart:Track.captureEnd,duration:Segment.duration,discontinuity:!!Segment.discontinuity,init:Init,initPath:Init,path:Path};
				Descriptor.range=Segment.range?Object.freeze({...Segment.range}):null;
				Descriptor.initRange=Segment.init?.range?Object.freeze({...Segment.init.range}):null;
				Track.saved.push(Descriptor);Track.identities.set(Segment.sequence,Descriptor);Admitted.push(Descriptor);Track.captureEnd+=Segment.duration;
				Track.next = Segment.sequence + 1;
			}
			Capture?.append(Track.id,Admitted);
		}
		// 분리 음성이 영상 전체 뒤로 밀리면 중간 저장 시 재생할 음성이 없습니다. 트랙별 요청을 번갈아 배정합니다.
		const Queue = [];
		for (let Index = 0; TrackQueues.some(Resources => Index < Resources.length); Index++)
		{
			for (const Resources of TrackQueues)
			{
				if (Index < Resources.length)
				{
					Queue.push(Resources[Index]);
				}
			}
		}

		if (Queue.length)
		{
			const First = Tracks[0].saved[0];
			if (Preview && First && !FirstPreview)
			{
				// 초기화 파일과 영상 조각이 서로 다른 병렬 작업에서 끝날 수 있습니다. 둘 다 저장되기 전에는 미리보기로 넘기지 않습니다.
				FirstPreview = { playlist: LocalPlaylist([First]), pending: new Set([First.init, First.path].filter(Boolean)) };
			}
			await Authorize([...new Set(Queue.flatMap(HlsResourceUrls))]);
			await PublishProgress();
			// Keep the conservative limit for a single observed server, while
			// independent CDN hosts can use the normal bounded transfer pool.
			const Parallelism = ObservedContext && new Set(Queue.map(Resource => new URL(Resource.url).origin)).size < 2
				? RuntimePolicy.Transfer.ObservedRequestLanes : undefined;
			await TransferSegments(Queue, Controller, async Resource =>
			{
				const { path: Path, isMedia: IsMedia, checkTs: CheckTs } = Resource;
				const Handle = await Workspace.getFileHandle(Path, { create: true });
				const Writer = await Handle.createWritable();
				let Written = 0;
				try
				{
					// 부분 조각은 시퀀스 순서대로 같은 임시 파일에 씁니다. 실패하면 전체 그룹 쓰기를 되돌려 재시도합니다.
					for (const Part of Resource.parts ?? [Resource])
					{
						await CopyHlsResource(Part, RuntimePolicy.Transfer.MaxSegmentBytes - Written, TransferSignal, async Chunk =>
						{
							if (CheckTs && !HasTransportStreamSync(Chunk, Written))
							{
								throw new LocalizedError('stream_invalid_mpeg_ts');
							}
							Buffered += Chunk.byteLength;
							Written += Chunk.byteLength;
							if (Buffered > RuntimePolicy.Transfer.MaxStreamScratchBytes)
							{
								throw new LocalizedError('stream_temporary_storage_limit');
							}
							await Writer.write(Chunk);
							if (performance.now() >= NextProgressAt)
							{
								await PublishProgress();
							}
						}, Decryptor, ObservedContext, async Delta =>
						{
							Receiving += Delta;
							if (Delta > 0 && (performance.now() >= NextProgressAt || !Buffered && Receiving === Delta))
								await PublishProgress();
						});
					}
					if (CheckTs && Written % MPEG_TS_PACKET_BYTES)
					{
						throw new LocalizedError('stream_segment_incomplete');
					}
					await Writer.close();
					const ClosedFile=await Handle.getFile();
					if(ClosedFile.size!==Written)throw new LocalizedError('stream_segment_incomplete');
					Committed.set(Path, Written);
					Capture?.commit(Path, Written);
					Received += Written;
					if (IsMedia)
					{
						Finished++;
					}
				}
				catch (ErrorValue)
				{
					Buffered -= Written;
					await Writer.abort().catch(() =>
					{
					});
						await PublishProgress().catch(() => {});
					throw ErrorValue;
				}
				if (FirstPreview?.pending.delete(Path) && !FirstPreview.pending.size)
				{
					Preview(FirstPreview.playlist);
				}
				const AudioTrack=Tracks.find(Track=>Track.audio);
				const VideoFirst=Tracks[0].saved[0],VideoClockReady=VideoFirst&&Committed.has(VideoFirst.path)&&(!VideoFirst.init||Committed.has(VideoFirst.init));
				if(AudioReady && !AudioPublished && VideoClockReady && AudioTrack?.playlist.ended && AudioTrack.saved.length && !AudioTrack.saved.some(S=>S.discontinuity) && AudioTrack.saved.every(S=>Committed.has(S.path)&&(!S.init||Committed.has(S.init)))){
					AudioPublished=true;AudioReady(LocalPlaylist(AudioTrack.saved),LocalPlaylist([VideoFirst]));
				}
				await PublishProgress();
			}, Parallelism, FinishSignal);
		}

		Signal.throwIfAborted();
		const Open = Tracks.filter(Track => !Track.playlist.ended);
		if (!Open.length || FinishSignal.aborted)
		{
			break;
		}
		const Interval = Math.min(...Open.map(Track => Track.playlist.targetDuration));
		// 새 조각이 없으면 재생목록 목표 길이의 절반 뒤에 다시 확인합니다. 너무 자주 요청하지 않도록 최소 간격을 둡니다.
		const ReloadAfter = Interval * Units.MillisecondsPerSecond / (Queue.length ? 1 : 2);
		await WaitForRefresh(Math.max(RuntimePolicy.Transfer.MinLiveRefreshMs, ReloadAfter - (performance.now() - BatchStarted)), Stop);
		Signal.throwIfAborted();
		if (FinishSignal.aborted)
		{
			break;
		}
		await Authorize(Open.map(Track => Track.url));
		await Promise.all(Open.map(async Track =>
		{
			try
			{
				Track.playlist = ParseMediaPlaylist(await ReadPlaylist(Track.url, Stop, ObservedContext), Track.url);
			}
			catch (ErrorValue)
			{
				if (!FinishSignal.aborted || Signal.aborted)
				{
					throw ErrorValue;
				}
			}
		}));
		Dvr ||= Tracks.some(Track => Track.playlist.dvr === true);
		if (FinishSignal.aborted)
		{
			break;
		}
	}

	const CapturedSnapshot=Capture?await Capture.selectCommitted():null;
	await Writes;
	const SelectedSnapshot=FinishSignal.aborted?(Capture?CapturedSnapshot:ReadCommittedSnapshot(Tracks,Committed)):{video:Tracks[0].saved,audio:Tracks[1]?.saved};
	if(!SelectedSnapshot)throw new LocalizedError('stream_no_segments');
	const SelectedByTrack=SelectedSnapshot.selectedByTrack||Object.fromEntries(Tracks.map((T,I)=>[T.id,(I===0?SelectedSnapshot.video:SelectedSnapshot.audio).map(S=>S.id)]));
	const FinalCapture=Capture?.freezeSelection(SelectedByTrack);
	Capture?.seal({reason:FinishSignal.aborted?'finish':'eof',selectedByTrack:SelectedByTrack});
	if (FinishSignal.aborted)
	{
		const Snapshot = SelectedSnapshot;
		if (!Snapshot)
		{
			throw new LocalizedError('stream_no_segments');
		}
		return {capture:FinalCapture,reason:'finish',video: LocalPlaylist(Snapshot.video), audio: Snapshot.audio && LocalPlaylist(Snapshot.audio),
			progress: Snapshot.progress, partial: !Live && Snapshot.progress.finished < Count};
	}
	return {capture:FinalCapture,reason:'eof',video: LocalPlaylist(Tracks[0].saved), audio: Tracks[1] && LocalPlaylist(Tracks[1].saved),
		progress: { live: false, count: Count, received: Received, finished: Finished } };
	}finally{StopSelectionNotifications?.();}
}
