/**
 * 전송 단계와 HTTP 결과를 조각 다운로드 코드에서 받아 기록합니다. 주소 대신 지문을 남겨 같은 소스의 기존 403을 판단할 수 있게 합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { HlsHttpError } from './hls-http.js';
import { RetryableTransferError } from './segment-transfer.js';
import { DebugLog } from './debug-log.js';
const SourceFingerprintBytes = 8;
const DenialKey = 'hls-master-denials';
const LatestTransferKey = 'hls-diagnostic:transfer';
const LegacyInspectionKey = 'hls-diagnostic:inspection';
async function HlsSourceId(Address)
{
	const Digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(Address));
	return [...new Uint8Array(Digest).slice(0, SourceFingerprintBytes)]
	.map(Byte => Byte.toString(16).padStart(2, '0')).join('');
}

const IsMasterDenial = UiEvent => UiEvent?.stage === 'master-request' &&
UiEvent.result === 'http-error' && UiEvent.status === 403;
export async function KnownMasterDenial(Address)
{
	const Source = await HlsSourceId(Address);
	const Cached = (await chrome.storage.local.get(DenialKey))[DenialKey]?.find(Entry => Entry.source === Source);
	if (Cached)
	{
		return Cached.event;
	}
	// 이전 버전은 거부 결과를 마지막 검사 진단 안에 저장했습니다. 해당 형식도 읽어서 사용할 수 있습니다.
	const Previous = (await chrome.storage.local.get(LegacyInspectionKey))[LegacyInspectionKey];
	const UiEvent = Previous?.events?.at(-1);
	if (Previous?.source === Source && IsMasterDenial(UiEvent))
	{
		return UiEvent;
	}
}

export async function SaveTransferTrace(Trace)
{
	const UiEvent = Trace.events.at(-1);
	if (Trace.source && IsMasterDenial(UiEvent))
	{
		const Saved = (await chrome.storage.local.get(DenialKey))[DenialKey] ?? [];
		const Remaining = Saved.filter(Entry => Entry.source !== Trace.source);
		await chrome.storage.local.set({
			[DenialKey]: [{ source: Trace.source, event: UiEvent }, ...Remaining].slice(0, RuntimePolicy.Jobs.MaxRememberedDenials),
		});
	}
	await chrome.storage.local.set({ [LatestTransferKey]: Trace });
}

// 전송 문서는 단계 이벤트를 만들고 워커만 저장합니다.
// 미디어 주소나 원문 오류 대신 지문으로 이전 거부 결과를 찾습니다.
export async function StartHlsTrace(Address, RequestId, Persist)
{
	const Events = [];
	let Stage;
	let Source;
	let Started;
	async function Identify(Url)
	{
		Source = await HlsSourceId(Url);
	}
	if (Address)
	{
		await Identify(Address);
	}
	async function Record(UiEvent)
	{
		if (DebugLog.IsEnabled())
		{
			DebugLog.Record('TransferStage', () => ({ requestId: RequestId, stage: Stage,
				result: UiEvent.result, status: UiEvent.status, bytes: UiEvent.bytes, received: UiEvent.received,
				finished: UiEvent.finished, segments: UiEvent.segments, variants: UiEvent.variants, bandwidth: UiEvent.bandwidth,
				durationMs: Started === undefined ? undefined : performance.now() - Started }));
		}
		Events.push({ at: Date.now(), stage: Stage, ...UiEvent });
		// 이 기록은 진행 UI와 이전 403 판정에도 쓰입니다. 상세 로그 OFF에도 기능상 남기되,
		// 긴 라이브에서 매번 전체 이력이 커지지 않도록 최근 단계만 전송합니다.
		if (Events.length > RuntimePolicy.Debug.MaxTraceEvents)
		{
			Events.shift();
		}
		await Persist({ requestId: RequestId, ...(Source ? { source: Source } : {}), events: [...Events] }).catch(() =>
		{
		});
	}
	return {
		identify: Identify,
		async begin(Next)
		{
			Stage = Next;
			Started = DebugLog.IsEnabled() ? performance.now() : undefined;
			await Record({ result: 'started' });
		},
		async finish(Details = {})
		{
			await Record({ result: 'ok', ...Details });
		},
		async fail(ErrorValue, bCanceled = false)
		{
			if (bCanceled)
			{
				return Record({ result: 'canceled' });
			}
			if ((ErrorValue instanceof HlsHttpError || ErrorValue instanceof RetryableTransferError) && Number.isInteger(ErrorValue.status))
			{
				return Record({ result: 'http-error', status: ErrorValue.status, challenge: !!ErrorValue.challenge });
			}
			return Record({ result: 'failed', errorType: ErrorValue instanceof TypeError ? 'TypeError' : 'Error' });
		},
	};
}
