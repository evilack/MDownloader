/**
 * 각 화면에 필요한 작업만 워커에서 읽습니다. 브라우저 이벤트에 포함되지 않는 바이트 정보는 진행 중 항목만 주기적으로 보충합니다.
 * 숨겨진 화면에서는 조회를 멈추고, 다시 보일 때 전체 상태를 읽어 오래된 응답을 버립니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { JobIdFromKey } from './job-storage.js';
import { SendRequest } from './ui.js';

// 각 화면이 조회한 작업 스냅샷을 따로 유지합니다. 워커는 관리자 전체 또는 팝업에 보이는 미디어 범위의 현재 상태를 반환합니다.
export function ObserveJobs({ debugJob: DebugJob, mediaKeys: LocalMediaKeys, onUpdate: OnUpdate, onError: OnError })
{
	const Observed = new Map();
	const DownloadOwners = new Map();
	const ChangedDownloads = new Set();
	const Active = new Set();
	const Queued = new Set();
	let bFullRefresh = false;
	let bScheduled = false;
	let bReading = false;
	let VisibilityRevision = 0;
	let ProgressTimer;
	function SyncTimer()
	{
		if (document.hidden || !Active.size)
		{
			clearTimeout(ProgressTimer);
			ProgressTimer = undefined;
		}
		else if (ProgressTimer === undefined)
		{
			// Chrome 다운로드 변경 이벤트에는 받은 바이트가 포함되지 않습니다.
			// 진행 중에는 주기적으로 확인하여 전송 문서가 예고 없이 종료된 경우도 감지합니다.
			ProgressTimer = setTimeout(() =>
			{
				ProgressTimer = undefined;
				Refresh(Active);
			}, RuntimePolicy.Jobs.RefreshIntervalMs);
		}
	}

	function Schedule()
	{
		if (bScheduled || bReading || document.hidden || (!bFullRefresh && !Queued.size))
		{
			return;
		}
		bScheduled = true;
		queueMicrotask(Read);
	}

	function Refresh(RequestIds)
	{
		if (RequestIds === undefined)
		{
			bFullRefresh = true;
			Queued.clear();
		}
		else if (!bFullRefresh && !document.hidden)
		{
			for (const Id of RequestIds)
			{
				if (!DebugJob || Id === DebugJob)
				{
					Queued.add(Id);
				}
			}
		}
		Schedule();
	}

	function ApplyUpdates(Jobs, RequestedIds)
	{
		const Changes = new Map(Jobs.map(Job => [Job.requestId, Job]));
		for (const Id of RequestedIds ?? Observed.keys())
		{
			if (!Changes.has(Id) && Observed.has(Id))
			{
				Changes.set(Id, null);
			}
		}
		for (const [Id, Job] of Changes)
		{
			const PreviousDownload = Observed.get(Id);
			if (PreviousDownload !== undefined && PreviousDownload !== Job?.downloadId)
			{
				DownloadOwners.delete(PreviousDownload);
			}
			if (Job)
			{
				Observed.set(Id, Job.downloadId);
				if (Job.downloadId !== undefined)
				{
					DownloadOwners.set(Job.downloadId, Id);
				}
			}
			else
			{
				Observed.delete(Id);
			}
			// 브라우저 상태는 이벤트로 받고, 바이트 변화가 필요한 작업만 주기 조회 대상으로 둡니다.
			if (Job?.state === 'active' || Job?.state === 'starting')
			{
				Active.add(Id);
			}
			else
			{
				Active.delete(Id);
			}
		}
		OnUpdate(Changes);
	}

	async function Read()
	{
		bScheduled = false;
		if (document.hidden)
		{
			return;
		}
		const RequestIds = bFullRefresh ? (DebugJob ? [DebugJob] : undefined) : [...Queued];
		bFullRefresh = false;
		Queued.clear();
		bReading = true;
		const Revision = VisibilityRevision;
		try
		{
			const Jobs = LocalMediaKeys?.size === 0 ? [] : await SendRequest('jobs', {
				requestIds: RequestIds, ...(LocalMediaKeys ? { mediaKeys: [...LocalMediaKeys] } : {}),
			});
			if (VisibilityRevision === Revision)
			{
				ApplyUpdates(Jobs, RequestIds);
			}
		}
		catch (ErrorValue)
		{
			if (VisibilityRevision === Revision)
			{
				OnError(ErrorValue);
			}
		}
		finally
		{
			bReading = false;
			for (const Id of ChangedDownloads)
			{
				OnNativeChange(Id);
			}
			ChangedDownloads.clear();
			Schedule();
			SyncTimer();
		}
	}

	function OnNativeChange(DownloadId)
	{
		if (document.hidden)
		{
			return;
		}
		// 조회가 끝나기 전에 이 화면이 아직 모르는 Chrome ID의 이벤트가 올 수 있습니다.
		// 해당 이벤트는 보관했다가 새 작업과 Chrome ID의 연결을 반영한 뒤 처리합니다.
		if (bReading)
		{
			ChangedDownloads.add(DownloadId);
			return;
		}
		const Id = DownloadOwners.get(DownloadId);
		if (Id !== undefined)
		{
			Refresh([Id]);
		}
	}

	chrome.downloads.onChanged.addListener(({ id: Id }) => OnNativeChange(Id));
	chrome.downloads.onErased.addListener(OnNativeChange);
	chrome.storage.onChanged.addListener((Changes, Area) =>
	{
		if (Area !== 'local')
		{
			return;
		}
		const RequestIds = [];
		for (const [Key, Change] of Object.entries(Changes))
		{
			const Id = JobIdFromKey(Key);
			if (!Id)
			{
				continue;
			}
			if (!LocalMediaKeys || Observed.has(Id) || LocalMediaKeys.has(Change.oldValue?.mediaKey) || LocalMediaKeys.has(Change.newValue?.mediaKey))
			{
				RequestIds.push(Id);
			}
		}
		if (RequestIds.length)
		{
			Refresh(RequestIds);
		}
	});
	document.addEventListener('visibilitychange', () =>
	{
		// 숨겨지기 전에 시작한 조회는 화면이 바뀌면 버립니다.
		// 숨겨진 동안의 변경은 화면을 다시 열 때 전체 조회로 반영합니다.
		VisibilityRevision++;
		if (!document.hidden)
		{
			Refresh();
		}
		SyncTimer();
	});
	Refresh();
	return Refresh;
}
