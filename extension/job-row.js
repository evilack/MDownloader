/**
 * 다운로드 관리자에서 작업 한 건을 표시하는 컴포넌트입니다. 상태별 동작과 도움말을 만들고, 자주 바뀌는 진행률은 이미 만들어진 요소에 적용합니다.
 */
import { ErrorText, Translate } from './lib/i18n.js';
import { DownloadStageLabel } from './lib/download-log.js';
import { FormatDownloadBytes, GetDownloadMetrics, ProgressMax, SpeedSampleMs } from './lib/metrics.js';
import { CreateJobMeasure } from './lib/job-measure.js';
import { CreateButton, CopyLink, CreateElement, SendRequest, SetButtonIcon } from './lib/ui.js';
import { CreateLiveBadge } from './media-badges.js';
import {CanFinishJob} from './lib/job-actions.js';

/** 포인터와 키보드로 같은 도움말을 엽니다. 응답이 늦게 와도 이미 닫힌 도움말을 다시 표시하지 않습니다. */
function AddTooltip(Wrapper, Trigger, Id, TextValue, LoadText)
{
	const Tip = CreateElement('span', TextValue, 'tooltip');
	Tip.id = Id;
	Tip.setAttribute('role', 'tooltip');
	Tip.hidden = true;
	Trigger.tabIndex = 0;
	let Revision = 0;
	function Hide()
	{
		Revision++;
		Tip.hidden = true;
		Trigger.removeAttribute('aria-describedby');
	}

	function Position()
	{
		const Anchor = Wrapper.getBoundingClientRect();
		const Below = window.innerHeight - Anchor.bottom;
		Tip.toggleAttribute('data-above', Below < Tip.offsetHeight && Anchor.top > Below);
	}

	async function Show()
	{
		const Current = ++Revision;
		Trigger.setAttribute('aria-describedby', Tip.id);
		if (LoadText)
		{
			Tip.textContent = TextValue;
		}
		Tip.hidden = false;
		Position();
		if (!LoadText)
		{
			return;
		}
		let Value;
		try
		{
			Value = await LoadText();
		}
		catch
		{
			Value = Translate('view_link_unavailable');
		}
		if (Current === Revision && !Tip.hidden)
		{
			Tip.textContent = Value;
			Position();
		}
	}

	Trigger.addEventListener('pointerenter', UiEvent =>
	{
		if (UiEvent.pointerType !== 'touch')
		{
			void Show();
		}
	});
	Wrapper.addEventListener('pointerleave', () =>
	{
		if (document.activeElement !== Trigger)
		{
			Hide();
		}
	});
	Trigger.addEventListener('focus', Show);
	Trigger.addEventListener('blur', () =>
	{
		if (!Wrapper.matches(':hover'))
		{
			Hide();
		}
	});
	Wrapper.append(Tip);
}

function NameWithTooltip(Job, LoadLink)
{
	const Wrapper = CreateElement('div', '', 'name-wrap');
	const Name = CreateElement('strong', Job.filename, 'filename');
	Name.title = Job.filename;
	if (Job.live && Job.state === 'active')
	{
		const Live = CreateLiveBadge(true);
		Live.classList.add('job-live');
		Wrapper.append(Live);
	}
	Wrapper.append(Name);
	if (Job.hasUrl)
	{
		AddTooltip(Wrapper, Name, 'address-' + Job.requestId, Translate('view_link_loading'), LoadLink);
	}
	return Wrapper;
}

const Labels = {
	starting: 'view_state_starting', paused: 'view_state_paused', canceled: 'view_state_canceled',
	failed: 'view_state_failed', unknown: 'view_state_unknown', interrupted: 'view_state_interrupted',
};

/** 화면에 표시할 진단은 이곳에서 조립합니다. 원본 오류는 워커가 관리합니다. */
function JobDetails(Job, { bShowDiagnostics, CountFormat })
{
	const Details = [];
	if (Job.waiting) Details.push(Translate('view_youtube_waiting'));
	if (Job.error)
	{
		Details.push(ErrorText(Job.error));
	}
	if (Job.diagnostic && (bShowDiagnostics || Job.state === 'failed'))
	{
		const { stage: Stage, status: Status, fromPreviousAttempt: FromPreviousAttempt } = Job.diagnostic;
		const Diagnostic = [Translate(DownloadStageLabel(Stage))];
		if (Status !== undefined)
		{
			Diagnostic.push(Translate('view_diagnostics_http', Status));
		}
		if (FromPreviousAttempt)
		{
			Diagnostic.push(Translate('view_diagnostics_previous'));
		}
		if (Job.state === 'failed')
		{
			Diagnostic.push(Job.snapshotDirect
			? Translate('view_metric_bytes', CountFormat.format(Job.bytesReceived ?? 0))
			: Translate('view_diagnostics_received', CountFormat.format(Job.finished ?? 0)));
		}
		Details.push(Diagnostic.join(' · '));
	}
	if (Job.state === 'unknown')
	{
		Details.push(Translate('view_job_check_browser'));
	}
	if (Job.state === 'failed')
	{
		if (Job.diagnostic?.status === 403)
		{
			Details.push(Translate('view_job_server_denied'));
		}
		else if (!Job.canResume)
		{
			Details.push(Translate('view_job_rescan'));
		}
	}
	if (['complete', 'interrupted'].includes(Job.state) && !Job.exists)
	{
		Details.push(Translate('view_job_file_missing'));
	}
	return Details;
}

