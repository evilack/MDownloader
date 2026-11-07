/**
 * 다운로드 실패를 재현할 때 필요한 단계, 결과 코드, 숫자만 저장합니다. 켜기·끄기·삭제와 새 로그 쓰기가 겹치더라도 잠금 안에서 읽고 갱신합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { IsHtmlMediaType } from './media.js';
import { CreateSettingsCache, GetSetting, SetSetting, SettingKeys } from './settings.js';
import {DebugLog} from './debug-log.js';
export const DownloadLogKey = 'download-log';
export const DownloadLogLimit = RuntimePolicy.Jobs.MaxLogEntries;
import {DownloadStages as StageLabels, DownloadResults} from './download-events.js';
const Results = new Set(DownloadResults);
let Settings;
let Storage;
async function IsLoggingEnabled()
{
	if (Storage !== chrome.storage)
	{
		Settings?.Dispose();
		Storage = chrome.storage;
		Settings = CreateSettingsCache([SettingKeys.logDownloads], Storage);
	}
	try
	{
		await Settings.Ready;
	}
	catch
	{
		return false;
	}
	return Settings.Get(SettingKeys.logDownloads);
}

export const DownloadStageLabel = Stage => Object.hasOwn(StageLabels, Stage) ? StageLabels[Stage] : 'view_stage_unknown';
export async function ReadDownloadLog()
{
	const Data = (await chrome.storage.local.get(DownloadLogKey))[DownloadLogKey];
	return Array.isArray(Data) ? Data : [];
}

// 옵션 화면과 워커가 같은 잠금을 사용합니다. 로그 해제·삭제와 새 기록 쓰기가 겹쳐도 서로의 변경을 덮어쓰지 않습니다.
export const ClearDownloadLog = () => navigator.locks.request(DownloadLogKey, () => chrome.storage.local.remove(DownloadLogKey));
export const SetDownloadLogging = bEnabled =>
navigator.locks.request(DownloadLogKey, async () =>
{
	await SetSetting(SettingKeys.logDownloads, bEnabled);
	// 같은 문맥의 옵션 변경은 Chrome의 비동기 변경 이벤트를 기다리지 않아도 즉시 반영합니다.
	if (Storage === chrome.storage)
	{
		Settings.Update(SettingKeys.logDownloads, bEnabled);
	}
});
export async function RecordDownloadLog(Result, { requestId: RequestId, downloadId: DownloadId, stage: Stage, status: Status, reason: Reason, browserError: BrowserError } = {})
{
	if (!Results.has(Result))
	{
		return;
	}
	try
	{
		if (!await IsLoggingEnabled())
		{
			return;
		}
		const Entry = { at: Date.now(), result: Result };
		// 로그에는 정해진 코드와 숫자만 기록합니다. 오류 인수, Chrome 다운로드 항목, 전체 진단에는 주소나 민감한 정보가 포함될 수 있습니다.
		if (typeof RequestId === 'string' && /^[a-f\d-]{36}$/i.test(RequestId))
		{
			Entry.requestId = RequestId;
		}
		if (Number.isInteger(DownloadId))
		{
			Entry.downloadId = DownloadId;
		}
		if (Object.hasOwn(StageLabels, Stage))
		{
			Entry.stage = Stage;
		}
		if (Number.isInteger(Status) && Status >= 100 && Status <= 599)
		{
			Entry.status = Status;
		}
		if (typeof Reason === 'string' && /^(job|stream|folder|request)_[a-z_]{1,64}$/.test(Reason))
		{
			Entry.reason = Reason;
		}
		if (typeof BrowserError === 'string' && /^[A-Z_]{1,64}$/.test(BrowserError))
		{
			Entry.browserError = BrowserError;
		}
		await navigator.locks.request(DownloadLogKey, async () =>
		{
			if (!Settings.Get(SettingKeys.logDownloads))
			{
				return;
			}
			// 다른 문맥의 OFF 저장이 끝나도 storage.onChanged 도착은 늦을 수 있습니다.
			// OFF 캐시는 즉시 반환하고, ON 쓰기만 동일 잠금 안에서 영속 옵션을 재확인합니다.
			if (!await GetSetting(SettingKeys.logDownloads))
			{
				Settings.Update(SettingKeys.logDownloads, false);
				return;
			}
			const Previous = await ReadDownloadLog();
			await chrome.storage.local.set({ [DownloadLogKey]: [...Previous.slice(1 - DownloadLogLimit), Entry] });
		});
	}
	catch
	{
		// 진단 저장 실패는 실제 다운로드의 성공 여부와 분리합니다.

	}
}

export async function RecordBrowserDownload({ id: Id, state: State, error: ErrorValue })
{
	if (!['complete', 'interrupted'].includes(State?.current))
	{
		return;
	}
	if (!DebugLog.IsEnabled() && !await IsLoggingEnabled())
	{
		return;
	}
	const [Item] = await chrome.downloads.search({ id: Id });
	if (Item?.byExtensionId !== chrome.runtime.id)
	{
		return;
	}
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('SaveFinished', () => ({ downloadId: Id, bytes: Item.bytesReceived,
			result: State.current === 'complete' && !IsHtmlMediaType(Item.mime) ? 'complete' :
			(ErrorValue?.current ?? Item.error) === 'USER_CANCELED' ? 'canceled' : 'failed' }));
	}
	if (State.current === 'complete')
	{
		const bWrongType = IsHtmlMediaType(Item.mime);
		return RecordDownloadLog(bWrongType ? 'failed' : 'complete', {
			downloadId: Id, ...(bWrongType ? { reason: 'job_not_video' } : {}),
		});
	}
	const BrowserError = ErrorValue?.current ?? Item.error;
	return RecordDownloadLog(BrowserError === 'USER_CANCELED' ? 'canceled' : 'failed', { downloadId: Id, browserError: BrowserError });
}
