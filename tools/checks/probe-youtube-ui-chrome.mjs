/** Actual development Chrome UI acceptance; no Computer Use or external extractor. */
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {InspectMp4Subtitles} from '../lib/inspect-mp4-subtitles.mjs';
const Root=fileURLToPath(new URL('../../',import.meta.url));
const {chromium}=await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Artifact=Path.join(Root,'artifacts/youtube-ui/chrome-'+Date.now());await mkdir(Artifact,{recursive:true});
const Context=await chromium.launchPersistentContext(Path.join(Artifact,'profile'),{executablePath:process.env.MDOWNLOADER_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required']});
const Report={videoId:'-XHx839rSc8',flavor:'development',computerUse:false,externalExtractor:false,stages:[]};
Report.downloadAction=process.argv.includes('--auto')?'normal-click-best-quality':'shift-click-360p';
Context.setDefaultTimeout(15000);
let UI;
async function Panel(Browser,Target)
{
 const {sessionId}=await Browser.send('Target.attachToTarget',{targetId:Target.targetId,flatten:false});let serial=0;
 async function Send(method,params={}){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{Browser.off('Target.receivedMessageFromTarget',listener);reject(Error('panel-command-timeout'));},90000);function listener(e){if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id!==id)return;clearTimeout(timer);Browser.off('Target.receivedMessageFromTarget',listener);if(m.error)reject(Error('panel-protocol-error'));else resolve(m.result);}Browser.on('Target.receivedMessageFromTarget',listener);void Browser.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});}
 async function evaluate(fn,arg){const r=await Send('Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('panel-evaluation-error');return r.result.value;}
 function locator(selector){return{first(){return this;},async waitFor({timeout=15000}={}){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(s=>!!document.querySelector(s),selector))return;await new Promise(r=>setTimeout(r,100));}throw Error('panel-selector-timeout:'+selector);},async click({modifiers=[]}={}){const p=await evaluate(s=>{const e=document.querySelector(s);if(!e)throw Error('missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},selector);const params={...p,button:'left',clickCount:1,modifiers:modifiers.includes('Shift')?8:0};await Send('Input.dispatchMouseEvent',{type:'mousePressed',...params});await Send('Input.dispatchMouseEvent',{type:'mouseReleased',...params});},allTextContents(){return evaluate(s=>[...document.querySelectorAll(s)].map(e=>e.textContent),selector);},textContent(){return evaluate(s=>document.querySelector(s)?.textContent,selector);},selectOption(value){return evaluate(({s,value})=>{const e=document.querySelector(s);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));},{s:selector,value});}};}
 return{evaluate,locator,async screenshot({path}){const r=await Send('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(r.data,'base64'));}};
}
try{
 const Browser=await Context.browser().newBrowserCDPSession();Report.browser=(await Browser.send('Browser.getVersion')).product;
 await Browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:Path.join(Artifact,'downloads'),eventsEnabled:true});
 const {id}=await Browser.send('Extensions.loadUnpacked',{path:Path.join(Root,'artifacts/distributions/development/extension')});
 const Settings=await Context.newPage();await Settings.goto('chrome://extensions');
 const Options=await Context.newPage();await Options.goto(`chrome-extension://${id}/options.html`);
 async function Approve(hosts){await Settings.evaluate(async({id,hosts})=>{for(const host of hosts)await chrome.developerPrivate.addHostPermission(id,host);},{id,hosts});await Options.evaluate(hosts=>chrome.permissions.request({origins:hosts}),hosts);}
 await Approve(['https://www.youtube.com/*','https://youtubei.googleapis.com/*']);
 await Options.evaluate(()=>chrome.storage.local.set({showPanelMedia:true,language:'ko'}));
 const Source=await Context.newPage();await Source.goto('https://www.youtube.com/watch?v=-XHx839rSc8',{waitUntil:'domcontentloaded'});await Source.bringToFront();
 const sourceWindow=await Options.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url?.includes('watch?v=-XHx839rSc8')).windowId;});
 await Options.evaluate(windowId=>{const b=document.createElement('button');b.id='open-test-panel';b.textContent='Open panel';b.onclick=()=>chrome.sidePanel.open({windowId});document.body.append(b);},sourceWindow);
 await Options.locator('#open-test-panel').click();
 await new Promise(r=>setTimeout(r,500));
 Report.targets=(await Browser.send('Target.getTargets')).targetInfos.filter(t=>t.url.startsWith(`chrome-extension://${id}/`)).map(t=>({type:t.type,path:new URL(t.url).pathname}));
 console.log(JSON.stringify({stage:'panel-opened',targets:Report.targets,pages:Context.pages().map(p=>p.url().startsWith('chrome-extension:')?new URL(p.url()).pathname:'web')}));
 const PanelTarget=(await Browser.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/sidepanel.html`);
 if(!PanelTarget)throw Error('native-panel-unavailable');UI=await Panel(Browser,PanelTarget);
 await UI.evaluate(()=>{globalThis.ProbeEvents=[];document.addEventListener('click',e=>ProbeEvents.push({click:e.target.closest('button')?.getAttribute('aria-label'),shift:e.shiftKey}),true);const original=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async function(m,...args){const r=await original(m,...args);if(['youtubeQualities','enqueue'].includes(m.type))ProbeEvents.push({type:m.type,ok:r?.ok,error:r?.error?.key??(r?.ok?undefined:'request-failed')});return r;};});
 await UI.locator('#scan').click();
 await UI.locator('.candidate [data-format="YOUTUBE"]').waitFor({timeout:30000});Report.stages.push('normal-candidate');
 const Download=UI.locator('.candidate .actions button');
 // First request exposes only the exact CDN origin in the normal quality model. Approve that host in this isolated profile before the UI confirm click.
 await Download.click({modifiers:process.argv.includes('--auto')?[]:['Shift']});
 await new Promise(r=>setTimeout(r,1000));console.log(JSON.stringify({stage:'download-click',events:await UI.evaluate(()=>ProbeEvents),status:await UI.locator('[data-candidate-status]').textContent()}));
 await UI.locator('#quality-dialog[open]').waitFor({timeout:30000});
 Report.qualities=await UI.locator('#quality option').allTextContents();
 const permission=await UI.evaluate(async()=>{const data=await chrome.storage.session.get(null);return Object.values(data).flatMap(v=>v?.candidates??[]).filter(c=>c.format==='YOUTUBE').map(c=>({url:c.url}));});
 if(permission.length!==1)throw Error('candidate-count');
 // Inspect optional request origin through the UI's authenticated provider route; no direct client or receiver invocation.
 const qualityData=await UI.evaluate(async()=>{const entries=Object.values(await chrome.storage.session.get(null)).find(v=>v?.scanId&&v.candidates?.some(c=>c.format==='YOUTUBE'));const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const r=await chrome.runtime.sendMessage({type:'youtubeQualities',tabId:tab.id,scanId:entries.scanId,candidateId:entries.candidates.find(c=>c.format==='YOUTUBE').id});if(!r.ok)throw Error('quality-query');return r.data;});
 const host=qualityData[0].serverPermission;
 if(host){if(!/^https:\/\/[^/]+\.googlevideo\.com\/\*$/.test(host))throw Error('unexpected-cdn');await Approve([host]);Report.exactCdnApproved=true;}
 // Select 360p from the normal Shift dialog, as in the previously accepted same-video proof.
 if(process.argv.includes('--auto')){Report.firstUsePermissionHandoff=Report.qualities.length===1;await UI.locator('#confirm-quality').click();}
 else{const qualityIndex=Report.qualities.findIndex(q=>q.includes('640×360'));if(qualityIndex<0)throw Error('360p-missing');await UI.locator('#quality').selectOption(String(qualityIndex));await UI.locator('#confirm-quality').click();}
 await UI.locator('#active li.job').first().waitFor({timeout:30000});Report.stages.push('manager-active');
 await UI.screenshot({path:Path.join(Artifact,'manager-active.png'),fullPage:true});
 const deadline=Date.now()+240000;let Job;
 do{
  Job=await Options.evaluate(async()=>Object.entries(await chrome.storage.local.get(null)).find(([k,v])=>k.startsWith('job:')&&v.youtube)?.[1]);
  if(Job?.state==='failed'||Job?.state==='canceled')throw Error('transfer-'+Job.state+':'+JSON.stringify(Job.error));
  if(Job?.downloadId!==undefined){const item=await Options.evaluate(async id=>(await chrome.downloads.search({id}))[0],Job.downloadId);if(item?.state==='complete'){Report.download={state:item.state,bytes:item.bytesReceived,filename:item.filename};break;}if(item?.state==='interrupted')throw Error('save-interrupted');}
  await new Promise(r=>setTimeout(r,250));
 }while(Date.now()<deadline);
 if(Report.download?.state!=='complete')throw Error('full-save-timeout');
 Report.job={youtube:Job.youtube,hls:!!Job.hls,filename:Job.filename,bytesReceived:Job.bytesReceived,receipt:Job.receipt,captionReceipt:Job.captionReceipt};
 await UI.locator('#complete li.job').first().waitFor({timeout:15000});Report.stages.push('manager-complete');await UI.screenshot({path:Path.join(Artifact,'manager-complete.png'),fullPage:true});
 const Original=Path.resolve(Report.download.filename);if(!Original.startsWith(Path.resolve(Artifact)+Path.sep))throw Error('unexpected-output');
 const Output=Path.join(Artifact,Path.basename(Job.filename));await copyFile(Original,Output);const Data=await readFile(Output);
 Report.save={output:Output,bytes:Data.length,sha256:createHash('sha256').update(Data).digest('hex'),browserFilename:Path.basename(Original)};delete Report.download.filename;
 if(process.argv.includes('--captions')){
  Report.subtitles=InspectMp4Subtitles(Data);const receipt=Job.captionReceipt;
  const languageCode={en:'eng',ko:'kor'};
  Report.captionsPassed=!!(receipt?.phase==='ready'&&receipt.httpResponses===receipt.count&&receipt.count>0&&Report.subtitles.length===receipt.count&&receipt.tracks.every((t,i)=>Report.subtitles[i].language===languageCode[t.language]&&Report.subtitles[i].nonemptySamples>0&&Report.subtitles[i].linesHash===t.linesHash&&Report.subtitles[i].timelineHash===t.timelineHash&&Report.subtitles[i].firstStartMs===t.firstStartMs&&Report.subtitles[i].lastEndMs===t.lastEndMs));
 }
 await Options.evaluate(()=>{const i=document.createElement('input');i.type='file';i.id='verified-output';document.body.append(i);});await Options.locator('#verified-output').setInputFiles(Output);
 Report.decode=await Options.evaluate(async()=>{
  const {Input,BlobSource,ALL_FORMATS,EncodedPacketSink,VideoSampleSink,AudioSampleSink}=await import('./vendor/mediabunny-1.65.2.mjs');
  const input=new Input({formats:ALL_FORMATS,source:new BlobSource(document.querySelector('#verified-output').files[0])});
  try{const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();if(!video||!audio)return{ok:false};
   const packets={};for(const[kind,track]of[['video',video],['audio',audio]]){let count=0,end=0;for await(const p of new EncodedPacketSink(track).packets()){count++;end=Math.max(end,p.timestamp+p.duration);}packets[kind]={count,end};}
   const samples=[];for(const at of[1,620]){const v=await new VideoSampleSink(video).getSample(at),a=await new AudioSampleSink(audio).getSample(at);if(!v||!a)return{ok:false};const f=v.toVideoFrame(),d=a.toAudioData(),values=new Float32Array(d.numberOfFrames);d.copyTo(values,{planeIndex:0,format:'f32-planar'});samples.push({at,width:f.displayWidth,height:f.displayHeight,audioFrames:d.numberOfFrames,rms:Math.sqrt(values.reduce((s,x)=>s+x*x,0)/values.length)});f.close();d.close();v.close();a.close();}
   const duration=await input.computeDuration();return{ok:Math.round(duration)===623&&Math.round(packets.video.end)===623&&Math.round(packets.audio.end)===623&&samples.every(s=>s.rms>0.0001),duration,packets,samples};
  }finally{input.dispose();}
 });
 Report.persistence=await Options.evaluate(async()=>{const all=JSON.stringify(await chrome.storage.local.get(null));const session=JSON.stringify(await chrome.storage.session.get(null));return{noSignedMedia:!all.includes('googlevideo.com')&&!session.includes('googlevideo.com'),noSabrConfig:!all.includes('ustreamerConfig')&&!session.includes('ustreamerConfig'),noCaptionSourceOrBody:![all,session].some(s=>s.includes('/api/timedtext')||s.includes('WEBVTT')),apiContextReleased:!(await chrome.declarativeNetRequest.getSessionRules()).some(r=>r.id===2146999997)};});
 Report.passed=!!(Report.decode.ok&&Report.save.bytes===Report.download.bytes&&Report.job.receipt?.videoEndMs>622000&&Report.job.receipt?.audioEndMs>622000&&!Report.job.hls&&Object.values(Report.persistence).every(Boolean));
 if(process.argv.includes('--captions'))Report.passed&&=Report.captionsPassed;
}catch(e){Report.failure=String(e.message).slice(0,400);if(UI){Report.events=await UI.evaluate(()=>globalThis.ProbeEvents).catch(()=>null);Report.status=await UI.locator('[data-candidate-status]').textContent().catch(()=>null);await UI.screenshot({path:Path.join(Artifact,'failure.png'),fullPage:true}).catch(()=>{});}}
finally{await writeFile(Path.join(Artifact,'result.json'),JSON.stringify(Report,null,2));console.log(JSON.stringify({artifact:Artifact,...Report}));await Context.close();}
if(!Report.passed)process.exitCode=2;
