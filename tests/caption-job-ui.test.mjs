import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateCaptionJobStatus} from '../extension/local-captions-job.js';

class Node {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.className='';this.hidden=false;this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(){}
 replaceChildren(...nodes){this.children=nodes;}
}
for(const mode of ['early-audio','windowed']){
 for(const mediaReady of [false,true]){
  test(`${mode} status follows actual recognition phases before and after media completion (${mediaReady})`,t=>{
   globalThis.document={createElement:tag=>new Node(tag)};t.after(()=>delete globalThis.document);
   const current=job(),entry=CreateCaptionJobStatus(current,()=>{},()=>{});
   const prefix='Speech captions · '+(mediaReady?'':'Downloading · ');
   for(const [phase,label] of [['queued','Queued for recognition'],['loading-model','Loading speech recognition model'],['recognizing','Recognizing speech'],['recognized','Captions prepared'],['windowed-ready','Preparing recognition results']]){
    entry.update({...current,captionStatus:{phase,mode,mediaReady}});
    assert.equal(entry.node.textContent,prefix+label,phase);
    assert.equal(all(entry.node).filter(n=>n.tagName==='button').length,0);
   }
  });
 }
}
const all=node=>[node,...node.children.flatMap(all)];
const job=(Options={})=>({requestId:'12345678-1234-1234-1234-123456789abc',filename:'video.mp4',state:'active',captionPipeline:'staged',localCaptions:{enabled:true,container:true,formats:[],...Options},captionStatus:{phase:'recognizing',mode:'windowed',attempt:1,liveFile:{phase:'awaiting-selection'},liveTranscript:{revision:1,cues:[{startSample:128000,endSample:144000,text:'intermediate words',provisional:true}]}}});
test('corrected subtitle overlap shows a warning while recognition continues',t=>{
 globalThis.document={createElement:tag=>new Node(tag)};t.after(()=>delete globalThis.document);
 const entry=CreateCaptionJobStatus({...job(),captionStatus:{phase:'recognizing',mode:'windowed',warningCount:2}},()=>{},()=>{});
 assert.match(entry.node.textContent,/Recognizing speech.*warning/);assert.doesNotMatch(entry.node.textContent,/failed/i);assert.equal(all(entry.node).find(n=>n.className==='caption-job-status').dataset.failed,'false');
});
test('decoder failure identifies its stage and stable code instead of generic processing failure',t=>{
 globalThis.document={createElement:tag=>new Node(tag)};t.after(()=>delete globalThis.document);
 const entry=CreateCaptionJobStatus({...job(),captionStatus:{phase:'failed',error:'caption_av_decode_failed'}},()=>{},()=>{});
 assert.match(entry.node.textContent,/Audio decoding failed/);
 assert.match(entry.node.textContent,/caption_av_decode_failed/);
 assert.doesNotMatch(entry.node.textContent,/Processing or save failed/);
});
test('unmapped safe failures remain visible and cancellation retains the prior failure separately',t=>{
 globalThis.document={createElement:tag=>new Node(tag)};t.after(()=>delete globalThis.document);
 const entry=CreateCaptionJobStatus({...job(),captionStatus:{phase:'failed',error:'caption_new_failure'}},()=>{},()=>{});
 assert.match(entry.node.textContent,/caption_new_failure/);
 entry.update({...job(),captionStatus:{phase:'canceled',error:null,attempt:1,lastFailure:{code:'caption_av_decode_failed',attempt:1,details:{operation:'select-audio',exceptionType:'AttributeError'}}}});
 assert.match(entry.node.textContent,/canceled.*Previous failure.*Audio decoding failed.*caption_av_decode_failed/i);
 entry.update({...job(),captionStatus:{phase:'recognizing',attempt:2,lastFailure:{code:'caption_av_decode_failed',attempt:1}}});
 assert.doesNotMatch(entry.node.textContent,/Previous failure|caption_av_decode_failed/);
});
for(const [name,options] of [['embedded',{container:true,formats:[]}],['SRT',{container:false,formats:['srt']}],['VTT',{container:false,formats:['vtt']}],['combined',{container:true,formats:['srt','vtt']}]]){
 test(`${name} recognition needs no extra save button, file selection or transcript panel`,t=>{
  globalThis.document={createElement:tag=>new Node(tag)};t.after(()=>delete globalThis.document);
  const entry=CreateCaptionJobStatus(job(options),()=>{},()=>{}),nodes=all(entry.node);
  assert.equal(nodes.filter(n=>n.tagName==='button').length,0);
  assert.doesNotMatch(entry.node.textContent,/Save live|Choose a file|Live speech|intermediate words|May be revised/);
  assert.match(entry.node.textContent,/Speech captions.*Recognizing speech/);
  entry.update({...job(options),state:'complete',captionStatus:{phase:'complete',outputs:['video.mp4']}});
  assert.match(entry.node.textContent,/Complete.*video\.mp4/);
 });
}
