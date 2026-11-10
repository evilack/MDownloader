import { InitializeDebugLogging } from './lib/debug-runtime.js';
void InitializeDebugLogging();
/**
 * 사이드 패널의 시작점입니다. 감지한 미디어 영역과 다운로드 영역을 독립적으로 초기화하고, 작업 변경분을 받아 목록에 반영합니다.
 * 행의 상태나 순서가 달라질 때만 DOM을 재배치합니다. 속도만 바뀔 때는 기존 행의 진행 표시만 갱신합니다.
 */
import { ErrorText, GetLocale, InitializeLocale, LocalizePage, Translate, WatchLanguage } from './lib/i18n.js';
import { ObserveJobs } from './lib/job-feed.js';
import { ReadJobSample, ReadJobThumbnail } from './lib/job-preview-cache.js';
import { RequirePickedFolder } from './lib/picked-download-folder.js';
import { CreateButton, MountOptionsButton, SendRequest, SetButtonIcon } from './lib/ui.js';
import { CreateMediaPreview } from './media-preview.js';
import { PreviewTile, ObserveCandidateThumbnails } from './media-thumbnails.js';
import { CreateCandidateList } from './candidate-list.js';
import { CreateJobRow, GetJobRowSignature, UpdateJobRowMetrics } from './job-row.js';
import { CreateSettingsCache, SettingKeys } from './lib/settings.js';
import { JobGroup } from './lib/browser-job-state.js';
import {ObserveYoutubePolicyNotice} from './lib/youtube-policy-notice.js';
import {BindPanelMediaResize} from './panel-media-resize.js';
await InitializeLocale();
LocalizePage();
WatchLanguage();
const MediaPreview = CreateMediaPreview();
const Empty = document.querySelector('#empty');
const Status = document.querySelector('#status');
const CountFormat = new Intl.NumberFormat(GetLocale());
const Params = new URLSearchParams(location.search);
const DebugJob = Params.get('debug') === '1' ? Params.get('job') : null;
if (DebugJob)
{
	document.title = Translate('view_diagnostics_title');
	document.querySelector('#diagnostics-title').hidden = false;
}
else
{
	const MediaSection = document.querySelector('#panel-media');
	const Divider = document.querySelector('#panel-media-divider');
	const StaticDivider=document.querySelector('#panel-media-static-divider');
	const DownloadSection=document.querySelector('#panel-downloads');
	const ResizeMedia=BindPanelMediaResize(document.querySelector('#panel-workspace'),MediaSection,Divider);
	const Candidates = CreateCandidateList({ root: MediaSection, mediaPreview: MediaPreview, followTabs: true });
	let PolicyBlocked = false;
	function SetMediaVisible()
	{
		const Visible=PanelSettings.Get(SettingKeys.showPanelMedia)&&!PolicyBlocked,Resizable=Visible&&PanelSettings.Get(SettingKeys.showPanelMediaResize);
		if(!Resizable)ResizeMedia.setEnabled(false);
		MediaSection.hidden=!Visible;Divider.hidden=!Resizable;StaticDivider.hidden=!Visible||Resizable;
		document.body.classList.toggle('panel-resizable',Resizable);
		for(const Pane of [MediaSection,DownloadSection]){if(Resizable)Pane.setAttribute('tabindex','0');else Pane.removeAttribute('tabindex');}
		if(Resizable)ResizeMedia.setEnabled(true);
		document.querySelector('#scan').hidden=!Visible;
		Candidates.setEnabled(Visible);
	}
	const PanelSettings=CreateSettingsCache([SettingKeys.showPanelMedia,SettingKeys.showPanelMediaResize],chrome.storage,SetMediaVisible);
	ObserveYoutubePolicyNotice(Blocked =>
	{
		PolicyBlocked = Blocked;
		document.querySelector('[data-youtube-policy-notice]').hidden = !Blocked;
		SetMediaVisible();
	});
	void PanelSettings.Ready.catch(SetMediaVisible);
	window.addEventListener('pagehide',()=>PanelSettings.Dispose(),{once:true});
}
const SectionLabels = {
	attention: 'view_jobs_attention', active: 'view_jobs_active', complete: 'view_jobs_complete',
};
const Announce = Message =>
{
	Status.textContent = Message;
};
const Rows = new Map();
const Sections = Object.entries(SectionLabels).map(([Id, Label]) =>
{
	const Section = document.getElementById(Id);
	if (!DebugJob && Id !== 'active')
	{
		const RemoveAll = CreateButton('', async () =>
		{
			// 새로 나타난 작업은 이번 동작에 포함되지 않도록 클릭 시점의 ID를 넘깁니다.
			const RequestIds = [...Rows].filter(([, Entry]) => Entry.group === Id).map(([RequestId]) => RequestId);
			RemoveAll.disabled = true;
			Announce('');
			try
			{
				await SendRequest('removeJobs', { requestIds: RequestIds, group: Id });
			}
			catch (ErrorValue)
			{
				Announce(ErrorText(ErrorValue));
			}
			finally
			{
				Refresh(RequestIds);
				RemoveAll.disabled = false;
			}
		});
		Section.querySelector('.job-section-heading').append(SetButtonIcon(RemoveAll, Translate('view_action_delete_all'), 'delete-all'));
	}
	return { id: Id, label: Label, section: Section, heading: Section.querySelector('h2'), list: Section.querySelector('ul') };
});
MountOptionsButton(document.querySelector('.brand'), Announce);
const PreviewTiles = new WeakMap();
let StopJobThumbnails;
const VisibleTiles = new IntersectionObserver(Entries =>
{
	for (const { target: Target, isIntersecting: bIsIntersecting } of Entries)
	{
		if (!bIsIntersecting)
		{
			continue;
		}
		VisibleTiles.unobserve(Target);
		RefreshThumbnail(PreviewTiles.get(Target));
	}
});
function RefreshThumbnail(Id)
{
	const Tile = Rows.get(Id)?.tile;
	if (!Tile)
	{
		return;
	}
	void Tile.refresh(() => ReadJobThumbnail(Id));
}