/** 작업 상태에 맞는 행을 구성합니다. 진행률·속도는 별도 함수에서 갱신하여 버튼의 포커스를 보존합니다. */
export function CreateJobRow(Job, Tile, Context)
{
	const { Announce, Refresh } = Context;
	const Row = CreateElement('li', '', 'job');
	const Top = CreateElement('div', '', 'job-top');
	const End = CreateElement('div', '', 'job-end');
	const InlineActions = CreateElement('div', '', 'job-inline-actions');
	const LoadLink = () => SendRequest('jobUrl', { requestId: Job.requestId });
	const Summary = CreateElement('div', '', 'job-summary');
	Summary.append(Tile.control, NameWithTooltip(Job, LoadLink));
	Top.append(Summary);
	Row.append(Top);
	const bRunning = ['active', 'paused', 'complete'].includes(Job.state);
	let Measure;
	let Progress;
	if (bRunning)
	{
		Measure = CreateJobMeasure();
		End.append(Measure.node);
		Progress = CreateElement('progress');
		Progress.max = ProgressMax;
		Progress.setAttribute('aria-label', Translate('view_job_progress', Job.filename));
		Row.append(Progress);
	}

	const Label = Labels[Job.state];
	const Details = JobDetails(Job, Context);
	const State = Label && CreateElement('span', Translate(Label), 'state');
	if (State)
	{
		State.dataset.state = Job.state;
	}
	const bInlineStatus = Job.state === 'failed' || Job.state === 'canceled';
	const bFailureTooltip = Job.state === 'failed' && Details.length > 0;
	// 완료 행의 진행률과 같은 영역에 상태를 두고, 상세 내용은 별도로 표시합니다.
	if (bInlineStatus)
	{
		const Copy = CreateElement('div', '', 'job-status-copy');
		Copy.append(State);
		if (bFailureTooltip)
		{
			AddTooltip(Copy, State, 'failure-' + Job.requestId, Details.join('\n'));
		}
		Top.classList.add('job-top-with-status');
		End.append(Copy);
	}
	const StatusLine = (!bInlineStatus && State) || (!bFailureTooltip && Details.length)
	? CreateElement('div', '', 'job-status-line') : null;
	if (StatusLine)
	{
		const Copy = CreateElement('div', '', 'job-status-copy');
		if (State && !bInlineStatus)
		{
			Copy.append(State);
		}
		for (const Detail of Details)
		{
			Copy.append(CreateElement('span', Detail, 'muted'));
		}
		StatusLine.append(Copy);
		Row.append(StatusLine);
	}

	const Actions = CreateElement('div', '', 'actions');
	function Control(Label, Action, bPrimary = false)
	{
		const ControlButton = CreateButton(Label, async UiEvent =>
		{
			ControlButton.disabled = true;
			try
			{
				if (Action === 'snapshot' && Job.snapshotPermission && !await chrome.permissions.request({origins: [Job.snapshotPermission]}))
				{
					throw new Error(Translate('view_permission_denied'));
				}
				const RequestedAction = Action === 'show' && UiEvent.shiftKey ? 'play' : Action;
				if (RequestedAction === 'show' && Job.pickedDownloadFolder &&
				!await chrome.permissions.request({permissions: ['nativeMessaging']}))
				{
					throw new Error(Translate('explorer_bridge_required'));
				}
				await SendRequest('control', { requestId: Job.requestId, action: RequestedAction });
			}
			catch (ErrorValue)
			{
				Announce(ErrorText(ErrorValue));
			}
			finally
			{
				ControlButton.disabled = false;
				Refresh([Job.requestId]);
			}
		}, bPrimary);
		ControlButton.dataset.action = Action;
		return ControlButton;
	}
	if (Job.state === 'active' && !Job.hls && !Job.recording && !Job.youtube && !Job.pickedDownloadFolder)
	{
		Actions.append(Control(Translate('view_action_pause'), 'pause', true));
	}
	if (Job.canResume && ['paused', 'failed'].includes(Job.state))
	{
		Actions.append(Control(Translate('view_action_resume'), 'resume', true));
	}
	if (['complete', 'interrupted'].includes(Job.state) && Job.exists)
	{
		InlineActions.append(SetButtonIcon(Control('', 'show'), Translate('view_action_show'), 'folder'));
	}
	// 오른쪽 작업 영역은 취소 → 현재 구간 저장 → 중지 및 저장 순서로 배치합니다.
	// 아이콘은 공통 생성기를 거쳐 툴팁과 접근성 이름을 함께 받습니다.
	if (Job.state === 'active' || Job.state === 'paused')
	{
		InlineActions.append(SetButtonIcon(Control('', 'cancel'), Translate('view_action_cancel'), 'cancel'));
	}
	if (['active', 'paused'].includes(Job.state) && !Job.snapshot && Job.snapshotAvailable && !Job.muxing)
	{
		InlineActions.append(SetButtonIcon(Control('', 'snapshot', true), Translate(Job.hls || Job.recording || Job.youtube ? 'view_action_snapshot' : 'view_action_snapshot_file'), 'download'));
	}
	if (Job.state === 'active' && !Job.waiting && !Job.snapshot && !Job.muxing && (Job.hls || Job.live || Job.youtube))
	{
		const Finish = SetButtonIcon(Control('', 'finish', true), Translate('view_action_finish'), 'stop-save');
		Finish.disabled = !CanFinishJob(Job);
		InlineActions.append(Finish);
	}
	if (Job.hasUrl)
	{
		Actions.append(CreateButton(Translate('view_copy_link'), () => CopyLink(LoadLink, Announce)));
	}
	if (Job.state !== 'starting' && !((Job.hls || Job.recording || Job.youtube) && ['active', 'paused'].includes(Job.state)))
	{
		const Remove = CreateButton('', async UiEvent =>
		{
			const DeleteFile = UiEvent.shiftKey;
			Remove.disabled = true;
			try
			{
				await SendRequest('removeJob', { requestId: Job.requestId, deleteFile: DeleteFile });
				Announce(DeleteFile ? Translate('view_delete_file_success') : '');
			}
			catch (ErrorValue)
			{
				Announce(ErrorText(ErrorValue));
			}
			finally
			{
				Remove.disabled = false;
				Refresh([Job.requestId]);
			}
		});
		SetButtonIcon(Remove, Translate('view_action_delete'), 'delete');
		Remove.title = Translate('view_delete_hint');
		(bRunning || bInlineStatus ? InlineActions : StatusLine ?? Actions).append(Remove);
	}
	if (InlineActions.childElementCount)
	{
		End.append(InlineActions);
	}
	if (End.childElementCount)
	{
		Top.append(End);
	}
	if (Actions.childElementCount)
	{
		Row.append(Actions);
	}
	return { row: Row, measure: Measure, progress: Progress, tile: Tile };
}

