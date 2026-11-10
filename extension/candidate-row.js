import {CreateElement,CreateButton,SetButtonIcon,CopyLink} from './lib/ui.js';
import {Translate} from './lib/i18n.js';
import {GetMediaFormatLabel} from './lib/media.js';
import {CreateLiveBadge,CreateSourceBadge} from './media-badges.js';
import {CreateJobMeasure} from './lib/job-measure.js';
import {PresentJob,ScheduledMetadata,SubtitleMetadata} from './lib/row-presentation.js';
import {CreateMediaRow,UpdateRowMetadata} from './media-row.js';
import {UpdateCandidateDownloadButton} from './lib/candidate-download-state.js';

/** Candidate capabilities supply actions; this component never initiates a scan or download. */
export function CreateCandidateRow(Candidate,{thumbnail,download,loadLink,announce})
{
 const Heading=CreateElement('div','','candidate-heading');
 const Name=CreateElement('strong',Candidate.displayName ?? Candidate.name,'filename');
 Name.title=Candidate.playlistPath ?? Candidate.name;
 const Platform=CreateSourceBadge(Candidate) ?? CreateElement('span',GetMediaFormatLabel(Candidate.format,Candidate),'candidate-format');
 Platform.dataset.format=Candidate.format;
 const Live=CreateLiveBadge(Candidate.live===true && !Candidate.upcoming);
 Heading.append(Platform,Live,Name);
 const Metadata=CreateElement('div','','subtitle-status');
 Metadata.title=Candidate.subtitleStatus?.languages?.join(', ') || '';
 const Status=CreateElement('span','','candidate-job-status');
 const Measure=CreateJobMeasure();
 Status.append(Measure.node);
 Status.setAttribute('role','status');
 const Actions=CreateElement('div','','actions');
 if(loadLink) Actions.append(SetButtonIcon(CreateButton('',()=>CopyLink(loadLink,announce)),Translate('view_copy_link'),'link'));
 Actions.append(download);
 const Entry=CreateMediaRow({kind:'candidate',thumbnail:thumbnail.control,heading:Heading,metadata:Metadata,measure:Status,actions:Actions});
 let LatestJob,LatestMetrics;
 function Update(Job,Metrics,ResetQueue=true)
 {
  LatestJob=Job;LatestMetrics=Metrics;
  if(Candidate.format==='M3U8') Platform.textContent=GetMediaFormatLabel(Candidate.format,{dvr:Job?.dvr===true || Candidate.dvr===true});
  const View=Job ? PresentJob(Job,{role:'candidate'}) : null;
  const Value=View?.showMetrics ? Metrics ?? View.metrics : {progress:View?.label ?? (Candidate.upcoming?'Ready':''),speed:''};
  Measure.update(Value);
  Status.hidden=!Value.progress;
  Status.dataset.state=Job?.state ?? '';
  Measure.node.dataset.failed=String(!!View?.failed);
  Measure.node.dataset.label=String(!View?.showMetrics);
  Status.setAttribute('aria-live',View?.showMetrics?'off':'polite');
  const IsLive=View?.live ?? (Candidate.live===true && !Candidate.upcoming);
  Live.hidden=!IsLive;
  Live.dataset.inactive=String(!!View?.liveInactive);
  UpdateRowMetadata(Metadata,View?.metadata ?? (Candidate.upcoming ? [{text:ScheduledMetadata(Candidate.scheduledStartTime)}] : SubtitleMetadata(Candidate.subtitleStatus)));
  UpdateCandidateDownloadButton(download,{job:Job,busy:!!View?.busy,...(ResetQueue?{queued:false}:{})});
  thumbnail.setPresentation?.(View ?? {suppressPreview:!!Candidate.upcoming,live:Candidate.live});
 }
 Update();
 return {...Entry,subtitleStatus:Metadata,status:Status,live:Live,update:Update,
  updateSource(Source){Object.assign(Candidate,Source);Metadata.title=Candidate.subtitleStatus?.languages?.join(', ') || '';Update(LatestJob,LatestMetrics,false);}};
}
