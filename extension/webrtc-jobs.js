import {EnsureRunner, HlsRunnerUrl} from './hls-jobs.js';
import {WebRtcPageTask} from './lib/webrtc-page.js';
import {RuntimePolicy} from './lib/runtime-policy.js';
import {LocalizedError, ReceivedError} from './lib/i18n.js';
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
		func: WebRtcPageTask, args: [{...Source, excludedSelector: RuntimePolicy.Detection.AuxiliaryPlayerSelector, ...Fields}]});
	if (Frame?.documentId !== Source.documentId || Frame.result?.error)
		throw new LocalizedError(Frame?.result?.error || 'webrtc_source_changed');
	return Frame.result;
}

export async function LaunchWebRtc(Job, Candidate, TabId)
{
	const Source = {tabId: TabId, documentId: Candidate.documentId, page: Candidate.page,
		trackId: Candidate.trackId, requestId: Job.requestId, token: crypto.randomUUID()};
	await chrome.storage.session.set({[Prefix + Job.requestId]: Source});
	try
	{
		await CheckCanceled(Job.requestId);
		await EnsureRunner();
		await CheckCanceled(Job.requestId);
		const Prepared = await chrome.runtime.sendMessage({type: 'webrtcPrepare', job: {...Job, ...Source, mimeType: Candidate.mimeType}});
		if (!Prepared?.ok) throw ReceivedError(Prepared?.error, 'webrtc_recording_failed');
		await CheckCanceled(Job.requestId);
		const Started = await RunPage(Source, {action: 'start', maxChunkBytes: 192 * 1024, maxQueuedBytes: 8 * 1048576});
		if (!Started?.mimeType) throw new LocalizedError('webrtc_recording_failed');
		await CheckCanceled(Job.requestId);
		return Started;
	}
	catch (ErrorValue)
	{
		const Canceled = ErrorValue.name === 'AbortError' || await WasCanceled(Job.requestId);
		await RunPage(Source, {action: 'stop', reason: 'canceled'}).catch(() => {});
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
	if (Action === 'cancel')
	{
		// 취소 상태를 먼저 설정하여 마지막 조각이 저장 완료로 바뀌지 않게 합니다.
		const Canceled = chrome.runtime.sendMessage({type: 'webrtcCancel', requestId: RequestId}).catch(() => null);
		await RunPage(Source, {action: 'stop', reason: 'canceled'}).catch(() => {});
		await Canceled;
		return true;
	}
	if (Action !== 'finish') return false;
	try { const Result = await RunPage(Source, {action: 'stop'}); if (Result && Result.state !== 'ended') return true; }
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
	await chrome.storage.session.remove(Prefix + RequestId);
}

export async function CancelAllWebRtc()
{
	const Entries = await chrome.storage.session.get(null);
	await Promise.all(Object.keys(Entries).filter(Key => Key.startsWith(Prefix)).map(Key =>
		ControlWebRtc(Key.slice(Prefix.length), 'cancel').catch(() => false)));
}
