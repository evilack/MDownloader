/**
 * 다운로드 관리자에서 작업 한 건을 표시하는 컴포넌트입니다. 상태별 동작과 도움말을 만들고, 자주 바뀌는 진행률은 이미 만들어진 요소에 적용합니다.
 */
import { ErrorText, Translate } from './lib/i18n.js';
import { DownloadStageLabel } from './lib/download-log.js';
import { ProgressMax, SpeedSampleMs } from './lib/metrics.js';
import { CreateJobMeasure } from './lib/job-measure.js';
import { CreateButton, CopyLink, CreateElement, SendRequest, SetButtonIcon } from './lib/ui.js';
import { CreateLiveBadge, CreateSourceBadge } from './media-badges.js';
import {CanFinishJob} from './lib/job-actions.js';
import {PresentJob} from './lib/row-presentation.js';
import {CreateMediaRow, UpdateRowMetadata} from './media-row.js';
import {CreateCaptionJobStatus} from './local-captions-job.js';

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

function NameWithTooltip(Job, LoadLink, Announce)
{
	const Wrapper = CreateElement('div', '', 'name-wrap');
	const Name = Job.hasUrl ? CreateButton(Job.filename,()=>CopyLink(LoadLink,Announce)) : CreateElement('strong',Job.filename);
	Name.className='filename';
	if(Job.hasUrl) Name.setAttribute('aria-label',`${Job.filename} · ${Translate('view_copy_link')}`);
	Name.title = Job.filename;
	const SourceBadge=CreateSourceBadge(Job);
	if(SourceBadge) Wrapper.append(SourceBadge);
	const Presentation=PresentJob(Job);
	if (Presentation.live)
	{
		const Live = CreateLiveBadge(true);
		Live.classList.add('job-live');
		Live.dataset.inactive=String(Presentation.liveInactive);
		Wrapper.append(Live);
	}
	Wrapper.append(Name);
	if (Job.hasUrl)
	{
		AddTooltip(Wrapper, Name, 'address-' + Job.requestId, Translate('view_link_loading'), LoadLink);
	}
	return Wrapper;
}

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
 const {Announce,Refresh}=Context;
 const Presentation=PresentJob(Job);
 const Measure=CreateJobMeasure();
 const Metadata=CreateElement('div','','subtitle-status');
 UpdateRowMetadata(Metadata,Presentation.metadata);
 const Actions=CreateElement('div','','job-inline-actions');
 const {row:Row}=CreateMediaRow({kind:'job',thumbnail:Tile.control,heading:NameWithTooltip(Job,()=>SendRequest('jobUrl',{requestId:Job.requestId}),Announce),metadata:Metadata,measure:Measure.node,actions:Actions});
 Row.dataset.state=Job.state;
 Row.dataset.phase=Presentation.status || 'receiving';
 const Details=JobDetails(Job,Context);
 if(Details.length) AddTooltip(Measure.node,Measure.node,'failure-'+Job.requestId,Details.join('\n'));
 const Progress=CreateElement('progress');
 Progress.max=ProgressMax;
 Progress.hidden=!!Job.waiting || Job.state==='starting' || Presentation.metrics.percent===null && !['active','paused'].includes(Job.state);
 Progress.setAttribute('aria-label',Translate('view_job_progress',Job.filename));
 Row.append(Progress);
 function Control(LabelKey,Action,Icon,bPrimary=false)
 {
  const Button=SetButtonIcon(CreateButton('',async UiEvent=>{
   Button.disabled=true;
   try {
    if(Action==='snapshot' && Job.snapshotPermission && !await chrome.permissions.request({origins:[Job.snapshotPermission]})) throw new Error(Translate('view_permission_denied'));
    const RequestedAction=Action==='show' && UiEvent.shiftKey ? 'play' : Action;
    if(RequestedAction==='show' && Job.pickedDownloadFolder && (await chrome.runtime.getPlatformInfo()).os==='win' && !await chrome.permissions.request({permissions:['nativeMessaging']})) throw new Error(Translate('explorer_bridge_required'));
    await SendRequest('control',{requestId:Job.requestId,action:RequestedAction});
    if(RequestedAction==='show') Announce('');
   } catch(ErrorValue) {Announce(ErrorText(ErrorValue));}
   finally {Button.disabled=false;Refresh([Job.requestId]);}
  },bPrimary),Translate(LabelKey),Icon);
  Button.dataset.action=Action;
  Button.disabled=!!Job.pendingAction;
  return Button;
 }
 const Running=['active','paused','starting'].includes(Job.state);
 if(Job.canResume && ['paused','failed'].includes(Job.state)) Actions.append(Control('view_action_resume','resume','download',true));
 if(Running) Actions.append(Control('view_action_cancel','cancel','cancel'));
 if(['active','paused'].includes(Job.state) && !Job.snapshot && Job.snapshotAvailable && !Job.muxing && (!(Job.hls||Job.recording||Job.youtube)||Job.downloadId===undefined)) Actions.append(Control(Job.hls||Job.recording||Job.youtube?'view_action_snapshot':'view_action_snapshot_file','snapshot','download'));
 if(Job.state==='active' && !Job.waiting && !Job.snapshot && (Job.hls||Job.recording||Job.live||Job.youtube)) {
  const Finish=Control('view_action_finish','finish','stop-save',true);
  Finish.disabled=!!Job.pendingAction || Job.downloadId!==undefined || !CanFinishJob(Job);
  Actions.append(Finish);
 }
 if(Job.state==='active' && !Job.hls && !Job.recording && !Job.youtube && !Job.pickedDownloadFolder && !Job.subtitleMux) Actions.append(Control('view_action_pause','pause','cancel'));
 if(['complete','interrupted'].includes(Job.state) && Job.exists) Actions.append(Control('view_action_show','show','folder'));
 if(!Running) {
  const Remove=SetButtonIcon(CreateButton('',async UiEvent=>{
   Remove.disabled=true;
   try {await SendRequest('removeJob',{requestId:Job.requestId,deleteFile:!!UiEvent.shiftKey});if(UiEvent.shiftKey)Announce(Translate('view_delete_file_success'));}
   catch(ErrorValue) {Announce(ErrorText(ErrorValue));}
   finally {Remove.disabled=false;Refresh([Job.requestId]);}
  }),Translate('view_action_delete'),'delete');
  Remove.dataset.action='remove'; Remove.title=Translate('view_delete_hint'); Actions.append(Remove);
 }
 const Captions=Job.localCaptions?.enabled&&!Job.snapshot?CreateCaptionJobStatus(Job,Announce,Refresh):undefined;if(Captions)Row.append(Captions.node);
 const Entry={row:Row,measure:Measure,progress:Progress,tile:Tile,metadata:Metadata,captions:Captions};
 UpdateJobRowMetrics(Entry,Job,performance.now());
 return Entry;
}

