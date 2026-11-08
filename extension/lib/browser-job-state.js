/**
 * 저장한 작업을 Chrome 다운로드 항목과 연결하여 화면용 상태를 계산합니다. 해당 확장이 시작한 항목만 접근하고, 삭제된 항목은 작업 자체의 기록으로 표시합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { IsHtmlMediaType } from './media.js';
import { MessageRef } from './i18n.js';

/** 화면과 일괄 삭제가 동일한 상태 기준으로 작업을 분류합니다. */
export function JobGroup(State)
{
	if (['active', 'paused', 'starting'].includes(State))
	{
		return 'active';
	}
	return State === 'complete' ? 'complete' : 'attention';
}

/** 확장이 직접 시작한 다운로드만 반환합니다. 다른 확장과 일반 브라우저 다운로드는 작업에 연결하지 않습니다. */
export async function GetBrowserDownload(Id)
{
	if (!Number.isInteger(Id))
	{
		return null;
	}
	const [Item] = await chrome.downloads.search({ id: Id });
	return Item?.byExtensionId === chrome.runtime.id ? Item : null;
}

/** 영속 작업 기록과 Chrome 다운로드 상태를 합쳐 UI가 읽는 스냅샷을 만듭니다. */
export function SummarizeJob(Job, Item, Runners = {}, bRegistering = false)
{
	const Interrupted = Job.recording && (Job.recordingInterrupted ?? Job.partial === true);
	if (!Item && Interrupted && Job.state === 'complete')
		return {...Job, state: 'interrupted', error: MessageRef('webrtc_interrupted_saved')};
	if (!Item)
	{
		if ((Job.hls || Job.recording || Job.youtube || Job.pickedDownloadFolder || Job.subtitleMux) && Job.downloadId === undefined)
		{
			const Running = Job.recording ? Runners.recordingIds?.includes(Job.requestId)
			: Job.youtube ? Runners.youtubeIds?.includes(Job.requestId)
			: Job.hls ? Runners.requestIds?.includes(Job.requestId) || Runners.requestId === Job.requestId
			: Runners.directIds?.includes(Job.requestId);
			if (Job.state !== 'active' || Running || bRegistering)
			{
				return Job;
			}
			return { ...Job, state: 'failed', error: MessageRef('job_runner_closed') };
		}
		const State = bRegistering && Job.state === 'starting' ? 'starting'
		: Job.state === 'failed' ? 'failed' : 'unknown';
		return { ...Job, state: State };
	}

	const Filename = Item.filename.split(/[\\/]/).at(-1) || Job.filename;
	const bWrongType = Item.state === 'complete' && IsHtmlMediaType(Item.mime);
	const State = bWrongType ? 'failed'
	: Item.state === 'complete' ? Interrupted ? 'interrupted' : 'complete'
	: Item.state === 'in_progress' ? (Item.paused ? 'paused' : 'active')
	: Item.error === 'USER_CANCELED' ? 'canceled' : 'failed';
	return {
		...Job, filename: Filename, state: State,
		error: bWrongType ? MessageRef('job_not_video') : State === 'interrupted' ? MessageRef('webrtc_interrupted_saved')
		: Item.error && MessageRef('job_browser_error', Item.error),
		hasUrl: /^https?:\/\//i.test(Item.url),
		bytesReceived: (Job.hls || Job.recording || Job.youtube) && ['complete', 'interrupted'].includes(State) ? Job.bytesReceived : Item.bytesReceived,
		totalBytes: Item.totalBytes,
		startTime: Job.hls || Job.recording || Job.youtube ? new Date(Job.created).toISOString() : Item.startTime,
		endTime: Item.endTime, paused: Item.paused,
		canResume: Item.canResume, exists: Item.exists,
	};
}

/** 현재 화면에 필요한 ID만 묶어서 조회합니다. 브라우저의 전체 다운로드 내역을 읽지 않습니다. */
export async function LoadBrowserDownloads(Jobs)
{
	const Ids = [...new Set(Jobs.map(Job => Job.downloadId).filter(Number.isInteger))];
	const Items = new Map();
	// 관련 작업의 Chrome ID만 조회합니다. 많은 작업이 있어도 한꺼번에 브라우저로 요청하지 않도록 묶음을 나눕니다.
	for (let Index = 0; Index < Ids.length; Index += RuntimePolicy.Jobs.BrowserLookupBatchSize)
	{
		const Batch = await Promise.all(Ids.slice(Index, Index + RuntimePolicy.Jobs.BrowserLookupBatchSize).map(GetBrowserDownload));
		for (const Item of Batch)
		{
			if (Item)
			{
				Items.set(Item.id, Item);
			}
		}
	}
	return Items;
}
