import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {InitializeLocale} from '../extension/lib/i18n.js';

Test('shared presentation uses truthful lifecycle states in every surface', async T => {
 T.mock.method(globalThis, 'fetch', async Url => new Response(await readFile(Url)));
 await InitializeLocale('ko');
 const {PresentJob, SubtitleMetadata} = await import('../extension/lib/row-presentation.js');
 const Base={state:'active',bytesReceived:5800000,totalBytes:10000000};
 for(const [Fields,Label] of [[{state:'starting'},'Start'],[{waiting:true,live:false},'Ready'],[{connecting:true},'Connecting'],[{state:'paused'},'Paused'],[{pendingAction:'cancel'},'Canceling'],[{pendingAction:'finish'},'Stopping'],[{state:'canceled'},'Canceled'],[{state:'failed'},'Failed'],[{state:'interrupted',exists:true},'Interrupted']]) {
  for(const Role of ['job','candidate']) Assert.equal(PresentJob({...Base,...Fields},{role:Role}).label,Label);
 }
 Assert.equal(PresentJob({...Base,state:'complete'},{role:'candidate'}).label,'Done');
 Assert.deepEqual(SubtitleMetadata(),[]);
 Assert.deepEqual(SubtitleMetadata({phase:'ready',count:23,completed:0,unavailable:23,translation:'no_source'}),[{text:'Subs(0/23)',failed:false},{text:'Error(23)',failed:true}]);
 Assert.deepEqual(SubtitleMetadata({phase:'failed',count:23,completed:0,errorCount:23,translation:'off'}),[{text:'Subs(0/23)',failed:false},{text:'Error(23)',failed:true}]);
 Assert.deepEqual(SubtitleMetadata({phase:'failed',count:23,completed:2,errorCount:3,translation:'off'}),[{text:'Subs(2/23)',failed:false},{text:'Error(3)',failed:true}]);
 Assert.deepEqual(SubtitleMetadata({phase:'failed',count:0,errorCount:1,translation:'off'}),[{text:'Error(1)',failed:true}]);
 Assert.deepEqual(SubtitleMetadata({phase:'checking',translation:'unknown'}),[]);
 Assert.deepEqual(SubtitleMetadata({phase:'detected',count:23,translation:'off'}).map(X=>X.text),['Subs(23)']);
 Assert.deepEqual(SubtitleMetadata({phase:'failed',count:23,completed:21,translation:'failed',targetLanguage:'ko'}).map(X=>X.text),['Subs(21/23)','Error(2)']);
 Assert.deepEqual(SubtitleMetadata({phase:'ready',count:23,translation:'not_needed'}).map(X=>X.text),['Subs(23/23)']);
 Assert.equal(PresentJob({state:'starting',subtitleStatus:{phase:'detected',count:23,translation:'off'}}).metadata[0].text,'Subs(0/23)');
 const Finite=PresentJob({...Base,snapshot:true,live:true,recording:true,count:100,finished:72});
 Assert.equal(Finite.metrics.percent,72);
 Assert.equal(Finite.metrics.progress,'72%');
 Assert.equal(PresentJob({...Base,recording:true,live:true}).metrics.percent,null);
 const Complete=PresentJob({...Base,state:'complete',startTime:'2026-11-09T00:00:00Z',endTime:'2026-11-09T00:00:02Z'});
 Assert.equal(Complete.metrics.progress,'5.8 MB');
 Assert.equal(Complete.metrics.speed,'Avg 2.9 MB/s');
 Assert.equal(PresentJob({...Base,waiting:true,live:true,scheduledStartTime:'2026-11-10T12:00:00Z'}).live,false);
 Assert.match(PresentJob({...Base,state:'interrupted',exists:true,recording:true}).metadata[0].text,/Partial saved · 5.8 MB/);
 Assert.equal(PresentJob({...Base,state:'interrupted',exists:false,recording:true}).metadata.some(X=>X.text.startsWith('Partial saved')),false);
});