chrome.runtime.onMessage.addListener(Message =>
{
	if (Message.type === 'jobPreviewReady')
	{
		RefreshThumbnail(Message.requestId);
	}
});
function JobPreviewTile(RequestId)
{
	const Tile = PreviewTile(MediaPreview, async Signal =>
	{
		const Sample = await ReadJobSample(RequestId).catch(() => undefined);
		Signal.throwIfAborted();
		const Load = SendRequest('previewJob', { requestId: RequestId });
		if (Sample)
		{
			const Source = await Load.catch(() => ({}));
			return { file: Sample, format: 'MP4', sample: true, streamPath: Source.streamPath };
		}
		const Source = await Load;
		if (Source.localFile)
		{
			try
			{
				const Folder = await RequirePickedFolder(Source.localFile.folder);
				const MediaFile = await (await Folder.getFileHandle(Source.localFile.name)).getFile();
				return { ...Source, file: MediaFile };
			}
			catch
			{
				// 파일이 이동됐을 수 있습니다. 로컬 파일을 열지 못하면 남아 있는 재생 주소를 사용합니다.

			}
		}
		return Source;
	}, () => SendRequest('captureJobPreview', {requestId: RequestId}));
	PreviewTiles.set(Tile.control, RequestId);
	VisibleTiles.observe(Tile.control);
	return Tile;
}

function UpdateRow(Job, Now)
{
	const Signature = GetJobRowSignature(Job, Boolean(DebugJob));
	let Entry = Rows.get(Job.requestId);
	if (!Entry || Entry.signature !== Signature)
	{
		const Previous = Entry;
		Entry = { ...CreateJobRow(Job, Previous?.tile ?? JobPreviewTile(Job.requestId), {
				Announce: Announce, Refresh: Refresh, bShowDiagnostics: Boolean(DebugJob), CountFormat: CountFormat,
			}), signature: Signature };
		Previous?.row.replaceWith(Entry.row);
		Rows.set(Job.requestId, Entry);
	}
	UpdateJobRowMetrics(Entry, Job, Now);
	return Entry;
}

function PlaceRows()
{
	const Groups = { attention: [], active: [], complete: [] };
	const Ordered = [...Rows.values()].sort((A, B) => B.created - A.created);
	for (const Entry of Ordered)
	{
		Groups[Entry.group].push(Entry.row);
	}
	for (const { id: Id, label: Label, section: Section, heading: Heading, list: List } of Sections)
	{
		const Group = Groups[Id];
		const bHidden = Group.length === 0;
		if (Section.hidden !== bHidden)
		{
			Section.hidden = bHidden;
		}
		if (bHidden)
		{
			continue;
		}
		const TextValue = Translate(Label, CountFormat.format(Group.length));
		if (Heading.textContent !== TextValue)
		{
			Heading.textContent = TextValue;
		}
		Group.forEach((Row, Index) =>
		{
			if (List.children[Index] !== Row)
			{
				List.insertBefore(Row, List.children[Index] ?? null);
			}
		});
	}
}

function RenderChanges(Changes)
{
	const Now = performance.now();
	let bLayoutChanged = false;
	for (const [Id, Job] of Changes)
	{
		const Previous = Rows.get(Id);
		if (!Job)
		{
			if (Previous)
			{
				VisibleTiles.unobserve(Previous.tile.control);
				MediaPreview.close(Previous.tile.control);
				Previous.row.remove();
				Rows.delete(Id);
				bLayoutChanged = true;
			}
			continue;
		}
		const Group = JobGroup(Job.state);
		const Created = Job.created ?? 0;
		if (Previous?.group !== Group || Previous.created !== Created)
		{
			bLayoutChanged = true;
		}
		const Entry = UpdateRow(Job, Now);
		Entry.group = Group;
		Entry.created = Created;
	}
	// 바이트 정보만 바뀌면 기존 진행 요소를 갱신합니다.
	// 행이 추가·삭제되거나 그룹과 순서가 달라질 때만 목록을 재배치합니다.
	if (bLayoutChanged)
	{
		PlaceRows();
		StopJobThumbnails?.();
		const Tiles = new Map([...Rows].map(([Id, Entry]) => [Id, {control: Entry.tile.control, show: (...Args) => Entry.tile.show(...Args)}]));
		StopJobThumbnails = ObserveCandidateThumbnails(null, {}, Tiles, Ids => SendRequest('jobThumbnails', {requestIds: Ids}));
	}
	const bHasJobs = Rows.size > 0;
	if (Empty.hidden !== bHasJobs)
	{
		Empty.hidden = bHasJobs;
	}
	if (!bHasJobs)
	{
		const Message = Translate('view_jobs_empty');
		if (Empty.textContent !== Message)
		{
			Empty.textContent = Message;
		}
	}
}

document.addEventListener('keydown', UiEvent =>
{
	if (UiEvent.key !== 'Escape')
	{
		return;
	}
	for (const Tip of document.querySelectorAll('.tooltip:not([hidden])'))
	{
		Tip.hidden = true;
		Tip.previousElementSibling.removeAttribute('aria-describedby');
	}
});
const Refresh = ObserveJobs({
	debugJob: DebugJob,
	onUpdate: RenderChanges,
	onError: () =>
	{
		if (!Rows.size)
		{
			Empty.textContent = Translate('view_jobs_failed');
		}
	},
});
