import {EnsureRunner, HlsRunnerUrl} from './hls-jobs.js';
import {AssertMediaAllowed} from './lib/youtube-source-policy.js';
import {WebRtcPageTask} from './lib/webrtc-page.js';
import {WebRtcQualityTask} from './lib/webrtc-quality-task.js';
import {RuntimePolicy} from './lib/runtime-policy.js';
import {LocalizedError, ReceivedError} from './lib/i18n.js';
import {ResolveCandidate} from './detection.js';
import {LoadSourceProviders} from './lib/source-provider-data.js';
import {RequireWebRtcConnection} from './lib/webrtc-descriptor.js';
import {RecordingMimeTypes} from './lib/recording-format.js';
const Prefix = 'webrtc-control:';
const CancelPrefix = 'webrtc-canceled:';
const WasCanceled = async Id => (await chrome.storage.session.get(CancelPrefix + Id))[CancelPrefix + Id] === true;
async function CheckCanceled(Id)
{
	if (await WasCanceled(Id)) throw new DOMException('Canceled', 'AbortError');
}

async function RunPage(Source, Fields)
{
	const [Frame] = await chrome.scripting.executeScript({target: {tabId: Source.tabId, documentIds: [Source.documentId]},
		func: WebRtcPageTask, args: [{...Source, mimeTypes:RecordingMimeTypes(Source.localCaptions?.enabled), excludedSelector: RuntimePolicy.Detection.AuxiliaryPlayerSelector, ...Fields}]});
	if (Frame?.documentId !== Source.documentId || Frame.result?.error)
		throw new LocalizedError(Frame?.result?.error || 'webrtc_source_changed');
	return Frame.result;
}

async function QualityPage(Source, Fields)
{
	const [Frame] = await chrome.scripting.executeScript({target: {tabId: Source.tabId, documentIds: [Source.documentId]},
		world: 'MAIN', func: WebRtcQualityTask, args: [{...Source, ...Fields}]});
	if (Frame?.documentId !== Source.documentId || Frame.result?.error)
		throw new LocalizedError(Frame?.result?.error || 'webrtc_source_changed');
	return Frame.result;
}

export async function WebRtcQualities(Input)
{
	const Item = await ResolveCandidate(Input.tabId, Input.scanId, Input.candidateId, Input.scope);
	if (Item.format !== 'WEBRTC') throw new LocalizedError('candidate_changed');
	return (await QualityPage({...Item, tabId: Input.tabId}, {action: 'list'})).qualities;
}

export async function LaunchWebRtc(Job, Candidate, TabId, Quality)
{
	AssertMediaAllowed(Candidate);
	const Source = {tabId: TabId, documentId: Candidate.documentId, page: Candidate.page,
		trackId: Candidate.trackId, requestId: Job.requestId, token: crypto.randomUUID(), background: true,localCaptions:Job.localCaptions};
	await chrome.storage.session.set({[Prefix + Job.requestId]: Source});
	try
	{
		await CheckCanceled(Job.requestId);
		const Descriptor = (await QualityPage(Source, {action: 'connection', quality: Quality})).connection;
		const Providers = await LoadSourceProviders();
		const Connection = RequireWebRtcConnection(Descriptor, Providers.mouflon?.rtcSignalingHosts);
		await CheckCanceled(Job.requestId);
		await EnsureRunner();
		await CheckCanceled(Job.requestId);
		// 연결 인증값은 이 메시지 한 번으로만 전달하며 Job/세션/진단 저장소에 기록하지 않습니다.
		const Prepared = await chrome.runtime.sendMessage({type: 'webrtcReceive', connection: Connection,
			job: {...Job, ...Source, mimeType: Candidate.mimeType, ...(Candidate.subtitles?.length ? {subtitles: Candidate.subtitles} : {})}});
		if (!Prepared?.ok) throw ReceivedError(Prepared?.error, 'webrtc_recording_failed');
		const Started = Prepared.started;
		if (!Started?.mimeType) throw new LocalizedError('webrtc_recording_failed');
		await CheckCanceled(Job.requestId);
		return Started;
	}
	catch (ErrorValue)
	{
		const Canceled = ErrorValue.name === 'AbortError' || await WasCanceled(Job.requestId);
		await chrome.runtime.sendMessage({type: 'webrtcReceiverControl', requestId: Job.requestId, action: 'cancel'}).catch(() => {});
		await chrome.runtime.sendMessage({type: 'webrtcCancel', requestId: Job.requestId}).catch(() => {});
		await chrome.storage.session.remove(Prefix + Job.requestId);
		if (Canceled) throw new DOMException('Canceled', 'AbortError');
		throw ErrorValue;
	}
}

