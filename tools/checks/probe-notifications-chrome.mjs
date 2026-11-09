/** Actual normal Chrome contexts/native downloads/notification registration; job transitions are fixtures. */
import {mkdir,readFile,writeFile,cp,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import Path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const Root=fileURLToPath(new URL('../../',import.meta.url)),Out=Path.join(Root,'artifacts/notifications/chrome-'+Date.now()),Profile=Path.join(Out,'profile'),Extension=Path.join(Out,'extension');
await mkdir(Profile,{recursive:true});await mkdir(Path.join(Out,'downloads'),{recursive:true});await cp(Path.join(Root,'artifacts/distributions/development/extension'),Extension,{recursive:true,filter:S=>!S.endsWith(Path.join('lib','kakao-default.js'))});
try{await stat(Path.join(Root,'artifacts/distributions/development/extension/lib/kakao-default.js'));await writeFile(Path.join(Extension,'lib/kakao-default.js'),"export const DefaultKakaoKey='';\n");}catch{}
const Media=await readFile(process.env.MDOWNLOADER_NOTIFICATION_MEDIA),Manifest=JSON.parse(await readFile(Path.join(Extension,'manifest.json'),'utf8'));
Manifest.permissions.push('notifications');Manifest.optional_permissions=Manifest.optional_permissions.filter(P=>P!=='notifications');Manifest.host_permissions.push('http://127.0.0.1/*');await writeFile(Path.join(Extension,'manifest.json'),JSON.stringify(Manifest));
const Server=createServer((Req,Res)=>{if(Req.url.split('?')[0].endsWith('.mp4')){Res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':Media.length});Res.end(Media);}else{Res.writeHead(200,{'Content-Type':'text/html'});Res.end('<!doctype html><title>Notification fixture</title><video controls src="/source.mp4"></video>');}});
await new Promise(R=>Server.listen(0,'127.0.0.1',R));const Base='http://127.0.0.1:'+Server.address().port;
const Command='"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=0 --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check --user-data-dir="'+Profile+'"';
const Code=`$s=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0};$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${Command.replaceAll("'","''")}';ProcessStartupInformation=$s};if($r.ReturnValue -ne 0){throw 'desktop-chrome-start-failed'}`;
const Started=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(Code,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});if(Started.status)throw Error(Started.stderr);
let Port;for(let I=0;I<100;I++){try{Port=(await readFile(Profile+'/DevToolsActivePort','utf8')).split('\n')[0];break;}catch{await new Promise(R=>setTimeout(R,100));}}if(!Port)throw Error('debug-port-missing');
const {chromium}=await import(pathToFileURL(Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs'))),Browser=await chromium.connectOverCDP('http://127.0.0.1:'+Port),Context=Browser.contexts()[0],CDP=await Browser.newBrowserCDPSession();
const Report={computerUse:false,headless:false,flavor:'development',fixture:'actual contexts/options/native file download/notification API; fixture job metadata and scheduled transitions; declared notification permission pregranted and localhost host added only in test manifest',osBannerObserved:false,audibleOutputObserved:false,cases:[]};
const Sleep=Ms=>new Promise(R=>setTimeout(R,Ms));
async function until(Read,Test,Label,Timeout=15000){const End=Date.now()+Timeout;while(Date.now()<End){const V=await Read();if(Test(V))return V;await Sleep(100);}throw Error('timeout:'+Label);}
async function surface(Target){
 const {sessionId}=await CDP.send('Target.attachToTarget',{targetId:Target.targetId,flatten:false});let Serial=0;
 async function send(method,params={}){const id=++Serial;return new Promise((Resolve,Reject)=>{const Timer=setTimeout(()=>{CDP.off('Target.receivedMessageFromTarget',Listener);Reject(Error('surface-timeout'));},15000);function Listener(E){if(E.sessionId!==sessionId)return;const M=JSON.parse(E.message);if(M.id!==id)return;clearTimeout(Timer);CDP.off('Target.receivedMessageFromTarget',Listener);M.error?Reject(Error(M.error.message)):Resolve(M.result);}CDP.on('Target.receivedMessageFromTarget',Listener);void CDP.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(Reject);});}
 async function evaluate(Fn,Arg){const R=await send('Runtime.evaluate',{expression:`(${Fn.toString()})(${JSON.stringify(Arg)??'undefined'})`,awaitPromise:true,returnByValue:true});if(R.exceptionDetails)throw Error('surface-eval:'+R.exceptionDetails.text);return R.result.value;}
 return{evaluate,async screenshot(Name){const R=await send('Page.captureScreenshot',{format:'png'});await writeFile(Out+'/'+Name,Buffer.from(R.data,'base64'));}};
}
let Options,Id;
try{
 Report.browser=(await CDP.send('Browser.getVersion')).product;await CDP.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:Path.join(Out,'downloads')});
 ({id:Id}=await CDP.send('Extensions.loadUnpacked',{path:Extension}));Options=await Context.newPage();await Options.setViewportSize({width:560,height:900});await Options.goto('chrome-extension://'+Id+'/options.html?section=general');
 await Options.evaluate(()=>chrome.storage.local.set({language:'ko'}));await Options.locator('html[lang="ko"]').waitFor();
 await Options.locator('#notify-download-complete:not([disabled])').check();await Options.locator('#notify-scheduled-start:not([disabled])').check();
 await until(()=>Options.evaluate(()=>chrome.storage.local.get(['notifyDownloadComplete','notifyScheduledStart'])),V=>V.notifyDownloadComplete&&V.notifyScheduledStart,'options-enabled');
 await Options.reload();await Options.locator('#notify-download-complete:not([disabled])').waitFor();Report.optionsPersisted=await Options.locator('#notify-download-complete').isChecked()&&await Options.locator('#notify-scheduled-start').isChecked();await Options.locator('[aria-labelledby="notifications-heading"]').screenshot({path:Out+'/options.png'});
 const contexts=()=>Options.evaluate(()=>chrome.runtime.getContexts({contextTypes:['POPUP','SIDE_PANEL']}));
 const all=()=>Options.evaluate(()=>chrome.notifications.getAll());
 async function expectNotice(RequestId,Event,Expected,Label){const Key='mdownloader:'+Event+':'+RequestId;if(Expected)await until(all,V=>Object.hasOwn(V,Key),Label);else{await Sleep(1200);if(Object.hasOwn(await all(),Key))throw Error('unexpected-notification:'+Label);}Report.cases.push({label:Label,expected:Expected,passed:true});}
 let Serial=0;
 async function nativeJob(MediaKey){const RequestId=crypto.randomUUID(),Created=Date.now()+(++Serial);const DownloadId=await Options.evaluate(async({url,id,created,mediaKey})=>{const downloadId=await chrome.downloads.download({url,filename:id+'.mp4'});await chrome.storage.local.set({['job:'+id]:{requestId:id,created,filename:id+'.mp4',state:'started',downloadId,mediaKey}});return downloadId;},{url:Base+'/download-'+Serial+'.mp4',id:RequestId,created:Created,mediaKey:MediaKey});await until(()=>Options.evaluate(async id=>(await chrome.downloads.search({id}))[0],DownloadId),D=>D?.state==='complete','native-complete');return RequestId;}
 const First=await nativeJob('unrepresented');await expectNotice(First,'complete',true,'both-closed');
 const Source=await Context.newPage();await Source.goto(Base+'/shown');await Source.bringToFront();
 const WindowId=await Options.evaluate(async url=>(await chrome.tabs.query({})).find(T=>T.url===url).windowId,Source.url());
 await Options.evaluate(windowId=>chrome.action.openPopup({windowId}),WindowId);
 await until(contexts,C=>C.some(V=>V.contextType==='POPUP'),'actual-popup-context');
 const PopupTarget=await until(async()=>(await CDP.send('Target.getTargets')).targetInfos,T=>T.some(V=>V.url==='chrome-extension://'+Id+'/popup.html'),'popup-target').then(T=>T.find(V=>V.url==='chrome-extension://'+Id+'/popup.html'));
 const Popup=await surface(PopupTarget);
 const MediaKey=await until(()=>Popup.evaluate(async()=>Object.values(await chrome.storage.session.get(null)).flatMap(V=>V?.candidates??[]).find(C=>C.format==='MP4')?.mediaKey),Boolean,'popup-candidate');
 const Other=await nativeJob('other-item');await expectNotice(Other,'complete',true,'popup-open-other-item');
 const Matching=crypto.randomUUID();await Options.evaluate(({id,mediaKey})=>chrome.storage.local.set({['job:'+id]:{requestId:id,created:Date.now()+100,filename:'matched.mp4',mediaKey,state:'paused',pickedDownloadFolder:'fixture-folder',bytesReceived:0}}),{id:Matching,mediaKey:MediaKey});
 await until(()=>Popup.evaluate(()=>!!document.querySelector('.candidate [data-state="paused"]')),Boolean,'popup-represented-request');
 await Options.evaluate(async id=>{const k='job:'+id,j=(await chrome.storage.local.get(k))[k];await chrome.storage.local.set({[k]:{...j,state:'complete',bytesReceived:100}});},Matching);
 await expectNotice(Matching,'complete',false,'popup-open-matching-item');await Popup.screenshot('popup-matched.png');
 await Source.bringToFront();await until(contexts,C=>!C.some(V=>V.contextType==='POPUP'),'popup-closed');
 await Options.evaluate(windowId=>{const B=document.createElement('button');B.id='open-native-panel';B.textContent='Open panel';B.onclick=()=>chrome.sidePanel.open({windowId});document.body.append(B);},WindowId);await Options.locator('#open-native-panel').click();
 await until(contexts,C=>C.some(V=>V.contextType==='SIDE_PANEL'),'actual-panel-context');
 const WithPanel=await nativeJob('panel-visible');await expectNotice(WithPanel,'complete',false,'side-panel-open');
 const Scheduled=crypto.randomUUID();await Options.evaluate(id=>chrome.storage.local.set({['job:'+id]:{requestId:id,filename:'scheduled-fixture.mp4',state:'active',youtube:true,scheduled:true,waiting:true,bytesReceived:0,created:Date.now()}}),Scheduled);await expectNotice(Scheduled,'start',false,'scheduled-waiting');
 await Options.evaluate(async id=>{const k='job:'+id,j=(await chrome.storage.local.get(k))[k];await chrome.storage.local.set({[k]:{...j,waiting:false}});},Scheduled);await expectNotice(Scheduled,'start',false,'scheduled-zero-bytes');
 await Options.evaluate(async id=>{const k='job:'+id,j=(await chrome.storage.local.get(k))[k];await chrome.storage.local.set({[k]:{...j,bytesReceived:1000}});},Scheduled);await expectNotice(Scheduled,'start',true,'scheduled-positive-bytes-with-panel');
 const Snapshot=crypto.randomUUID();await Options.evaluate(({id,parent})=>chrome.storage.local.set({['job:'+id]:{requestId:id,filename:'snapshot-fixture.mp4',state:'active',youtube:true,scheduled:true,snapshot:true,snapshotParent:parent,waiting:false,bytesReceived:1000,created:Date.now()}}),{id:Snapshot,parent:Scheduled});await expectNotice(Snapshot,'start',false,'snapshot-not-scheduled-start');
 await Options.evaluate(windowId=>chrome.sidePanel.close({windowId}),WindowId);await until(contexts,C=>!C.some(V=>V.contextType==='SIDE_PANEL'),'panel-closed');
 await Options.locator('#notify-download-complete').uncheck();await until(()=>Options.evaluate(()=>chrome.storage.local.get('notifyDownloadComplete')),V=>V.notifyDownloadComplete===false,'complete-disabled');const Disabled=await nativeJob('disabled');await expectNotice(Disabled,'complete',false,'complete-option-off');
 Report.registeredNotificationIds=Object.keys(await all());Report.realNativeDownloadCount=4;Report.passed=Report.optionsPersisted&&Report.cases.length===9&&Report.cases.every(C=>C.passed);
}catch(E){Report.failure=E.message.slice(0,350);if(Options){Report.popupState=await Options.evaluate(async()=>({views:(await chrome.storage.session.get('downloadNotificationViews')).downloadNotificationViews,sender:(await chrome.storage.session.get('notificationProbeSender')).notificationProbeSender,candidates:Object.values(await chrome.storage.session.get(null)).flatMap(V=>V?.candidates??[]).map(C=>({mediaKey:C.mediaKey,format:C.format})),jobs:Object.entries(await chrome.storage.local.get(null)).filter(([K])=>K.startsWith('job:')).map(([,J])=>({requestId:J.requestId,mediaKey:J.mediaKey,state:J.state}))})).catch(()=>({}));const target=(await CDP.send('Target.getTargets')).targetInfos.find(T=>T.url==='chrome-extension://'+Id+'/popup.html');if(target){const p=await surface(target);Report.popupText=await p.evaluate(()=>document.body.innerText).catch(()=>'');await p.screenshot('popup-failure.png').catch(()=>{});}Report.downloads=await Options.evaluate(async()=>(await chrome.downloads.search({})).map(D=>({id:D.id,state:D.state,error:D.error,bytes:D.bytesReceived,total:D.totalBytes,exists:D.exists,filename:D.filename}))).catch(()=>[]);Report.contexts=await Options.evaluate(()=>chrome.runtime.getContexts({})).catch(()=>[]);await Options.screenshot({path:Out+'/failure.png'}).catch(()=>{});}}
finally{await writeFile(Out+'/result.json',JSON.stringify(Report,null,2));console.log(JSON.stringify({artifact:Out,...Report}));if(Options)await Options.evaluate(async()=>{for(const Id of Object.keys(await chrome.notifications.getAll()))if(Id.startsWith('mdownloader:'))await chrome.notifications.clear(Id);}).catch(()=>{});await CDP.send('Browser.close').catch(()=>{});await Browser.close().catch(()=>{});await new Promise(R=>Server.close(R));}
if(!Report.passed)process.exitCode=2;
