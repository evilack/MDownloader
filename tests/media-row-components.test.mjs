import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {CreateJobRow,GetJobRowSignature,UpdateJobRowMetrics} from '../extension/job-row.js';
import {CreateCandidateRow} from '../extension/candidate-row.js';
import {CreateCandidateDownloadActions} from '../extension/candidate-download.js';
import {UpdateRowMetadata} from '../extension/media-row.js';
class Element {
 constructor(Tag){this.tagName=Tag;this.children=[];this.attributes={};this.dataset={};this.classList={add(){},toggle(){}};this.events={};}
 append(...Nodes){this.children.push(...Nodes);}
 replaceChildren(...Nodes){this.children=Nodes;}
 setAttribute(K,V){this.attributes[K]=String(V);}
 getAttribute(K){return this.attributes[K] ?? null;}
 hasAttribute(K){return K in this.attributes;}
 removeAttribute(K){delete this.attributes[K];}
 addEventListener(K,V){this.events[K]=V;}
 get childElementCount(){return this.children.length;}
}
const Flatten=N=>[N,...N.children.flatMap(Flatten)];
Test('DVR candidates replace the HLS text badge and update when capability information arrives',T=>{
 globalThis.document={createElement:Tag=>new Element(Tag)};T.after(()=>delete globalThis.document);
 const Entry=CreateCandidateRow({name:'live.m3u8',format:'M3U8',live:true},{thumbnail:{control:new Element('div')},download:new Element('button')});
 Assert.ok(Flatten(Entry.row).some(N=>N.textContent==='HLS'));
 Entry.update({state:'active',hls:true,live:true,dvr:false,bytesReceived:1});
 Entry.updateSource({dvr:true});Assert.ok(Flatten(Entry.row).some(N=>N.textContent==='DVR'));
 Assert.equal(Flatten(Entry.row).some(N=>N.textContent==='HLS'),false);Assert.equal(Entry.live.hidden,false);
 Entry.updateSource({dvr:false});Assert.ok(Flatten(Entry.row).some(N=>N.textContent==='HLS'));
 const Job={requestId:'dvr',filename:'live.mp4',state:'active',hls:true,live:true,dvr:true,bytesReceived:100};
 const Row=CreateJobRow(Job,{control:new Element('div')},{Announce(){},Refresh(){},CountFormat:new Intl.NumberFormat('en')});
 Assert.ok(Flatten(Row.row).some(N=>N.textContent==='DVR'));
 Assert.notEqual(GetJobRowSignature(Job),GetJobRowSignature({...Job,dvr:false}));
});
Test('metric refresh preserves unchanged subtitle nodes and updates changed error or translation state',T=>{
 globalThis.document={createElement:Tag=>new Element(Tag)};T.after(()=>delete globalThis.document);
 const Node=new Element('div'),Items=[{text:'Subs(1/2)',failed:false},{text:'Trans(ko)',working:true}];
 UpdateRowMetadata(Node,Items);
 const First=Node.children[0],Translation=Node.children[1];
 UpdateRowMetadata(Node,Items.map(Item=>({...Item})));
 Assert.equal(Node.children[0],First,'metric-only refresh must preserve metadata DOM');
 Assert.equal(Node.children[1],Translation);
 Items[1].working=false;
 UpdateRowMetadata(Node,Items);
 Assert.notEqual(Node.children[1],Translation,'mutated presentation values must still be detected');
 Assert.equal(Node.children[1].className,undefined);
 UpdateRowMetadata(Node,[{text:'Error(1)',failed:true}]);
 Assert.equal(Node.dataset.failed,'true');Assert.equal(Node.children[0].className,'metadata-failed');
 UpdateRowMetadata(Node,[]);Assert.equal(Node.hidden,true);Assert.equal(Node.dataset.failed,'false');
});
Test('candidate download stays disabled for unfinished jobs without a control identity and unlocks after termination',T=>{
 globalThis.document={createElement:Tag=>new Element(Tag)};T.after(()=>delete globalThis.document);
 const Download=new Element('button');
 const Entry=CreateCandidateRow({name:'video.mp4',format:'YOUTUBE'},{thumbnail:{control:new Element('div')},download:Download});
 Assert.equal(Download.disabled,false);
 for(const Fields of [{state:'starting'},{state:'active'},{state:'paused'},{state:'active',muxing:true},{state:'active',saving:true},{state:'active',waiting:true},{state:'active',pendingAction:'cancel'}]) {
  Entry.update({...Fields,bytesReceived:100});
  Assert.equal(Download.disabled,true,JSON.stringify(Fields));
  Entry.updateSource({subtitleStatus:{phase:'undetected',count:0}});
  Assert.equal(Download.disabled,true,'subtitle refresh must preserve the download lock');
 }
 for(const State of ['complete','canceled','failed','interrupted','unknown']) {
  Entry.update({state:State,connecting:true,waiting:true,bytesReceived:100});
  Assert.equal(Download.disabled,false,State);
 }
 Entry.update();Assert.equal(Download.disabled,false);
});
Test('enqueue completion cannot unlock a job already reported as downloading',async T=>{
 globalThis.document={createElement:Tag=>new Element(Tag)};
 T.after(()=>{delete globalThis.document;delete globalThis.chrome;});
 const Scan=Promise.withResolvers(),Enqueue=Promise.withResolvers(),Sent=Promise.withResolvers();
 let Calls=0;
 globalThis.chrome={runtime:{sendMessage:async()=>{Calls++;Sent.resolve();return Enqueue.promise;}}};
 const Actions=CreateCandidateDownloadActions(()=>{},()=>{},()=>Scan.promise);
 const Download=Actions.CreateDownloadButton({format:'M3U8'},{},()=>true);
 const Entry=CreateCandidateRow({name:'video',format:'M3U8'},{thumbnail:{control:new Element('div')},download:Download});
 const Click=Download.events.click({});
 Assert.equal(Download.disabled,true,'disable immediately while preparing the request');
 Entry.update();Assert.equal(Download.disabled,true,'an empty job refresh must not unlock preparation');
 Scan.resolve();await Sent.promise;
 Entry.update({state:'active',bytesReceived:100});
 Enqueue.resolve({ok:true,data:{state:'started'}});await Click;
 Assert.equal(Download.disabled,true,'finally must preserve the running job lock');
 await Download.events.click({});Assert.equal(Calls,1,'disabled jobs cannot enqueue again');
 Entry.update({state:'complete',bytesReceived:100});Assert.equal(Download.disabled,false);
});
Test('successful enqueue stays locked until its first job snapshot arrives',async T=>{
 globalThis.document={createElement:Tag=>new Element(Tag)};
 T.after(()=>{delete globalThis.document;delete globalThis.chrome;});
 globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,data:{state:'started'}})}};
 const Actions=CreateCandidateDownloadActions(()=>{},()=>{});
 const Download=Actions.CreateDownloadButton({format:'M3U8'},{},()=>true);
 const Entry=CreateCandidateRow({name:'video',format:'M3U8'},{thumbnail:{control:new Element('div')},download:Download});
 await Download.events.click({});Assert.equal(Download.disabled,true);
 Entry.updateSource({subtitleStatus:{phase:'undetected',count:0}});
 Assert.equal(Download.disabled,true,'subtitle lookup cannot unlock an accepted request before its job arrives');
 Entry.update({state:'active',bytesReceived:100});Assert.equal(Download.disabled,true);
 Entry.update({state:'failed',bytesReceived:100});Assert.equal(Download.disabled,false);
});
Test('subtitle refresh preserves scheduled metadata and the latest real candidate job state',T=>{
 globalThis.document={createElement:Tag=>new Element(Tag)};T.after(()=>delete globalThis.document);
 const Entry=CreateCandidateRow({name:'scheduled.mp4',format:'YOUTUBE',upcoming:true,scheduledStartTime:'2026-11-10T12:00:00Z'},{thumbnail:{control:new Element('div')},download:new Element('button')});
 Entry.updateSource({upcoming:true,scheduledStartTime:'2026-11-10T12:00:00Z',subtitleStatus:{phase:'undetected',count:0}});
 Assert.ok(Flatten(Entry.row).some(N=>N.textContent?.endsWith('Scheduled')));
 Entry.update({state:'active',waiting:true,pendingAction:'cancel',bytesReceived:0});
 Entry.updateSource({subtitleStatus:{phase:'undetected',count:0}});
 Assert.ok(Flatten(Entry.row).some(N=>N.textContent==='Canceling'));
});
Test('direct browser downloads preserve current-range saving after a native download ID exists',T=>{
 globalThis.document={createElement:Tag=>new Element(Tag)};T.after(()=>delete globalThis.document);
 const Entry=CreateJobRow({requestId:'native',filename:'movie.mp4',state:'active',downloadId:7,snapshotAvailable:true,bytesReceived:1000,totalBytes:10000},{control:new Element('div')},{Announce(){},Refresh(){},CountFormat:new Intl.NumberFormat('en')});
 Assert.ok(Flatten(Entry.row).some(N=>N.dataset.action==='snapshot'));
});
Test('actual manager composes shared layout and compact icons without secondary text actions',T=>{
 globalThis.document={createElement:Tag=>new Element(Tag)};T.after(()=>delete globalThis.document);
 const Base={requestId:'id',filename:'video.mp4',state:'active',hls:true,hasUrl:true,bytesReceived:100,finished:1,snapshotAvailable:true};
 const Context={Announce(){},Refresh(){},CountFormat:new Intl.NumberFormat('en')};
 const Entry=CreateJobRow(Base,{control:new Element('div')},Context);
 Assert.match(Entry.row.className,/media-row/);
 const Buttons=Flatten(Entry.row).filter(N=>N.tagName==='button' && N.dataset.action);
 Assert.deepEqual(Buttons.map(N=>N.dataset.action),['cancel','snapshot','finish']);
 Assert.ok(Buttons.every(N=>N.children[0]?.tagName==='img'));
 Assert.equal(GetJobRowSignature(Base),GetJobRowSignature({...Base,bytesReceived:9999}));
 Assert.notEqual(GetJobRowSignature(Base),GetJobRowSignature({...Base,pendingAction:'cancel'}));
 const Interrupted={...Base,state:'interrupted',recording:true,live:true,exists:true};
 const Partial=CreateJobRow(Interrupted,{control:new Element('div')},Context);
 UpdateJobRowMetrics(Partial,Interrupted,100);
 Assert.deepEqual(Flatten(Partial.row).filter(N=>N.dataset.action).map(N=>N.dataset.action),['show','remove']);
 Assert.ok(Flatten(Partial.row).some(N=>N.textContent==='Interrupted'));
 Assert.ok(Flatten(Partial.row).some(N=>N.textContent?.startsWith('Partial saved')));
});
