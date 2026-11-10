/** Real extension → installed command-only engine → automatic outputs, in an isolated browser profile. */
import {mkdir,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import Http from 'node:http';
import Path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {CreatePreviewServer} from '../../website/serve.mjs';
const Root=fileURLToPath(new URL('../../',import.meta.url));
const Model=process.argv.find(arg=>arg.startsWith('--model='))?.slice(8)||'tiny';
const Case=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7);
assert.ok(['tiny','large-v3-turbo'].includes(Model));
const Output=Path.join(Root,'artifacts/caption-automatic-output-'+Date.now());
const Fixture=Path.join(Output,'fixture'),Downloads=Path.join(Output,'downloads');
await mkdir(Fixture,{recursive:true});await mkdir(Downloads,{recursive:true});
const Python=Path.join(process.env.LOCALAPPDATA,'MDownloader/Captions/venv/Scripts/python.exe');
const Converted=spawnSync(Python,['-c',
 'import imageio_ffmpeg,subprocess,sys; subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),"-v","error","-stream_loop","5","-i",sys.argv[1],"-t","32","-c:v","libx264","-preset","ultrafast","-g","20","-keyint_min","20","-sc_threshold","0","-c:a","aac","-b:a","64k","-hls_time","2","-hls_playlist_type","vod","-hls_segment_filename",sys.argv[2],sys.argv[3]],check=True)',
 Path.join(Root,'artifacts/caption-engine-smoke/video.mp4'),Path.join(Fixture,'segment-%03d.ts'),Path.join(Fixture,'stream.m3u8')],{encoding:'utf8',windowsHide:true});
