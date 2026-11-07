import {DownloadStages, DownloadResults} from './download-events.js';
/**
 * 실행 문맥별 상세 진단입니다. OFF에서는 데이터 함수·시계·출력·보관을 전혀 실행하지
 * 않습니다. 호출자도 IsEnabled로 감싸면 로그 전용 클로저 생성까지 생략할 수 있습니다.
 * 원문 오류/주소/헤더를 받아 재귀적으로 지우지 않고, 처음부터 코드·수치만 허용합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
export const DebugEvents = Object.freeze([
	'ActionTitleFailed', 'NetworkCacheFailed', 'DeclaredSourceFailed', 'DebugViewFailed', 'StreamFailed', 'JobControlRequested',
	'RequestStarted', 'RequestFinished', 'RequestFailed', 'Observation', 'PageChanged', 'PermissionsChanged',
	'RulesUpdated', 'QualityOptions', 'QualitySelected', 'JobRegistered', 'TransferStarted', 'TransferStage',
	'TransferProgress', 'SnapshotStarted', 'SaveFinished', 'TransferCanceled', 'PreviewStarted', 'PreviewFinished',
	'PreviewClosed', 'WorkspaceCreated', 'WorkspaceReleased', 'SegmentRetry', 'ContentScriptsSynced', 'CleanupFailed',
]);
const Events = new Set(DebugEvents);
const Stages = new Set(Object.keys(DownloadStages));
const Results = new Set(DownloadResults);
const Operations = new Set(['scan', 'candidateUrl', 'candidatePreviews', 'previewCandidate', 'captureCandidatePreview',
	'hlsQualities', 'enqueue', 'jobs', 'jobUrl', 'previewJob', 'removeJob', 'removeJobs', 'control',
	'hlsRun', 'folderRun', 'hlsSnapshot', 'hlsFinish', 'hlsCancel', 'savePlayback', 'hlsUpdate']);
const Numbers = new Set(['count', 'bytes', 'received', 'finished', 'durationMs', 'status', 'attempt', 'variants',
	'bandwidth', 'variantIndex', 'tabId', 'downloadId', 'rules', 'owners', 'registered', 'changed', 'removed', 'segments']);
const Booleans = new Set(['bAllowed', 'bObservedContext', 'bPartial', 'bCanceled', 'bLive', 'bChooseQuality']);
const FrequentEvents = new Set(['Observation', 'TransferProgress', 'RequestStarted', 'RequestFinished', 'RequestFailed', 'SegmentRetry']);
const Actions = new Set(['snapshot', 'finish', 'cancel', 'pause', 'resume', 'show']);
export function CreateDebugLogger({ sink: Sink = Entry => console.debug('[MDownloader]', Entry),
	clock: Clock = () => performance.now(), limit: Limit = RuntimePolicy.Debug.MaxEntries,
	intervalMs: IntervalMs = RuntimePolicy.Debug.EventIntervalMs } = {})
{
	let bEnabled = false;
	const Entries = [];
	// 키는 유한한 이벤트 카탈로그만 사용합니다. 주소·작업 수가 늘어도 제한 정보가 늘지 않습니다.
	const LastEvents = new Map();
	return {
		IsEnabled: () => bEnabled,
		SetEnabled(bValue)
		{
			bEnabled = bValue === true;
			if (!bEnabled)
			{
				Entries.length = 0;
				LastEvents.clear();
			}
		},
		Snapshot: () => Entries.slice(),
		Record(Event, ReadDetails)
		{
			if (!bEnabled || !Events.has(Event))
			{
				return;
			}
			try
			{
				const Now = Clock();
				const Interval = Event === 'TransferProgress' ? RuntimePolicy.Debug.ProgressIntervalMs : FrequentEvents.has(Event) ? IntervalMs : 0;
				if (Now - (LastEvents.get(Event) ?? -Infinity) < Interval)
				{
					return;
				}
				LastEvents.set(Event, Now);
				const Details = ReadDetails?.() ?? {};
				// 지연 함수 실행 중 설정이 꺼진 경우에도 해당 값을 출력하지 않습니다.
				if (!bEnabled)
				{
					return;
				}
				const Entry = { event: Event, atMs: Now };
				for (const Key of Numbers)
				{
					if (Number.isFinite(Details[Key]))
					{
						Entry[Key] = Details[Key];
					}
				}
				for (const Key of Booleans)
				{
					if (typeof Details[Key] === 'boolean')
					{
						Entry[Key] = Details[Key];
					}
				}
				if (Stages.has(Details.stage))
				{
					Entry.stage = Details.stage;
				}
				if (Results.has(Details.result))
				{
					Entry.result = Details.result;
				}
				if (Operations.has(Details.operation))
				{
					Entry.operation = Details.operation;
				}
				if (Actions.has(Details.action))
				{
					Entry.action = Details.action;
				}
				if (typeof Details.requestId === 'string' && /^[a-f\d-]{36}$/i.test(Details.requestId))
				{
					Entry.requestId = Details.requestId;
				}
				// Error.name/message/stack에도 URL이 섞일 수 있습니다. 원문 대신 미리 정한 분류만 사용합니다.
				if (Details.error instanceof TypeError)
				{
					Entry.errorType = 'TypeError';
				}
				else if (Details.error instanceof Error)
				{
					Entry.errorType = 'Error';
				}
				Object.freeze(Entry);
				if (Entries.length >= Limit)
				{
					Entries.shift();
				}
				Entries.push(Entry);
				Sink(Entry);
			}
			catch
			{
				/* 진단 실패가 실제 감지·전송·취소의 결과를 바꾸지 않습니다. */
			}
		},
	};
}

export const DebugLog = CreateDebugLogger();

/** Promise.catch에 같은 처리기를 재사용하여 OFF에서 오류 문자열·스택을 만들지 않습니다. */
export function ReportDebugFailure(ErrorValue, Event = 'CleanupFailed')
{
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record(Event, () => ({ error: ErrorValue }));
	}
}
