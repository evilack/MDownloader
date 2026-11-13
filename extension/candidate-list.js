/**
 * 현재 탭에서 발견한 미디어 목록의 갱신을 조정합니다. 화면이 보일 때만 네트워크 이벤트를 묶어 다시 조회하고, 행은 썸네일·다운로드·복사 컨트롤을 조합해 만듭니다.
 * 탭이 바뀌거나 새 스캔을 시작하면 세대 번호가 달라집니다. 이전 요청이 늦게 끝나도 새 목록에 결과를 섞지 않습니다.
 */
import { RuntimePolicy } from './lib/runtime-policy.js';
import { ErrorText, GetLocale, LocalizedError, Translate } from './lib/i18n.js';
import { CreateElement, SendRequest } from './lib/ui.js';
import { MediaContextCacheKey, NetworkCacheKey, ScanStorageKey } from './lib/detection-cache.js';
import { CreateCandidateJobStatus } from './popup-job-status.js';
import { ObserveCandidateThumbnails, PreviewTile } from './media-thumbnails.js';
import { CreateCandidateDownloadActions } from './candidate-download.js';
import { MediaFormat } from './lib/media.js';
import { StartVisibleSourceRefresh } from './lib/source-refresh.js';
import { CreatePlaybackHint } from './lib/playback-hint.js';
import {CreateCandidateRow} from './candidate-row.js';
export function CreateCandidateList({ root: Root, mediaPreview: MediaPreview, scrollRoot: ScrollRoot = null, followTabs: bFollowTabs = false, reportShownJobs: ReportShownJobs })
{
	const List = Root.querySelector('#candidates');
	const Status = Root.querySelector('[data-candidate-status]');
	const PermissionLink = Root.querySelector('[data-candidate-permission-link]');
	Status.before(CreatePlaybackHint({ getPage: () => Tab }));
	const ScanButton = Root.querySelector('#scan') ?? document.querySelector('#scan');
	const CountFormat = new Intl.NumberFormat(GetLocale());
	const Announce = Message =>
	{
		if (Status.textContent !== Message)
		{
			Status.textContent = Message;
		}
	};
	const DownloadActions = CreateCandidateDownloadActions(Announce, OnActionFinished, WaitForScan);
	const ShowJobStatuses = CreateCandidateJobStatus(undefined,ReportShownJobs);
	let bEnabled = false;
	let Tab;
	let bRestricted = false;
	let Generation = 0;
	let bRefreshNeeded = false;
	let RefreshTimer;
	let StopThumbnails;
	let RenderSignature;
	let RowContexts = [];
	let ThumbnailInput;
	let PendingScan;
	let bManualQueued = false;
	let StopSourceRefresh;
	let SubtitleLookupRows, SubtitleLookupTime = 0, SubtitleLookupRevision = 0;
	async function LoadSubtitleStatuses(Rows = RowContexts, Force = false)
	{
		if (!Rows.length || !bEnabled) return;
		if (!Force && SubtitleLookupRows === Rows && Date.now() - SubtitleLookupTime < 5000) return;
		SubtitleLookupRows = Rows;
		SubtitleLookupTime = Date.now();
		const Revision = ++SubtitleLookupRevision;
		try
		{
			const Result = await SendRequest('candidateSubtitleStatuses', {...Rows[0].input, candidateIds: Rows.map(Row => Row.input.candidateId)});
			if (Rows !== RowContexts || !bEnabled || Revision !== SubtitleLookupRevision) return;
			for (const Item of Result)
			{
				const Row = Rows.find(Entry => Entry.input.candidateId === Item.id);
				if (Row) {
					Row.entry.updateSource({...Object.fromEntries(Object.entries(Item).filter(([Key])=>['upcoming','scheduledStartTime','live'].includes(Key))),subtitleStatus:Item.status});
				}
			}
		}
		catch
		{
			if (Rows === RowContexts && Revision === SubtitleLookupRevision) for (const Row of Rows) Row.entry.updateSource({subtitleStatus:{phase:'failed',translation:'unknown'}});
		}
	}
	async function WaitForScan()
	{
		while (PendingScan)
		{
			await PendingScan;
		}
	}

	function OnActionFinished()
	{
		if (bManualQueued && bEnabled && !document.hidden && !PendingScan && !DownloadActions.IsBusy())
		{
			bManualQueued = false;
			void RunScan(true);
		}
		else
		{
			ScheduleRefresh();
		}
	}

	function ScheduleRefresh()
	{
		if (!bEnabled || document.hidden || !bRefreshNeeded || RefreshTimer || DownloadActions.IsBusy() || PendingScan)
		{
			return;
		}
		RefreshTimer = setTimeout(() =>
		{
			RefreshTimer = undefined;
			if (!bEnabled || document.hidden || !bRefreshNeeded || DownloadActions.IsBusy() || PendingScan)
			{
				return;
			}
			void RunScan();
		}, RuntimePolicy.Detection.RefreshDelayMs);
	}

	async function RunScan(bManual = false)
	{
		if (!bEnabled || document.hidden)
		{
			return;
		}
		if (DownloadActions.IsBusy())
		{
			bRefreshNeeded = true;
			if (bManual)
			{
				bManualQueued = true;
			}
			return;
		}
		if (PendingScan)
		{
			if (bManual)
			{
				bManualQueued = true;
			}
			return;
		}
		bRefreshNeeded = false;
		const Version = ++Generation;
		const Completion = {};
		Completion.promise = new Promise(Resolve =>
		{
			Completion.resolve = Resolve;
		});
		PendingScan = Completion.promise;
		if (bManual || RenderSignature === undefined)
		{
			ScanButton.disabled = true;
		}
		const ResumePreview = MediaPreview.isHoveringWithin(List);
		// 자동 검사 중에는 마지막으로 확정한 결과를 유지합니다. 첫 검사와 사용자 요청만
		// 진행 문구를 표시하여 같은 빈 결과를 수백 번 읽어도 안내 문구가 왕복하지 않게 합니다.
		if (bManual || RenderSignature === undefined)
		{
			Announce(Translate('view_scan_in_progress'));
		}
		try
		{
			const [ActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (Version !== Generation)
			{
				return;
			}
			Tab = ActiveTab;
			if (Tab?.id === undefined)
			{
				throw new LocalizedError('view_scan_no_tab');
			}
			const Result = await SendRequest('scan', { tabId: Tab.id });
			if (Version !== Generation)
			{
				return;
			}
			if (Result.changed)
			{
				return Invalidate();
			}
			bRestricted = Result.restricted === true;
			if (PermissionLink) PermissionLink.hidden = !Result.missingOrigins?.length && !Result.accessUnknown;
			const PermissionMessage = Result.missingOrigins?.length
				? Translate('view_site_access_needed', Result.missingOrigins.map(Origin => Origin.slice(0, -2)).join(', '))
				: Result.accessUnknown ? Translate('view_site_access_unknown') : undefined;
			if (bRestricted)
			{
				ClearCandidates();
				ShowJobStatuses();
				return Announce(PermissionMessage ?? Translate('view_scan_restricted'));
			}
			const Supported = Result.candidates.filter(Item => Item.supported).length;
			Announce(PermissionMessage ?? (Supported ? Translate('view_scan_found', CountFormat.format(Supported)) : Translate('view_scan_empty')));
			const Signature = JSON.stringify([Tab.id, Result.candidates.map(Item => [Item.id, Item.mediaKey, Item.name,
					Item.format, Item.supported, Item.serverPermission, Item.sitePermission, Item.playlistPath, Item.live])]);
			if (Signature === RenderSignature)
			{
				// 워커의 스캔 ID는 매 검사마다 바뀝니다. DOM과 호버 영상은 그대로 두되
				// 버튼·썸네일이 다음 요청에서 사용하는 식별자는 최신 검사로 연결합니다.
				for (const Row of RowContexts)
				{
					Row.input.scanId = Result.scanId;
					Row.generation = Version;
				}
				if (ThumbnailInput)
				{
					ThumbnailInput.scanId = Result.scanId;
				}
				void LoadSubtitleStatuses();
				return;
			}
			ClearCandidates();
			// 화면 밖에서 행을 모두 구성한 뒤 한 번에 교체하여 중간에 불완전한 목록이 표시되지 않게 합니다.
			const Candidates = document.createDocumentFragment();
			const Badges = new Map();
			const Thumbnails = new Map();
			for (const Candidate of Result.candidates)
			{
    let Row;
    const DisplayName=Candidate.playlistPath?.split('/').slice(-RuntimePolicy.Detection.PlaylistPathDepth).join('/') ?? Candidate.name;
    if(Candidate.supported) {
     const Input={tabId:Tab.id,scanId:Result.scanId,candidateId:Candidate.id};
     const RowContext={input:Input,generation:Version};
     RowContexts.push(RowContext);
     const Thumbnail=PreviewTile(MediaPreview,async()=>{await WaitForScan();return SendRequest('previewCandidate',Input);},async()=>{await WaitForScan();return SendRequest('captureCandidatePreview',Input);});
     Thumbnails.set(Candidate.id,Thumbnail);
     const Download=DownloadActions.CreateDownloadButton(Candidate,Input,()=>RowContext.generation===Generation,()=>{
      // Split panes clip inline options to the media list's scroll area.
      // Let the native dialog use the full panel viewport instead.
      if(List.closest('.panel-resizable')) return;
      const Slot=CreateElement('li','','quality-slot');
      Slot.id='download-options-slot-'+crypto.randomUUID();
      Download.setAttribute('aria-controls',Slot.id);
      Download.setAttribute('aria-expanded','true');
      Row.after(Slot);
      return {container:Slot,dispose:()=>{
       Slot.remove();Download.removeAttribute('aria-controls');Download.removeAttribute('aria-expanded');
      }};
     });
     const Entry=CreateCandidateRow({...Candidate,displayName:DisplayName},{thumbnail:Thumbnail,download:Download,
      loadLink:async()=>{await WaitForScan();return SendRequest('candidateUrl',Input);},announce:Announce});
     RowContext.subtitleStatus=Entry.subtitleStatus;
     RowContext.entry=Entry;
     Badges.set(Candidate.mediaKey,Entry);
     Row=Entry.row;
    }
				else
				{
					Row=CreateElement('li','','candidate unsupported');
					const Filename=CreateElement('strong',DisplayName,'filename');
					const Format = Candidate.format === MediaFormat.Unknown ? Translate('view_format_unknown') : Candidate.format;
					Row.append(Filename, CreateElement('span', Translate('view_download_unsupported', Format), 'candidate-status muted'));
				}
				Candidates.append(Row);
			}
			List.replaceChildren(Candidates);
			RenderSignature = Signature;
			if (ResumePreview)
			{
				MediaPreview.resumeHover(List);
			}
			ShowJobStatuses(Badges);
			void LoadSubtitleStatuses();
			if (Thumbnails.size)
			{
				ThumbnailInput = { tabId: Tab.id, scanId: Result.scanId };
				StopThumbnails = ObserveCandidateThumbnails(ScrollRoot, ThumbnailInput, Thumbnails);
			}
		}
		catch (ErrorValue)
		{
			if (Version === Generation && (bManual || RenderSignature === undefined))
			{
				ShowJobStatuses();
				Announce(ErrorText(ErrorValue));
			}
		}
		finally
		{
			if (PendingScan === Completion.promise)
			{
				PendingScan = undefined;
			}
			if (Version === Generation)
			{
				for (const Row of RowContexts)
				{
					Row.generation = Version;
				}
				if (ScanButton.disabled)
				{
					ScanButton.disabled = false;
				}
				if (bManualQueued)
				{
					bManualQueued = false;
					void RunScan(true);
				}
				else
				{
					ScheduleRefresh();
				}
			}
			Completion.resolve();
		}
	}

	function ClearCandidates()
	{
		RenderSignature = undefined;
		RowContexts = [];
		ThumbnailInput = undefined;
		StopThumbnails?.();
		StopThumbnails = undefined;
		for (const Tile of List.querySelectorAll('.candidate-preview'))
		{
			MediaPreview.close(Tile);
		}
		List.replaceChildren();
	}

	function Invalidate()
	{
		Generation++;
		clearTimeout(RefreshTimer);
		RefreshTimer = undefined;
		bRefreshNeeded = false;
		bManualQueued = false;
		PendingScan = undefined;
		DownloadActions.CloseQuality();
		ClearCandidates();
		ShowJobStatuses();
		ScanButton.disabled = false;
		if (PermissionLink) PermissionLink.hidden = true;
		Announce(Translate('view_scan_page_changed'));
	}

	function QueueRefresh()
	{
		bRefreshNeeded = true;
		ScheduleRefresh();
	}

	chrome.tabs.onUpdated.addListener((TabId, Change) =>
	{
		if (!bEnabled || TabId !== Tab?.id)
		{
			return;
		}
		if (Change.status === 'loading' || Change.url)
		{
			Invalidate();
		}
		if (Change.status === 'complete' || (Change.url && Change.status !== 'loading'))
		{
			QueueRefresh();
		}
	});
	chrome.tabs.onActivated.addListener(Info =>
	{
		if (!bEnabled || Info.tabId === Tab?.id || (Tab && Info.windowId !== Tab.windowId))
		{
			return;
		}
		Invalidate();
		if (bFollowTabs)
		{
			QueueRefresh();
		}
	});
	function OnSitePermissionsChanged({origins: Origins})
	{
		if (bEnabled && Origins?.length) QueueRefresh();
	}
	chrome.permissions?.onAdded?.addListener(OnSitePermissionsChanged);
	chrome.permissions?.onRemoved?.addListener(OnSitePermissionsChanged);
	chrome.storage.onChanged.addListener((Changes, Area) =>
	{
		if (Area === 'local' && Changes.subtitleTranslation && bEnabled) void LoadSubtitleStatuses(RowContexts, true);
		if (!bEnabled || Area !== 'session' || Tab?.id === undefined)
		{
			return;
		}
		// 툴바 팝업을 여는 동작으로 Chrome이 현재 탭에 임시 접근을 부여할 수 있습니다.
		// 사이드 패널이 앞서 접근하지 못했다면 팝업의 새 스캔 뒤에 다시 확인합니다.
		const PopupScanned = bFollowTabs && bRestricted && Changes[ScanStorageKey(Tab.id)]?.newValue;
		if (PopupScanned || Changes[NetworkCacheKey(Tab.id)] || Changes[MediaContextCacheKey(Tab.id)])
		{
			QueueRefresh();
		}
	});
	document.addEventListener('visibilitychange', () =>
	{
		if (bEnabled && !document.hidden)
		{
			if (bFollowTabs)
			{
				Invalidate();
			}
			QueueRefresh();
		}
	});
	ScanButton.addEventListener('click', () => void RunScan(true));
	return {
		get tab()
		{
			return Tab;
		},
		announce: Announce,
		setEnabled(Next)
		{
			if (bEnabled === Next)
			{
				return;
			}
			bEnabled = Next;
			if (bEnabled)
			{
				StopSourceRefresh = StartVisibleSourceRefresh(QueueRefresh);
				void RunScan();
			}
			else
			{
				StopSourceRefresh?.();
				StopSourceRefresh = undefined;
				Invalidate();
			}
		},
	};
}