assert.equal(Converted.status,0,Converted.stderr);
await writeFile(Path.join(Fixture,'index.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><title>Automatic speech caption verification</title><video controls src="stream.m3u8"></video></html>');
const Static=CreatePreviewServer({root:Fixture}).listeners('request')[0];
const Server=Http.createServer((Request,Response)=>{if(Request.url.includes('.ts'))setTimeout(()=>void Static(Request,Response),400);else void Static(Request,Response);});
await new Promise(resolve=>Server.listen(0,'127.0.0.1',resolve));
const Url='http://127.0.0.1:'+Server.address().port+'/';
const {chromium}=await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Context=await chromium.launchPersistentContext(Path.join(Output,'profile'),{executablePath:process.env.MDOWNLOADER_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const Evidence={output:Output,engine:'faster-whisper',model:Model,cases:[],nativeReinstalled:false,modelsDownloaded:false,isolatedProfile:true};
const Owned=[];
let Page;
let Trace=async()=>null;
try{
 const Browser=await Context.browser().newBrowserCDPSession();
 await Browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:Downloads,eventsEnabled:true});
 const {id}=await Browser.send('Extensions.loadUnpacked',{path:Path.join(Root,'extension')});Evidence.extensionId=id;
 const Settings=await Context.newPage();await Settings.goto('chrome://extensions');
 await Settings.evaluate(async({id,host})=>chrome.developerPrivate.addHostPermission(id,host),{id,host:'http://127.0.0.1/*'});
 const Source=await Context.newPage();await Source.goto(Url);
 Page=await Context.newPage();await Page.goto(`chrome-extension://${id}/sidepanel.html`);
 await Page.evaluate(async()=>chrome.permissions.request({origins:['http://127.0.0.1/*']}));
 await Source.bringToFront();
 await Page.evaluate(async()=>{const {EnsureRunner}=await import('./hls-jobs.js');await EnsureRunner();});
 const Target=(await Browser.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/hls-runner.html`);
 const Attached=await Browser.send('Target.attachToTarget',{targetId:Target.targetId,flatten:false});let Sequence=0;
 const Send=(method,params={})=>new Promise((resolve,reject)=>{const number=++Sequence;const onMessage=event=>{if(event.sessionId!==Attached.sessionId)return;const r=JSON.parse(event.message);if(r.id!==number)return;Browser.off('Target.receivedMessageFromTarget',onMessage);r.error?reject(Error(JSON.stringify(r.error))):resolve(r.result);};Browser.on('Target.receivedMessageFromTarget',onMessage);void Browser.send('Target.sendMessageToTarget',{sessionId:Attached.sessionId,message:JSON.stringify({id:number,method,params})}).catch(reject);});
 const Evaluate=async expression=>(await Send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value;
 await Evaluate(`(()=>{globalThis.__automaticCaptionTrace=[];const original=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async message=>{const r=await original(message);if(message.type==='captionStage')__automaticCaptionTrace.push({action:message.action,error:r?.ok?null:r?.error,...(message.action==='failure'?{code:message.code}:{}),...(message.action==='beginPreview'?{data:r?.data}:{} )});return r;};return true;})()`);
 Trace=()=>Evaluate('globalThis.__automaticCaptionTrace');
 const Request=(type,fields={})=>Page.evaluate(async({type,fields})=>{const r=await chrome.runtime.sendMessage({type,...fields});if(!r?.ok)throw Error(JSON.stringify(r?.error));return r.data;},{type,fields});
 async function Job(Id){return(await Request('jobs')).find(j=>j.requestId===Id);}
 async function Wait(Id,Accept,Timeout=150000){const End=Date.now()+Timeout;let Previous;for(;;){const j=await Job(Id);if(Accept(j))return j;if(j?.state==='failed')throw Error(JSON.stringify({case:Id,state:j.state,caption:j.captionStatus}));if(Date.now()>End)throw Error('Timed out: '+JSON.stringify({case:Id,state:j?.state,caption:j?.captionStatus}));const Phase=j?.captionStatus?.phase;if(Phase!==Previous){Previous=Phase;console.log(JSON.stringify({case:Id,state:j?.state,caption:Phase}));}await new Promise(r=>setTimeout(r,250));}}
 for(const spec of [{name:'embedded',container:true,formats:[]},{name:'sidecars',container:false,formats:['srt','vtt']},{name:'stop-and-save',container:true,formats:['srt','vtt'],action:'finish'},{name:'cancel',container:true,formats:['srt','vtt'],action:'cancel'}]){
  if(Case&&spec.name!==Case)continue;
  await Source.bringToFront();
  const tabId=await Page.evaluate(async()=>(await chrome.tabs.query({active:true,currentWindow:true}))[0]?.id);
  const Scan=await Request('scan',{tabId}),Candidate=Scan.candidates?.find(c=>c.format==='M3U8');
  if(!Candidate){const diagnostic=await Page.evaluate(async tabId=>{try{return {tabId,permissions:await chrome.permissions.getAll(),frame:await chrome.scripting.executeScript({target:{tabId},func:()=>({url:location.href,visibility:document.visibilityState})})};}catch(e){return {tabId,error:e.message};}},tabId);throw Error(JSON.stringify({Scan,diagnostic}));}
  const before=new Set(await readdir(Downloads)),Id=crypto.randomUUID();Owned.push(Id);
  const captions={enabled:true,engine:'faster-whisper',model:Model,language:'en',container:spec.container,formats:spec.formats,presetId:Model==='tiny'?'fast':'balanced',recognition:{cpuThreads:Model==='tiny'?2:8,beamSize:Model==='tiny'?1:5,bestOf:Model==='tiny'?1:5,device:'cpu',computeType:'int8',temperature:0,vadFilter:Model!=='tiny',conditionOnPreviousText:false}};
  await Request('enqueue',{tabId,scanId:Scan.scanId,candidateId:Candidate.id,requestId:Id,captionOverride:'custom',captionSettings:captions});
  if(spec.action){await Wait(Id,j=>j?.state==='active'&&j.finished>=2,30000);await Request('control',{requestId:Id,action:spec.action});}
  const Ended=await Wait(Id,j=>spec.action==='cancel'?j?.state==='canceled':j?.state==='complete'&&j.captionStatus?.phase==='complete');
  const names=(await readdir(Downloads)).filter(n=>!before.has(n)),files=[];
  for(const name of names)files.push({name,bytes:(await stat(Path.join(Downloads,name))).size});
  assert.equal(names.some(n=>n.includes('.live-')||n.endsWith('.crdownload')),false);
  if(spec.action==='cancel')assert.equal(names.length,0);else{
   assert.equal(names.filter(n=>n.endsWith('.mp4')).length,1);
   for(const format of ['srt','vtt'])assert.equal(names.filter(n=>n.endsWith('.'+format)).length,spec.formats.includes(format)?1:0);
   for(const name of names.filter(n=>/\.(srt|vtt)$/.test(n)))assert.match(await readFile(Path.join(Downloads,name),'utf8'),/00:00:/);
   assert.equal(Ended.captionStatus?.liveFile??null,null);
  }
  Evidence.cases.push({name:spec.name,requestId:Id,state:Ended.state,caption:Ended.captionStatus?.phase,mode:Ended.captionStatus?.mode,files});
  console.log(JSON.stringify(Evidence.cases.at(-1)));
 }
 await writeFile(Path.join(Output,'evidence.json'),JSON.stringify(Evidence,null,2));
 console.log('CAPTION_AUTOMATIC_OUTPUT_RESULT='+JSON.stringify(Evidence));
}catch(error){Evidence.error=error.message;Evidence.trace=await Trace().catch(()=>null);await writeFile(Path.join(Output,'evidence.json'),JSON.stringify(Evidence,null,2));console.log(JSON.stringify({trace:Evidence.trace?.filter(x=>x.error||x.code||x.action==='beginPreview')}));throw error;}
finally{
 if(Page&&!Page.isClosed())for(const requestId of Owned)await Page.evaluate(async requestId=>{const r=await chrome.runtime.sendMessage({type:'jobs'}),j=r.data?.find(j=>j.requestId===requestId);if(['active','starting','paused'].includes(j?.state))await chrome.runtime.sendMessage({type:'control',requestId,action:'cancel'});},requestId).catch(()=>{});
 await Context.close();await new Promise(resolve=>Server.close(resolve));
}
