import {CreateYoutubeClient} from './client.js';
import {YoutubeQualities} from './qualities.js';
import {ReceiveSabrTracks} from './sabr.js';
import {RemuxYoutubeTracks} from './remux.js';
import {LocalizedError, SerializeError} from '../../lib/i18n.js';
import {CreateStreamWorkspaces} from '../../lib/stream-workspaces.js';
const HasPermission = async Url => (await chrome.runtime.sendMessage({type: 'youtubePermission', origin: new URL(Url).origin})).allowed === true;
export function CreateYoutubeRunner({client: Client = CreateYoutubeClient({hasPermission: HasPermission}),
	receive: Receive = ReceiveSabrTracks, remux: Remux = RemuxYoutubeTracks,
	workspaces: Workspaces = CreateStreamWorkspaces('mdownloader-youtube')} = {})
{
const Active = new Map();
async function Discover(PageUrl)
{
	const Info = await Client.DiscoverYoutube({pageUrl: PageUrl, transport: 'sabr'});
	const Qualities = YoutubeQualities(Info);
	let ServerPermission;
	try { await Client.ResolveYoutubeSelection(Qualities[0].quality); }
	catch (ErrorValue)
	{
		if (ErrorValue.code !== 'youtube_permission_denied' || !ErrorValue.permissionOrigin) throw ErrorValue;
		ServerPermission = ErrorValue.permissionOrigin + '/*';
	}
	return Qualities.map(Q => ({...Q, title: Info.title, serverPermission: ServerPermission}));
}
async function Run(Job, Quality, Controller, {report: Report, saveFile: SaveFile})
{
	let Directory;
	let Progress = Promise.resolve();
	const Signal = Controller.signal;
	try
	{
		const Resolved = await Client.ResolveYoutubeSelection(Quality, Signal);
		Directory = await Workspaces.create(Job.requestId);
		let LastReport = 0;
		const Received = await Receive(Resolved.config, Resolved.selection, {
			signal: Signal, hasPermission: HasPermission,
			createWriter: async Kind => (await Directory.getFileHandle(Kind + '.mp4', {create: true})).createWritable(),
			report: Event => {
				if (Event.stage !== 'sabr-bytes' || Date.now() - LastReport < 300) return;
				LastReport = Date.now();
				Progress = Progress.then(() => Report(Job.requestId, 'progress', {received: Event.video + Event.audio}));
				void Progress.catch(() => Controller.abort());
			},
		});
		await Progress; Signal.throwIfAborted();
		const Bytes = Received.bytes.video + Received.bytes.audio;
		await Report(Job.requestId, 'youtubeReceived', {receipt: {videoBytes: Received.bytes.video, audioBytes: Received.bytes.audio,
			videoEndMs: Received.videoEndMs, audioEndMs: Received.audioEndMs}});
		await Report(Job.requestId, 'progress', {received: Bytes, muxing: true});
		const Video = await (await Directory.getFileHandle('video.mp4')).getFile();
		const Audio = await (await Directory.getFileHandle('audio.mp4')).getFile();
		const Output = await Directory.getFileHandle('result.mp4', {create: true});
		const Writer = await Output.createWritable();
		try { await Remux(Video, Audio, Writer, Signal, {preserveTrackEnds: true}); }
		catch (ErrorValue) { await Writer.abort().catch(() => {}); throw ErrorValue; }
		Signal.throwIfAborted();
		await SaveFile(Job, await Output.getFile(), Signal, undefined, 'video/mp4');
	}
	catch (ErrorValue)
	{
		// 수신기가 모든 reader를 종료한 뒤, 앞서 읽은 active 스냅샷의 쓰기가 끝나야 종료 상태를 확정합니다.
		await Progress.catch(() => {});
		await Report(Job.requestId, 'failure', {canceled: Signal.aborted,
			error: SerializeError(ErrorValue instanceof LocalizedError ? ErrorValue : new LocalizedError('youtube_sabr_receive_failed'))}).catch(() => {});
	}
	finally
	{
		if (Directory) await Workspaces.release(Job.requestId);
		Active.delete(Job.requestId);
	}
}
return async function HandleYoutubeRunner(Message, Dependencies)
{
	switch (Message.type)
	{
		case 'youtubeDiscover': return Discover(Message.pageUrl);
		case 'youtubeRun':
		{
			if (!/^[a-f\d-]{36}$/i.test(Message.job?.requestId)) throw new LocalizedError('job_invalid_request');
			if (Active.has(Message.job.requestId)) return true;
			const Controller = new AbortController(); Active.set(Message.job.requestId, Controller);
			void Run(Message.job, Message.quality, Controller, Dependencies); return true;
		}
		case 'youtubeCancel':
		{
			const Controller = Active.get(Message.requestId); Controller?.abort(); return !!Controller;
		}
		case 'youtubeActive': return [...Active.keys()];
		default: throw new LocalizedError('request_unsupported');
	}
}
}
export const HandleYoutubeRunner = CreateYoutubeRunner();
