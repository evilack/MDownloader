/** Real public WebRTC → production extension → installed engine, isolated profile. */
import {mkdir,writeFile,readdir} from 'node:fs/promises';
import Path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const Root=Path.resolve('.'),Output=Path.join(Root,'artifacts/live-caption-seams-'+Date.now()),Downloads=Path.join(Output,'downloads');
await mkdir(Downloads,{recursive:true});
const Url=process.argv.find(a=>a.startsWith('--url='))?.slice(6)||'https://ko.stripchat.com/Dolls_primium1';
const Model=process.argv.find(a=>a.startsWith('--model='))?.slice(8)||'tiny';
const Seconds=Number(process.argv.find(a=>a.startsWith('--seconds='))?.slice(10)||75);
const {chromium}=await import(pathToFileURL(Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Context=await chromium.launchPersistentContext(Path.join(Output,'profile'),{headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const Evidence={output:Output,url:Url,model:Model,isolatedProfile:true,modelsDownloaded:false,helperInstalled:false};let Page,Id,Request;
try{
 const Browser=await Context.browser().newBrowserCDPSession();await Browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:Downloads});
 const {id}=await Browser.send('Extensions.loadUnpacked',{path:Path.join(Root,'extension')});Evidence.extensionId=id;
 const Settings=await Context.newPage();await Settings.goto('chrome://extensions');await Settings.evaluate(async id=>chrome.developerPrivate.addHostPermission(id,'https://*/*'),id);
 Page=await Context.newPage();await Page.goto('chrome-extension://'+id+'/popup.html');
 const Source=await Context.newPage();await Source.goto(Url,{waitUntil:'domcontentloaded',timeout:60000});await Source.bringToFront();
 try{await Source.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.srcObject instanceof MediaStream&&!v.paused&&v.readyState>=2&&v.videoWidth),{timeout:45000});}
 catch(E){Evidence.pageState=await Source.evaluate(()=>({video:[...document.querySelectorAll('video')].map(v=>({ready:v.readyState,paused:v.paused,stream:v.srcObject instanceof MediaStream})),buttons:[...document.querySelectorAll('button')].map(b=>b.innerText).filter(Boolean).slice(0,15)}));throw E;}
 Request=(type,fields={})=>Page.evaluate(async({type,fields})=>{const r=await chrome.runtime.sendMessage({type,...fields});if(!r?.ok)throw Error(JSON.stringify(r?.error));return r.data;},{type,fields});
 const tabId=await Page.evaluate(async url=>(await chrome.tabs.query({url}))[0]?.id,Url);assert.ok(tabId);
 const Scan=await Request('scan',{tabId}),Candidate=Scan.candidates?.find(c=>c.format==='WEBRTC'&&c.supported);assert.ok(Candidate,JSON.stringify({scanKeys:Object.keys(Scan),formats:Scan.candidates?.map(c=>c.format)}));
 Id=crypto.randomUUID();Evidence.requestId=Id;
 await Page.evaluate(id=>{globalThis.__seamEvents=[];chrome.storage.onChanged.addListener((changes,area)=>{const j=changes['job:'+id]?.newValue;if(area==='local'&&j){const v={at:Date.now(),state:j.state,caption:j.captionStatus},old=__seamEvents.at(-1);if(!old||old.state!==v.state||old.caption?.phase!==v.caption?.phase||old.caption?.committedSamples!==v.caption?.committedSamples||old.caption?.error!==v.caption?.error)__seamEvents.push(v);}});},Id);
 await Request('enqueue',{tabId,scanId:Scan.scanId,candidateId:Candidate.id,requestId:Id,captionOverride:'custom',captionSettings:{enabled:true,engine:'faster-whisper',model:Model,language:'auto',container:true,formats:[],presetId:'balanced',recognition:{cpuThreads:8,beamSize:5,bestOf:5,temperature:0,conditionOnPreviousText:false,device:'cpu',computeType:'int8',vadFilter:true}}});
 const Job=async()=>(await Request('jobs')).find(j=>j.requestId===Id);let Previous,Failure,Finish=false;const End=Date.now()+Seconds*1000,Deadline=End+240000;
 for(;;){
  const j=await Job(),Phase=j?.captionStatus?.phase;if(Phase!==Previous){Previous=Phase;console.log(JSON.stringify({output:Output,state:j?.state,phase:Phase,committed:j?.captionStatus?.committedSamples,error:j?.captionStatus?.error}));}
  if(!Finish&&(Date.now()>=End||Phase==='failed')){Finish=true;Failure=Phase==='failed';await Request('control',{requestId:Id,action:'finish'});}
  if(j?.state==='complete'){Evidence.job={state:j.state,caption:j.captionStatus,downloadId:j.downloadId,filename:j.filename};break;}
  if(j?.state==='failed'||Date.now()>Deadline)throw Error(JSON.stringify({state:j?.state,caption:j?.captionStatus}));
  await new Promise(r=>setTimeout(r,1000));
 }
 Evidence.events=await Page.evaluate(()=>globalThis.__seamEvents);Evidence.files=await readdir(Downloads);
 assert.equal(Failure,false,'Recognition failed while receiving');assert.equal(Evidence.job.caption.mode,'windowed');assert.equal(Evidence.job.caption.fallbackReason,undefined);
 Evidence.passed=true;
}catch(E){Evidence.passed=false;Evidence.error=E.message;console.log(JSON.stringify({output:Output,error:E.message}));process.exitCode=1;}
finally{
 if(Page)Evidence.events=await Page.evaluate(()=>globalThis.__seamEvents||[]).catch(()=>[]);
 await writeFile(Path.join(Output,'evidence.json'),JSON.stringify(Evidence,null,2));
 if(Id&&Request){const jobs=await Request('jobs').catch(()=>[]),j=jobs.find(j=>j.requestId===Id);if(j&&['active','starting','paused'].includes(j.state))await Request('control',{requestId:Id,action:'cancel'}).catch(()=>{});}
 await Context.close();console.log(JSON.stringify({output:Output,passed:Evidence.passed}));
}