export async function ControlWebRtc(RequestId, Action)
{
	// 등록 직후 아직 원본 제어 정보나 수신기가 준비되지 않았어도 취소 의도를 보존합니다.
	if (Action === 'cancel') await chrome.storage.session.set({[CancelPrefix + RequestId]: true});
	const Source = (await chrome.storage.session.get(Prefix + RequestId))[Prefix + RequestId];
	if (!Source) return Action === 'cancel';
	if (Source.background)
		return !!(await chrome.runtime.sendMessage({type: 'webrtcReceiverControl', requestId: RequestId, action: Action}).catch(() => null))?.ok;
	if (Action === 'cancel')
	{
		// 취소 상태를 먼저 설정하여 마지막 조각이 저장 완료로 바뀌지 않게 합니다.
		const Canceled = chrome.runtime.sendMessage({type: 'webrtcCancel', requestId: RequestId}).catch(() => null);
		await RunPage(Source, {action: 'stop', reason: 'canceled'}).catch(() => {});
		if (Source.qualityLease) await QualityPage(Source, {action: 'release'}).catch(() => {});
		await Canceled;
		return true;
	}
	if (Action !== 'finish') return false;
	try
	{
		const Result = await RunPage(Source, {action: 'stop'});
		// 아직 조각이 없는 준비 단계의 저장 종료는 시작을 취소합니다.
		if (Result?.reserved) return ControlWebRtc(RequestId, 'cancel');
		if (Result && Result.state !== 'ended') return true;
	}
	catch { /* 원본이 사라졌으면 이미 커밋한 부분만 저장합니다. */ }
	return !!(await chrome.runtime.sendMessage({type: 'webrtcForceFinish', requestId: RequestId}))?.ok;
}

export async function RelayWebRtc(Message, Sender)
{
	if (typeof Message.data === 'string' && Message.data.length > 256 * 1024) return {ok: false};
	return (await chrome.runtime.sendMessage({type: 'webrtcRelay', message: Message,
		source: {id: Sender.id, tab: {id: Sender.tab.id}, documentId: Sender.documentId, frameId: Sender.frameId, url: Sender.url}})
		.catch(() => null)) ?? {ok: false};
}

export async function WebRtcSourceLost(TabId, Page)
{
	const Contexts = await chrome.runtime.getContexts?.({contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [HlsRunnerUrl()]});
	if (!Contexts?.length) return;
	return chrome.runtime.sendMessage({type: 'webrtcSourceLost', tabId: TabId, page: Page}).catch(() => {});
}

export async function ForgetWebRtcControl(RequestId)
{
	const Source = (await chrome.storage.session.get(Prefix + RequestId))[Prefix + RequestId];
	if (Source?.qualityLease) await QualityPage(Source, {action: 'release'}).catch(() => {});
	await chrome.storage.session.remove(Prefix + RequestId);
}

export async function CancelAllWebRtc()
{
	const Entries = await chrome.storage.session.get(null);
	await Promise.all(Object.keys(Entries).filter(Key => Key.startsWith(Prefix)).map(Key =>
		ControlWebRtc(Key.slice(Prefix.length), 'cancel').catch(() => false)));
}
