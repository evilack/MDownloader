import {CreateYoutubeClient} from './client.js';
import {YoutubeQualities} from './qualities.js';
import {ReceiveSabrTracks} from './sabr.js';
import {RemuxYoutubeTracks, YoutubePrefixReady} from './remux.js';
import {LocalizedError, SerializeError} from '../../lib/i18n.js';
import {CreateStreamWorkspaces} from '../../lib/stream-workspaces.js';
import {ReceiveYoutubeCaptions} from './captions.js';
import {MuxSubtitles} from '../../lib/subtitle-mux.js';
import {SubtitleStatus} from '../../lib/subtitle-status.js';
import {CreateYoutubeTrackStore} from './track-store.js';
import {CreateTransferSnapshots} from '../../lib/transfer-snapshots.js';
import {WaitForYoutubeBroadcast} from './live.js';
import {CaptionTiming,ConcurrentCaptions} from '../../lib/local-captions-runner.js';
import {RetainCaptionSource,FindCaptionOutputSession,ReleaseCaptionOutputSession} from '../../lib/caption-output-session.js';
import {CreateCaptionJournal,StartCommittedCaptions} from '../../lib/caption-committed-input.js';
const HasPermission = async Url => (await chrome.runtime.sendMessage({type: 'youtubePermission', origin: new URL(Url).origin})).allowed === true;
export function CreateYoutubeRunner({client: Client = CreateYoutubeClient({hasPermission: HasPermission}),
	receive: Receive = ReceiveSabrTracks, remux: Remux = RemuxYoutubeTracks,
	receiveCaptions: ReceiveCaptions = ReceiveYoutubeCaptions, muxCaptions: MuxCaptions = MuxSubtitles,
	prefixReady: PrefixReady = YoutubePrefixReady,
	waitForBroadcast: WaitForBroadcast = WaitForYoutubeBroadcast,
	workspaces: Workspaces = CreateStreamWorkspaces('mdownloader-youtube')} = {})
{
const Active = new Map();
const Snapshots = CreateTransferSnapshots(async (Job, Snapshot, Signal) =>
{
	let Directory;
	try
	{
		await Snapshot.dependencies.report(Job.requestId, 'partialStarted');
		Directory = await Workspaces.create(Job.requestId);
		await SaveOutput(Job, Snapshot.media, Snapshot.captions, Directory, Signal, Snapshot.dependencies, true);
	}
	catch (ErrorValue)
	{
		await Snapshot.dependencies.report(Job.requestId, 'failure', {canceled: Signal.aborted||ErrorValue?.name==='AbortError',
			error: SerializeError(ErrorValue instanceof LocalizedError ? ErrorValue : new LocalizedError('youtube_sabr_receive_failed'))}).catch(() => {});
		throw ErrorValue;
	}
	finally { if (Directory) await Workspaces.release(Job.requestId); }
});
async function SaveOutput(Job, Media, Captions, Directory, Signal, {report: Report, saveFile: SaveFile}, Partial)
{
	const Bytes = Media.video.size + Media.audio.size;
	await Report(Job.requestId, 'progress', {received: Bytes, muxing: true});
	const Output = await Directory.getFileHandle('result.mp4', {create: true});
	const Writer = await Output.createWritable();
	let Timing;
	try { Timing = await Remux(Media.video, Media.audio, Writer, Signal, {preserveTrackEnds: !Partial}); }
	catch (ErrorValue) { await Writer.abort().catch(() => {}); throw ErrorValue; }
	Signal.throwIfAborted();
	if (Partial)
	{
		const Filename = await Report(Job.requestId, 'youtubePartial', {receipt: {partial: true, videoBytes: Media.video.size,
			audioBytes: Media.audio.size, start: Timing.start, duration: Timing.duration}});
		if (typeof Filename === 'string') Job = {...Job, filename: Filename};
	}
	let MediaFile = await Output.getFile();
	Job.captionFinalTiming=Timing;
	if(Job.captionPreparation&&!Job.snapshot)await CaptionTiming(Job,Timing.start,{clipped:!!Partial,signal:Signal});
 const OutputTracks=Partial?Captions.tracks.map(Track=>({...Track,offset:(Track.offset??0)-Timing.start,allowEmptyAfterClip:true})):Captions.tracks;
 await SaveFile({...Job,partial:Job.partial||Partial,subtitleTracks:OutputTracks,subtitleStatus:Captions.status},MediaFile,Signal,undefined,'video/mp4');
}
async function Discover({pageUrl:PageUrl,watchPlayer:WatchPlayer})
{
	const Info = await Client.DiscoverYoutube({pageUrl: PageUrl, transport: 'sabr',...(WatchPlayer?{watchPlayer:WatchPlayer}:{})});
	const Qualities = YoutubeQualities(Info);
	// The CDN for a future/live broadcast can change after the user's confirm gesture.
	let ServerPermission = 'https://*.googlevideo.com/*';
	if (Info.mode === 'upcoming') return Qualities.map(Q => ({...Q, title: Info.title, serverPermission: ServerPermission}));
	try { await Client.ResolveYoutubeSelection(Qualities[0].quality); }
	catch (ErrorValue)
	{
		if (ErrorValue.code !== 'youtube_permission_denied' || !ErrorValue.permissionOrigin) throw ErrorValue;
		ServerPermission ??= ErrorValue.permissionOrigin + '/*';
	}
	return Qualities.map(Q => ({...Q, title: Info.title, captions: Info.captions, serverPermission: ServerPermission}));
}
async function Run(Job, Quality, Session, Dependencies)
{
	const {controller: Controller, stop: Stop} = Session;
	const {report: Report} = Dependencies;
	let Directory;
	let Progress = Promise.resolve();
	const Signal = Controller.signal;
	if(Job.localCaptions?.enabled&&!Job.snapshot)ConcurrentCaptions.bind(Job,Signal);
	try
	{
		if (Quality.scheduled) Quality = await WaitForBroadcast(Client, Quality, {signal: Signal,
			report: Fields => Report(Job.requestId, 'progress', {received: 0, ...Fields})});
		const Resolved = await Client.ResolveYoutubeSelection(Quality, Signal);
		const Live = !!Resolved.config.live;
		if (Live || Job.waiting) await Report(Job.requestId, 'connecting', {live: Live});
		Directory = await Workspaces.create(Job.requestId);
		if(Job.localCaptions?.enabled&&!Job.snapshot)RetainCaptionSource(Job,await Workspaces.retain(Job.requestId));
		const Journal=CreateCaptionJournal(Job,'youtube-audio',Signal);
		const Store = CreateYoutubeTrackStore(Directory,{audioJournal:Journal,sealReason:()=>Stop.signal.aborted?'finish':'eof'});
		StartCommittedCaptions(Job,Journal,Directory,Signal);
		const Translation = Job.subtitleOptions?.translation;
		let Captions,CaptionReceipt;
		try{
		 Captions=await ReceiveCaptions(Client,Quality,Signal,{includeAutoGenerated:Job.includeYoutubeAutoCaptions!==false,trackIds:Job.subtitleOptions?.trackIds,translation:Translation,hasPermission:HasPermission,
		  report:async Receipt=>{CaptionReceipt=Receipt;await Report(Job.requestId,'youtubeCaptions',{receipt:Receipt});
		   if(Translation)await Report(Job.requestId,'subtitleStatus',{status:{phase:'collecting',count:Receipt.count,completed:Receipt.completed,languages:[],targetLanguage:Translation.targetLanguage,translation:Translation.enabled?'pending':'off'}});}});
		 }catch(ErrorValue){Signal.throwIfAborted();Captions={tracks:[],receipt:{phase:'failed',count:CaptionReceipt?.count ?? Job.subtitleStatus?.count ?? 0,completed:0,tracks:[],errorCount:1}};}
		await Report(Job.requestId,'youtubeCaptions',{receipt:Captions.receipt});
		let Status=(Translation || Captions.receipt.phase==='failed') && {...SubtitleStatus(Captions.tracks,Translation),
		 phase:Captions.receipt.phase==='failed'?'failed':Captions.tracks.length?'ready':'undetected',count:Captions.receipt.count,completed:Captions.tracks.length,...(Captions.receipt.errorCount?{errorCount:Captions.receipt.errorCount}:{})};
		if(Status?.phase==='failed' && Translation?.enabled)Status.translation='unknown';
		Captions.status=Status || undefined;
		if(Status)await Report(Job.requestId,'subtitleStatus',{status:Status});
		Signal.throwIfAborted();
		Session.receiving = true;
		Snapshots.register(Job.requestId, () => Session.receiving && Session.available && !Stop.signal.aborted && !Signal.aborted
			? {media: Store.snapshot(), captions: Captions, dependencies: Dependencies} : null);
		let LastReport = 0;
		const Received = await Receive(Resolved.config, Resolved.selection, {
			signal: Signal, stopSignal: Stop.signal, hasPermission: HasPermission,
			createWriter: Kind => Store.writer(Kind),
			report: Event => {
				if (Event.stage !== 'sabr-bytes' || Stop.signal.aborted) return;
				if (Date.now() - LastReport < 300) return;
				LastReport = Date.now();
				Progress = Progress.then(async () => {
					const Ready = Session.receiving && !Stop.signal.aborted && !Signal.aborted && await PrefixReady(Store.snapshot());
					Session.available = Ready && Session.receiving && !Stop.signal.aborted && !Signal.aborted;
					await Report(Job.requestId, 'progress', {received: Event.video + Event.audio, snapshotAvailable: Session.available, live: Live, waiting: false});
				});
				void Progress.catch(() => Controller.abort());
			},
		});
		Session.receiving = false;
		await Progress; Signal.throwIfAborted();
		await Report(Job.requestId, 'youtubeReceived', {receipt: {videoBytes: Received.bytes.video, audioBytes: Received.bytes.audio,
			videoEndMs: Received.videoEndMs, audioEndMs: Received.audioEndMs}});
		await SaveOutput(Job, Store.snapshot(), Captions, Directory, Signal, Dependencies, !!Received.partial || Live);
	}
	catch (ErrorValue)
	{
		if(!FindCaptionOutputSession(Job.requestId)?.rawFile||Signal.aborted){if(!Signal.aborted)Controller.abort(ErrorValue);await ConcurrentCaptions.cancel(Job.requestId).catch(()=>{});}
		// 수신기가 모든 reader를 종료한 뒤, 앞서 읽은 active 스냅샷의 쓰기가 끝나야 종료 상태를 확정합니다.
		await Progress.catch(() => {});
		await Report(Job.requestId, 'failure', {canceled: Signal.reason?.name==='AbortError'||ErrorValue?.name==='AbortError',
			error: SerializeError(ErrorValue instanceof LocalizedError ? ErrorValue : new LocalizedError('youtube_sabr_receive_failed'))}).catch(() => {});
	}
	finally
	{
		Session.receiving = false;
		await Job.captionPreparation;
		if(!FindCaptionOutputSession(Job.requestId)?.rawFile||Signal.aborted)await ReleaseCaptionOutputSession(Job.requestId);
		await Snapshots.close(Job.requestId);
		if (Directory) await Workspaces.release(Job.requestId);
		Active.delete(Job.requestId);
	}
}
return async function HandleYoutubeRunner(Message, Dependencies)
{
	switch (Message.type)
	{
		case 'youtubeDiscover': return Discover(Message);
		case 'youtubeRun':
		{
			if (!/^[a-f\d-]{36}$/i.test(Message.job?.requestId)) throw new LocalizedError('job_invalid_request');
			if (Active.has(Message.job.requestId)) return true;
			const Session = {controller: new AbortController(), stop: new AbortController()}; Active.set(Message.job.requestId, Session);
			void Run(Message.job, Message.quality, Session, Dependencies); return true;
		}
		case 'youtubeCancel':
		{
			const Session = Active.get(Message.requestId); Session?.controller.abort(); return !!Session || Snapshots.cancel(Message.requestId);
		}
		case 'youtubeFinish':
		{
			const Session = Active.get(Message.requestId);
			if (!Session?.receiving || !Session.available || Session.stop.signal.aborted || Session.controller.signal.aborted) return false;
			Session.stop.abort(); return true;
		}
		case 'youtubeSnapshot':
			if (!/^[a-f\d-]{36}$/i.test(Message.job?.requestId) || Message.job.requestId === Message.requestId || !Message.job.youtube || !Message.job.snapshot || Message.job.snapshotParent !== Message.requestId) throw new LocalizedError('job_invalid_request');
			return Snapshots.save(Message.requestId, Message.job);
		case 'youtubeActive': return [...Active.keys(), ...Snapshots.ids()];
		default: throw new LocalizedError('request_unsupported');
	}
}
}
export const HandleYoutubeRunner = CreateYoutubeRunner();