/** Metric-only updates preserve controls and their keyboard focus. */
export function GetJobRowSignature(Job,bShowDiagnostics)
{
 return JSON.stringify([Job.filename,Job.state,Job.hasUrl,Job.error,Job.canResume,Job.exists,Job.subtitleStatus,Job.subtitleCount,
  Job.downloadId,Job.youtube,Job.youtubeSource,Job.hls,Job.recording,Job.live,Job.dvr,Job.liveOrigin,Job.waiting,Job.connecting,Job.pendingAction,Job.scheduledStartTime,
  Job.snapshot,Job.snapshotAvailable,Job.snapshotPermission,Job.muxing,Job.saving,Job.localCaptions?.enabled,Job.captionStatus?.phase,Job.captionStatus?.error,Job.captionStatus?.outputs,Job.captionStatus?.retryAvailable,
  bShowDiagnostics||Job.state==='failed'?Job.diagnostic:undefined]);
}

export function UpdateJobRowMetrics(Entry,Job,Now)
{
 const View=PresentJob(Job,{previous:Entry.previous,now:Now});
 Entry.row.dataset.phase=View.status || 'receiving';
 Entry.measure.node.dataset.failed=String(View.failed);
 Entry.measure.node.dataset.label=String(!View.showMetrics);
 const Value=View.showMetrics ? View.metrics : {...View.metrics,progress:View.label,speed:''};
 const Description=Entry.measure.update(Value);
 if(Entry.metadata) UpdateRowMetadata(Entry.metadata,View.metadata);
 Entry.captions?.update(Job);
 if(Entry.progress) {
  Entry.progress.hidden=!!Job.waiting || Job.state==='starting' || View.metrics.percent===null && !['active','paused'].includes(Job.state);
  Entry.progress.title=Description;
  Entry.progress.setAttribute('aria-valuetext',Description);
  if(View.metrics.percent===null) Entry.progress.removeAttribute('value');
  else Entry.progress.value=View.metrics.percent;
 }
 Entry.tile.setPresentation?.(View);
 if(Job.state==='active' && (!Entry.previous || Now-Entry.previous.time>=SpeedSampleMs)) Entry.previous={time:Now,bytes:Job.bytesReceived};
}
