import Test from 'node:test';
import Assert from 'node:assert/strict';
import {SubmitIssueReport, HandleIssueReport} from '../extension/lib/issue-report.js';

const Input={pageUrl:'https://example.com/watch?id=7',types:['download','detection'],description:'재생 후에도 실패합니다.'};
const Rules=[];
const Api={runtime:{id:'test',getURL:Path=>'chrome-extension://test/'+Path,getManifest:()=>({version:'0.2.43'})},
 declarativeNetRequest:{updateSessionRules:async Change=>{Rules.push(Change);}}};
Test('posts parseable report JSON with KST timestamp, 8 random characters, and no sender fields',async()=>{
 let Request;
 const Result=await SubmitIssueReport(Input,{Api,Now:new Date('2026-11-10T11:46:39.214Z'),Fetch:async(Url,Options)=>{
  Request={url:Url,...Options};return Response.json({success:'true'});
 }});
 Assert.equal(Request.url,'https://formsubmit.co/ajax/evilackyt01@gmail.com');
 Assert.equal(Request.method,'POST');Assert.equal(Request.credentials,'omit');
 Assert.equal(Request.headers['Content-Type'],'application/json');
 const Body=JSON.parse(Request.body);
 Assert.match(Body._subject,/^MDownloader_report_20261110-204639_[a-f0-9]{8}$/);
 Assert.equal(Result.subject,Body._subject);Assert.equal(Body._url,'https://evilack.github.io/');
 Assert.deepEqual(Object.keys(Body).sort(),['_subject','_url','message']);
 Assert.deepEqual(JSON.parse(Body.message),{app:'MDownloader',extension_version:'0.2.43',reported_at:'2026-11-10T11:46:39.214Z',page_url:Input.pageUrl,issue_types:['url_detection_failed','download_failed'],description:Input.description});
});
Test('unique suffixes distinguish submissions with the same sending time',async()=>{
 const Options={Api,Now:new Date('2026-11-10T11:46:39.214Z'),Fetch:async()=>Response.json({success:true})};
 const Subjects=await Promise.all(Array.from({length:32},async()=> (await SubmitIssueReport(Input,Options)).subject));
 Assert.equal(new Set(Subjects).size,32);
});
Test('HTTP 200 with success false is rejected, including activation responses',async()=>{
 await Assert.rejects(SubmitIssueReport(Input,{Api,Fetch:async()=>Response.json({success:'false',message:'This form needs Activation.'})}),E=>E.key==='issue_report_activation');
 await Assert.rejects(SubmitIssueReport(Input,{Api,Fetch:async()=>Response.json({success:'false',message:'Rejected'})}),E=>E.key==='issue_report_failed');
 await Assert.rejects(SubmitIssueReport(Input,{Api,Fetch:async()=>Response.json({message:'OK'})}),E=>E.key==='issue_report_failed');
});
Test('HTTP errors, malformed responses and network failure never report success or retry automatically',async()=>{
 for(const Fetch of [async()=>new Response('down',{status:503}),async()=>new Response('<html>error</html>'),async()=>{throw new TypeError('Failed to fetch');}]){
  let Calls=0;await Assert.rejects(SubmitIssueReport(Input,{Api,Fetch:(...Args)=>{Calls++;return Fetch(...Args);}}));Assert.equal(Calls,1);
 }
});
Test('invalid URL, empty or unknown types, and oversized input are rejected before networking',async()=>{
 for(const Bad of [{pageUrl:''},{pageUrl:'chrome://extensions'},{pageUrl:'javascript:alert(1)'},{types:[]},{types:['arbitrary']},{description:'a'.repeat(2001)}]){
  await Assert.rejects(SubmitIssueReport({...Input,...Bad},{Api,Fetch:()=>Assert.fail('invalid report must not send')}));
 }
});
Test('only popup and sidepanel extension senders may submit, never content scripts or external callers',async()=>{
 for(const Sender of [{id:'other',url:Api.runtime.getURL('popup.html')},{id:'test',url:'https://example.com/'},{id:'test',url:Api.runtime.getURL('options.html')},{id:'test',url:Api.runtime.getURL('popup.html/other')}]){
  Assert.equal(HandleIssueReport({type:'submitIssueReport',report:Input},Sender,()=>Assert.fail('forbidden sender'),Api),false);
 }
 Assert.equal(HandleIssueReport({type:'other'}, {id:'test',url:Api.runtime.getURL('popup.html')},()=>Assert.fail(),Api),false);
});
Test('authorized worker handler responds asynchronously with a serialized result',async T=>{
 T.mock.method(globalThis,'fetch',async()=>Response.json({success:'true'}));
 for(const Name of ['popup.html','sidepanel.html?section=media']){
  const Reply=await new Promise(Resolve=>Assert.equal(HandleIssueReport({type:'submitIssueReport',report:Input},{id:'test',url:Api.runtime.getURL(Name)},Resolve,Api),true));
  Assert.equal(Reply.ok,true);Assert.match(Reply.data.subject,/^MDownloader_report_/);
 }
});
Test('source header applies only to extension POSTs at the exact report endpoint and is removed after a failure',async()=>{
 Rules.length=0;
 await Assert.rejects(SubmitIssueReport(Input,{Api,Fetch:async()=>{throw Error('offline');}}));
 Assert.equal(Rules.length,2);
 const [Rule]=Rules[0].addRules;
 Assert.deepEqual(Rule.condition,{urlFilter:'|https://formsubmit.co/ajax/evilackyt01@gmail.com|',initiatorDomains:['test'],requestMethods:['post'],resourceTypes:['xmlhttprequest']});
 Assert.deepEqual(Rule.action,{type:'modifyHeaders',requestHeaders:[{header:'referer',operation:'set',value:'https://evilack.github.io/'},{header:'origin',operation:'set',value:'https://evilack.github.io'}]});
 Assert.deepEqual(Rules[1],{removeRuleIds:[Rule.id]});
});
Test('cleanup failure after an accepted report does not invite a duplicate submission',async()=>{
 let Calls=0;
 const CleanupFailingApi={...Api,declarativeNetRequest:{updateSessionRules:async Change=>{if(!Change.addRules)throw Error('cleanup failed');}}};
 const Result=await SubmitIssueReport(Input,{Api:CleanupFailingApi,Fetch:async()=>{Calls++;return Response.json({success:'true'});}});
 Assert.match(Result.subject,/^MDownloader_report_/);Assert.equal(Calls,1);
});