/** 실제로 구조가 달라질 때만 행을 다시 생성합니다. 바이트나 속도는 구조를 바꾸지 않습니다. */
export function GetJobRowSignature(Job, bShowDiagnostics)
{
	return JSON.stringify([Job.filename, Job.state, Job.hasUrl, Job.error, Job.canResume, Job.exists,
		Job.downloadId, Job.youtube, Job.hls, Job.recording, Job.live, Job.waiting, Job.live && Job.finished > 0, Job.snapshotAvailable, Job.snapshotPermission, Job.muxing,
		bShowDiagnostics || Job.state === 'failed' ? Job.diagnostic : undefined, Job.state === 'failed' ? Job.finished : undefined]);
}

/** 같은 행에서 진행률과 속도만 갱신합니다. 전송·병합·저장 단계를 두 번째 줄에 구분합니다. */
export function UpdateJobRowMetrics(Entry, Job, Now, CountFormat)
{
	if (Entry.progress)
	{
		const ActiveStream = Job.state === 'active' && (Job.hls || Job.recording || Job.youtube);
		const Value = GetDownloadMetrics(Job, Entry.previous, Now);
		if (ActiveStream)
		{
			if (Job.downloadId !== undefined)
			{
				Value.speed = Translate(Job.snapshot ? 'view_job_snapshot_saving' : 'view_job_mp4_saving');
			}
			else if (Job.muxing)
			{
				Value.speed = Translate(Job.snapshot ? 'view_job_snapshot_muxing' : 'view_job_mp4_muxing');
			}
			else if (Job.waiting) Value.speed = Translate('view_youtube_waiting');
			else if (!Job.live && !Job.count && !Job.recording && !Job.youtube)
			{
				Value.speed = Translate('view_job_playlist_check');
			}
		}
		if (Job.state === 'active' || Job.state === 'paused')
		{
			Value.progress = FormatDownloadBytes(Job.bytesReceived);
		}
		const Description = Entry.measure.update(Value);
		if (Entry.progress.title !== Description) Entry.progress.title = Description;
		if (Entry.progress.getAttribute('aria-valuetext') !== Description) Entry.progress.setAttribute('aria-valuetext', Description);
		const HasValue = Entry.progress.hasAttribute('value');
		if (Value.percent === null)
		{
			if (HasValue)
			{
				Entry.progress.removeAttribute('value');
			}
		}
		else if (!HasValue || Entry.progress.value !== Value.percent)
		{
			Entry.progress.value = Value.percent;
		}
		if (Job.state === 'active' && (!Entry.previous || Now - Entry.previous.time >= SpeedSampleMs))
		{
			Entry.previous = { time: Now, bytes: Job.bytesReceived };
		}
	}
}
