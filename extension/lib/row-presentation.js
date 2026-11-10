/** Truthful, surface-independent display values. No browser state is mutated here. */
import {FormatDownloadBytes, GetDownloadMetrics, ProgressMax} from './metrics.js';
import {GetLocale} from './i18n.js';
import {JobSubtitleStatus} from './subtitle-status.js';
import {CaptionJobProgress} from './caption-job-progress.js';

const RowStatusLabels = Object.freeze({ready:'Ready', starting:'Start', connecting:'Connecting',
 paused:'Paused', stopping:'Stopping', canceling:'Canceling', canceled:'Canceled', complete:'Done',
 failed:'Failed', interrupted:'Interrupted', unknown:'Interrupted'});

export function SubtitleMetadata(Status)
{
 if (!Status) return [];
 const HasError=Status.phase==='failed' || Status.translation==='failed' || Status.unavailable>0 || Status.errorCount>0;
 const ErrorCount=Number.isInteger(Status.errorCount) && Status.errorCount>0 ? Status.errorCount
  : Status.unavailable>0 ? Status.unavailable : Math.max(1,(Status.count || 0)-(Status.completed || 0));
 if(HasError && !(Status.count>0))return [{text:`Error(${ErrorCount})`,failed:true}];
 if (!Number.isInteger(Status.count) || Status.count < 1 || ['undetected','checking','unknown'].includes(Status.phase)) return [];
 const Completed=Status.completed ?? (Status.phase==='ready' ? Status.count : Status.phase==='collecting' ? 0 : undefined);
 const Items=[{text:`Subs(${Completed===undefined ? Status.count : `${Completed}/${Status.count}`})`, failed:false}];
 if(HasError) Items.push({text:`Error(${ErrorCount})`,failed:true});
 else if(['pending','translating','complete'].includes(Status.translation) && Status.targetLanguage)
  Items.push({text:`Trans(${Status.targetLanguage.toLowerCase()})`,working:Status.translation==='translating'});
 return Items;
}

export function ScheduledMetadata(Value)
{
 const DateValue=new Date(Value);
 return Number.isFinite(DateValue.getTime()) ? `${new Intl.DateTimeFormat(GetLocale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(DateValue)} Scheduled` : 'Waiting for stream';
}

function ElapsedTime(Job, Now=Date.now())
{
 const Start=Date.parse(Job.startTime) || Job.created;
 const End=Date.parse(Job.endTime) || Now;
 if(!Number.isFinite(Start) || !Number.isFinite(End) || End<Start) return '';
 const Total=Math.floor((End-Start)/1000);
 return [Math.floor(Total/3600),Math.floor(Total/60)%60,Total%60].map(N=>String(N).padStart(2,'0')).join(':');
}

export function PresentJob(Job, {role='job',previous,now=performance.now(),wallNow=Date.now()}={})
{
 const Terminal=['complete','failed','canceled','interrupted','unknown'].includes(Job.state);
 const Pending=!Terminal && Job.pendingAction;
 let Status=Pending==='cancel' ? 'canceling' : Pending==='finish' ? 'stopping'
  : Job.waiting && !Terminal ? 'ready' : Job.connecting && !Terminal ? 'connecting'
  : Job.state==='active' ? null : Job.state;
 const StoredSubtitles=JobSubtitleStatus(Job);
 const Subtitles=role==='job' && ['starting','active'].includes(Job.state) && StoredSubtitles?.phase==='detected'
  ? {...StoredSubtitles,phase:'collecting',completed:StoredSubtitles.completed ?? 0} : StoredSubtitles;
 const Metadata=SubtitleMetadata(role==='candidate' && Subtitles?.phase==='ready' ? {...Subtitles,phase:'detected',completed:undefined} : Subtitles);
 if(Job.waiting || Job.scheduledStartTime && !Job.live) Metadata.splice(0,Metadata.length,{text:ScheduledMetadata(Job.scheduledStartTime)});
 if(Job.state==='interrupted' && Job.exists) Metadata.splice(0,Metadata.length,{text:`Partial saved · ${FormatDownloadBytes(Job.bytesReceived)}`,failed:true});
 else if(Job.recording && Job.state==='failed') Metadata.push({text:Job.bytesReceived>0 ? 'Save failed' : 'Connection failed',failed:true});
 let Metrics=GetDownloadMetrics(Job,previous,now);
 if(Job.snapshot && Job.state==='active' && Job.count>0)
 {
  Metrics={...Metrics,percent:Math.min(ProgressMax-1,Math.floor(ProgressMax*(Job.finished || 0)/Job.count))};
  Metrics.progress=`${Metrics.percent}%`;
 }
 if(Job.state==='complete')
 {
  const Seconds=(Date.parse(Job.endTime)-(Date.parse(Job.startTime) || Job.created))/1000;
  Metrics.speed=`Avg ${Seconds>0 && Job.bytesReceived>=0 ? `${FormatDownloadBytes(Job.bytesReceived/Seconds)}/s` : '—'}`;
 }
 const Processing=Job.state==='active' && (Job.hls || Job.recording || Job.youtube || Job.subtitleMux || Job.pickedDownloadFolder);
 if(Processing && (Job.downloadId!==undefined || Job.saving)) Metrics.speed='Saving';
 else if(Processing && Job.muxing) Metrics.speed='Muxing';
 // A finite snapshot has its own progress even though it inherits the live origin.
 const Live=!!(Job.live || Job.liveOrigin || Job.recording) && !Job.waiting;
 if(Live && !Job.snapshot && Job.state==='active') Metrics={...Metrics,percent:null,progress:FormatDownloadBytes(Job.bytesReceived)};
 const CaptionProgress=CaptionJobProgress(Job);
 if(CaptionProgress&&Job.state!=='complete')Metrics={...Metrics,percent:CaptionProgress.percent,progress:CaptionProgress.percent===null?'—':CaptionProgress.percent+'%',speed:CaptionProgress.label};
 const Label=Status ? RowStatusLabels[Status] ?? RowStatusLabels.unknown : '';
 return {status:Status,label:Label,metadata:Metadata,metrics:Metrics,
  showMetrics:!Label || Job.state==='complete' && role==='job',
  live:Live,liveInactive:Terminal || !!Pending || Job.state==='paused',
  elapsed:Live && (Job.bytesReceived>0 || Job.endTime) ? ElapsedTime(Job,wallNow) : '',
  suppressPreview:!!Job.waiting, busy:!Terminal && (['starting','active','paused'].includes(Job.state) || !!Pending || !!Job.connecting || !!Job.waiting),
  failed:['failed','interrupted','unknown'].includes(Job.state)};
}
