/** Both surfaces derive presentation from the same real worker snapshots. */
import {ObserveJobs} from './lib/job-feed.js';
import {SpeedSampleMs} from './lib/metrics.js';
import {PresentJob} from './lib/row-presentation.js';
export function CreateCandidateJobStatus(UpdateLive,ReportShownJobs)
{
 const Jobs=new Map(),Samples=new Map(),LocalMediaKeys=new Set();
 let Rows=new Map();
 function Render() {
  const Shown=[];
  const Latest=new Map();
  for(const Job of Jobs.values()) {
   if(Job.snapshot) continue;
   const Previous=Latest.get(Job.mediaKey);
   if(!Previous || Job.created>Previous.created) Latest.set(Job.mediaKey,Job);
  }
  const Now=performance.now();
  for(const [Key,Entry] of Rows) {
   const Job=Latest.get(Key),Sample=Samples.get(Job?.requestId);
   const View=Job && PresentJob(Job,{role:'candidate',previous:Sample,now:Now});
   if(Job)Shown.push(Job.requestId);
   Entry.update(Job,View?.metrics);
   if(Job?.state==='active' && (!Sample || Now-Sample.time>=SpeedSampleMs)) Samples.set(Job.requestId,{time:Now,bytes:Job.bytesReceived});
  }
  ReportShownJobs?.(Shown);
 }
 const Refresh=ObserveJobs({mediaKeys:LocalMediaKeys,onUpdate(Changes){
  for(const [Id,Job] of Changes) {if(Job) Jobs.set(Id,Job);else {Jobs.delete(Id);Samples.delete(Id);}}
  Render();
 },onError(){}});
 return function ShowStatuses(NextRows=new Map()) {
  Rows=NextRows;LocalMediaKeys.clear();for(const Key of Rows.keys())LocalMediaKeys.add(Key);Render();Refresh();
 };
}
