// Request preparation and worker snapshots can update the same button in either order.
import {Translate} from './i18n.js';
import {SetButtonIcon,SetControlLabel} from './ui.js';
import {CanFinishJob} from './job-actions.js';
const States=new WeakMap();
export function UpdateCandidateDownloadButton(Button,Fields)
{
 const State=States.get(Button) ?? {pending:false,queued:false,busy:false};
 Object.assign(State,Fields);
 States.set(Button,State);
 const Job=State.job;
 const Controlling=State.busy && !!Job?.requestId;
 if(!Controlling || State.controlRequestId!==Job.requestId) State.controlRequestId=undefined;
 const Live=!!(Job?.live || Job?.liveOrigin || Job?.recording) && !Job.waiting && !Job.snapshot;
 const Action=Controlling ? Live ? 'finish' : 'cancel' : 'download';
 const Label=Translate(Action==='finish' ? 'view_action_finish' : Action==='cancel' ? 'view_action_cancel'
  : State.queued ? 'view_download_queueing' : State.permission ? 'view_download_with_permission' : 'view_download');
 if(State.action!==Action) SetButtonIcon(Button,Label,Action==='finish'?'stop-save':Action);
 else if(State.label!==Label) SetControlLabel(Button,Label);
 State.action=Action;State.label=Label;
 Button.dataset.action=Action;
 Button.classList.toggle('primary',Action!=='cancel');
 Button.disabled=State.pending || (Controlling
  ? !!State.controlRequestId || !!Job.pendingAction || Action==='finish' && !CanFinishJob(Job)
  : State.queued || State.busy);
 return Button;
}

/** Controls use the latest worker identity, independently of changing candidate/scan IDs. */
export function CandidateJobControl(Button)
{
 const State=States.get(Button);
 return State && State.action!=='download' ? {requestId:State.job.requestId,action:State.action} : null;
}
