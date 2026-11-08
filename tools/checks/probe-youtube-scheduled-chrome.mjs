/** Actual development Chrome UI acceptance; no Computer Use or external extractor. */
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {InspectMp4Subtitles} from '../lib/inspect-mp4-subtitles.mjs';
const Root=fileURLToPath(new URL('../../',import.meta.url));
const {chromium}=await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Artifact=Path.join(Root,'artifacts/youtube-scheduled/chrome-'+Date.now());await mkdir(Artifact,{recursive:true});
const Context=await chromium.launchPersistentContext(Path.join(Artifact,'profile'),{executablePath:process.env.MDOWNLOADER_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required']});
const ScheduledId=process.env.MDOWNLOADER_SCHEDULED_VIDEO_ID;if(!/^[A-Za-z0-9_-]{11}$/.test(ScheduledId))throw Error('invalid-id');
const Report={videoId:ScheduledId,flavor:'development',computerUse:false,externalExtractor:false,stages:[]};
Report.downloadAction='scheduled-register-with-permission-confirm';
Context.setDefaultTimeout(15000);
let UI;
async function Panel(Browser,Target)
{
 const {sessionId}=await Browser.send('Target.attachToTarget',{targetId:Target.targetId,flatten:false});let serial=0;
 async function Send(method,params={}){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{Browser.off('Target.receivedMessageFromTarget',listener);reject(Error('panel-command-timeout'));},90000);function listener(e){if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id!==id)return;clearTimeout(timer);Browser.off('Target.receivedMessageFromTarget',listener);if(m.error)reject(Error('panel-protocol-error'));else resolve(m.result);}Browser.on('Target.receivedMessageFromTarget',listener);void Browser.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);});}
 async function evaluate(fn,arg){const r=await Send('Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(arg)??'undefined'})`,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('panel-evaluation-error');return r.result.value;}
 function locator(selector){return{first(){return this;},async waitFor({timeout=15000}={}){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(s=>!!document.querySelector(s),selector))return;await new Promise(r=>setTimeout(r,100));}throw Error('panel-selector-timeout:'+selector);},async click({modifiers=[]}={}){const p=await evaluate(s=>{const e=document.querySelector(s);if(!e)throw Error('missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},selector);const params={...p,button:'left',clickCount:1,modifiers:modifiers.includes('Shift')?8:0};await Send('Input.dispatchMouseEvent',{type:'mousePressed',...params});await Send('Input.dispatchMouseEvent',{type:'mouseReleased',...params});},allTextContents(){return evaluate(s=>[...document.querySelectorAll(s)].map(e=>e.textContent),selector);},textContent(){return evaluate(s=>document.querySelector(s)?.textContent,selector);},selectOption(value){return evaluate(({s,value})=>{const e=document.querySelector(s);e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));},{s:selector,value});}};}
 return{send:Send,evaluate,locator,async screenshot({path}){const r=await Send('Page.captureScreenshot',{format:'png'});await writeFile(path,Buffer.from(r.data,'base64'));}};
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
 if(process.argv.includes('--captions')){
  await Options.locator('html[lang="ko"]').waitFor();const Toggle=Options.locator('#include-youtube-auto-captions:not([disabled])');await Toggle.waitFor({state:'visible'});
  const include=!process.argv.includes('--exclude-auto-captions');Report.autoCaptionOption={defaultChecked:await Toggle.isChecked(),included:include};
  if(include)await Toggle.check();else await Toggle.uncheck();
  await Options.waitForFunction(async expected=>{const value=(await chrome.storage.local.get('includeYoutubeAutoCaptions')).includeYoutubeAutoCaptions;return(value??true)===expected;},include);
  await Options.reload();await Options.locator('#include-youtube-auto-captions:not([disabled])').waitFor();Report.autoCaptionOption.persisted=(await Options.locator('#include-youtube-auto-captions').isChecked())===include;
  await Options.locator('#youtube-caption-settings').screenshot({path:Path.join(Artifact,'auto-caption-option.png')});
 }
 const Source=await Context.newPage();await Source.goto(`https://www.youtube.com/watch?v=${ScheduledId}`,{waitUntil:'domcontentloaded'});await Source.bringToFront();
 const sourceWindow=await Options.evaluate(async videoId=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url?.includes(videoId)).windowId;},ScheduledId);
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
 await UI.locator('dialog.download-options-dialog[open]').waitFor({timeout:30000});
 Report.qualities=await UI.locator('dialog.download-options-dialog select[name="html_resolution_bitrate"] option').allTextContents();
 const permission=await UI.evaluate(async()=>{const data=await chrome.storage.session.get(null);return Object.values(data).flatMap(v=>v?.candidates??[]).filter(c=>c.format==='YOUTUBE').map(c=>({url:c.url}));});
 if(permission.length!==1)throw Error('candidate-count');
 // Inspect optional request origin through the UI's authenticated provider route; no direct client or receiver invocation.
 const qualityData=await UI.evaluate(async()=>{const entries=Object.values(await chrome.storage.session.get(null)).find(v=>v?.scanId&&v.candidates?.some(c=>c.format==='YOUTUBE'));const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const r=await chrome.runtime.sendMessage({type:'youtubeQualities',tabId:tab.id,scanId:entries.scanId,candidateId:entries.candidates.find(c=>c.format==='YOUTUBE').id});if(!r.ok)throw Error('quality-query');return r.data;});
 const host=qualityData[0].serverPermission;
 if(host){if(!/^https:\/\/[^/]+\.googlevideo\.com\/\*$/.test(host))throw Error('unexpected-cdn');await Approve([host]);Report.liveCdnPermissionApproved=true;}
 const ReceiverTarget=(await Browser.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/hls-runner.html`);if(!ReceiverTarget)throw Error('offscreen-missing');
 const Receiver=await Panel(Browser,ReceiverTarget);await Receiver.send('Network.enable');await Receiver.send('Network.emulateNetworkConditions',{offline:false,latency:20,downloadThroughput:800000,uploadThroughput:-1});Report.receiverThrottledBytesPerSecond=800000;
 await UI.locator('dialog.download-options-dialog button[type="submit"]').click();
 const readJobs=()=>Options.evaluate(async()=>Object.entries(await chrome.storage.local.get(null)).filter(([k,v])=>k.startsWith('job:')&&v.youtube).map(([,v])=>v));
 async function until(read,predicate,label,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,200));}throw Error('timeout:'+label);}
 const job=await until(readJobs,js=>js.some(j=>j.waiting&&j.state==='active'),'queued-waiting').then(js=>js.find(j=>j.waiting));
 Report.waiting={state:job.state,bytes:job.bytesReceived,noSaveId:job.downloadId===undefined};
 Report.waitingControls=await UI.evaluate(()=>[...document.querySelectorAll('#active .job [data-action]')].map(b=>({action:b.dataset.action,disabled:b.disabled})));
 Report.waitingText=await UI.locator('#active').textContent();
 await UI.screenshot({path:Path.join(Artifact,'scheduled-waiting.png')});
 await writeFile(Path.join(Artifact,'ready.json'),JSON.stringify({videoId:Report.videoId,requestId:job.requestId,waiting:Report.waiting}));
 console.log(JSON.stringify({stage:'scheduled-waiting',videoId:Report.videoId,artifact:Artifact}));
 if(!process.argv.includes('--wait-live')){
  await UI.locator('#active .job [data-action="cancel"]').click();
  const stopped=await until(readJobs,js=>js.some(j=>j.requestId===job.requestId&&j.state==='canceled'),'wait-canceled').then(js=>js.find(j=>j.requestId===job.requestId));
  Report.canceledWithoutSave=stopped.bytesReceived===0&&stopped.downloadId===undefined;
  Report.passed=Report.waiting.bytes===0&&Report.waiting.noSaveId&&Report.canceledWithoutSave;
 }else{
  const receiving=await until(async()=>{const current=(await readJobs()).find(j=>j.requestId===job.requestId);if(current?.state==='failed')throw Error('scheduled-failure:'+current.error?.key);return current;},j=>j&&!j.waiting&&j.snapshotAvailable&&j.bytesReceived>100000,'started-receiving',15*60*1000);
  Report.receiving={bytes:receiving.bytesReceived,live:receiving.live,waiting:receiving.waiting};
  await UI.screenshot({path:Path.join(Artifact,'scheduled-receiving.png')});
  await writeFile(Path.join(Artifact,'receiving.json'),JSON.stringify(Report.receiving));
  await new Promise(r=>setTimeout(r,10000));
  await UI.locator('#active .job [data-action="finish"]:not([disabled])').click();
  const saved=await until(async()=>{const current=(await readJobs()).find(j=>j.requestId===job.requestId);if(current?.state==='failed')throw Error('save-failure:'+current.error?.key);if(current?.downloadId===undefined)return;const d=await Options.evaluate(async id=>(await chrome.downloads.search({id}))[0],current.downloadId);if(d?.state==='interrupted')throw Error('native-save-interrupted');return d?.state==='complete'?{job:current,item:d}:null;},Boolean,'saved');
  const output=Path.join(Artifact,'scheduled-output.mp4');await copyFile(saved.item.filename,output);const bytes=await readFile(output);
  await Options.evaluate(()=>{const i=document.createElement('input');i.id='verify-file';i.type='file';document.body.append(i);});await Options.locator('#verify-file').setInputFiles(output);
  Report.decode=await Options.evaluate(async()=>{const{Input,BlobSource,ALL_FORMATS,VideoSampleSink,AudioSampleSink}=await import('./vendor/mediabunny-1.65.2.mjs');const i=new Input({formats:ALL_FORMATS,source:new BlobSource(document.querySelector('#verify-file').files[0])});try{const v=await i.getPrimaryVideoTrack(),a=await i.getPrimaryAudioTrack();if(!v||!a)return{ok:false};const duration=await i.computeDuration(),checks=[];for(const time of[Math.min(1,duration/4),duration-0.3]){const vs=await new VideoSampleSink(v).getSample(time),as=await new AudioSampleSink(a).getSample(time);if(!vs||!as)return{ok:false,duration};const f=vs.toVideoFrame(),d=as.toAudioData(),samples=new Float32Array(d.numberOfFrames);d.copyTo(samples,{planeIndex:0,format:'f32-planar'});checks.push({time,width:f.displayWidth,height:f.displayHeight,audioFrames:d.numberOfFrames,rms:Math.sqrt(samples.reduce((n,x)=>n+x*x,0)/samples.length)});f.close();d.close();vs.close();as.close();}return{ok:duration>2&&checks.every(c=>c.audioFrames>0),duration,checks};}finally{i.dispose();}});
  Report.output={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),nativeBytes:saved.item.bytesReceived,receipt:saved.job.receipt};
  await UI.screenshot({path:Path.join(Artifact,'scheduled-saved.png')});
  Report.passed=Report.waiting.bytes===0&&Report.receiving.live&&!Report.receiving.waiting&&Report.decode.ok&&bytes.length===saved.item.bytesReceived;
 }
}catch(e){Report.failure=String(e.message).slice(0,400);if(UI)await UI.screenshot({path:Path.join(Artifact,'failure.png')}).catch(()=>{});}
finally{await writeFile(Path.join(Artifact,'result.json'),JSON.stringify(Report,null,2));console.log(JSON.stringify({artifact:Artifact,...Report}));await Context.close();}
if(!Report.passed)process.exitCode=2;
