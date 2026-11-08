/** Actual registered native-host and Explorer API observation. No desktop automation or OS picker selection. */
import{mkdir,readFile,writeFile,copyFile,rm}from'node:fs/promises';
import{spawnSync}from'node:child_process';import Path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';
const Root=fileURLToPath(new URL('../../',import.meta.url)),Out=Path.join(Root,'artifacts/explorer-repair/chrome-'+Date.now()),Folder=Path.join(Out,'saved'),Name='검사, saved.mp4',Key=crypto.randomUUID(),Job=crypto.randomUUID();
await mkdir(Folder,{recursive:true});await copyFile(Path.join(Root,'website/sample/media/sample-film.mp4'),Path.join(Folder,Name));
const Bindings=Path.join(process.env.LOCALAPPDATA,'MDownloader/ExplorerBridge/folder-bindings.json');
const{chromium}=await import(pathToFileURL(Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Context=await chromium.launchPersistentContext(Path.join(Out,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:480,height:780},ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required']});
const Result={computerUse:false,actualChrome:true,fixture:'real saved file, registered native helper, prelinked owned fixture folder; no OS picker automation',confirmationPopup:false};let BindingKey;
async function ReadBindings(){try{return JSON.parse(await readFile(Bindings,'utf8'));}catch(e){if(e.code==='ENOENT')return{};throw e;}}
function ExplorerWindows(){const command=`$ErrorActionPreference='SilentlyContinue';$w=New-Object -ComObject Shell.Application;@($w.Windows()) | ForEach-Object {if($_.Document.Folder.Self.Path -eq '${Folder.replaceAll("'","''")}'){Write-Output $_.HWND}}`;const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true});return r.stdout.trim().split(/\s+/).filter(Boolean);}
const Before=new Set(ExplorerWindows());
try{
 const Browser=await Context.browser().newBrowserCDPSession();Result.browser=(await Browser.send('Browser.getVersion')).product;
 const{id}=await Browser.send('Extensions.loadUnpacked',{path:Path.join(Root,'extension')});Result.extensionId=id;
 const Page=await Context.newPage();await Page.goto('chrome-extension://'+id+'/sidepanel.html');
 Result.connected=await Page.evaluate(async()=>{const{ConnectExplorer}=await import('./lib/explorer-bridge.js');return await ConnectExplorer();});
 // Only this owned fixture's key is prelinked. The native host still validates filename, size and fingerprint.
 BindingKey='chrome-extension://'+id+'/|'+Key;const bindings=await ReadBindings();bindings[BindingKey]=Folder;await writeFile(Bindings,JSON.stringify(bindings));
 await Page.evaluate(()=>{const e=document.createElement('input');e.type='file';e.id='fixture';document.body.append(e);});await Page.locator('#fixture').setInputFiles(Path.join(Folder,Name));
 await Page.evaluate(async({Key,Job,Name})=>{const root=await navigator.storage.getDirectory(),folder=await root.getDirectoryHandle('saved',{create:true}),handle=await folder.getFileHandle(Name,{create:true}),writer=await handle.createWritable(),file=document.querySelector('#fixture').files[0];await file.stream().pipeTo(writer);
 const db=await new Promise((res,rej)=>{const o=indexedDB.open('mdownloader-download-folders',1);o.onupgradeneeded=()=>o.result.createObjectStore('directories');o.onsuccess=()=>res(o.result);o.onerror=()=>rej(o.error);});await new Promise((res,rej)=>{const tx=db.transaction('directories','readwrite');tx.objectStore('directories').put(folder,Key);tx.oncomplete=res;tx.onabort=()=>rej(tx.error);});db.close();
 await chrome.storage.local.set({language:'ko',['job:'+Job]:{requestId:Job,state:'complete',exists:true,pickedDownloadFolder:Key,filename:Name,youtube:true,youtubeSource:true,sourcePolicyVersion:1,bytesReceived:file.size,totalBytes:file.size,created:Date.now()}});
 },{Key,Job,Name});
 const Button=Page.locator('#complete .job [data-action="show"]');await Button.waitFor();
 await Button.click();await Page.waitForFunction(()=>!document.querySelector('#complete .job [data-action="show"]').disabled);
 const End=Date.now()+12000;let windows=[];while(Date.now()<End){windows=ExplorerWindows();if(windows.length)break;await new Promise(r=>setTimeout(r,150));}
 Result.explorerObserved=windows.length>0;Result.managerError=await Page.locator('#status').textContent();Result.noSubstitutePage=Context.pages().every(p=>!p.url().includes('saved-folder.html'));Result.noConfirmationDialog=await Page.locator('dialog[open]').count()===0;
 await Page.screenshot({path:Path.join(Out,'completed.png')});
 await Button.click({modifiers:['Shift']});const EndReplay=Date.now()+10000;let Replay;while(Date.now()<EndReplay){Replay=Context.pages().find(p=>p.url().includes('/saved-media.html'));if(Replay)break;await new Promise(r=>setTimeout(r,100));}if(!Replay)throw Error('shift-replay-missing');await Replay.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await Replay.evaluate(()=>document.querySelector('video').play());await Replay.waitForFunction(()=>document.querySelector('video')?.currentTime>0.3);Result.shiftReplay=await Replay.evaluate(()=>({width:document.querySelector('video').videoWidth,time:document.querySelector('video').currentTime}));
 Result.passed=Result.connected.connected&&Result.explorerObserved&&!Result.managerError&&Result.noSubstitutePage&&Result.noConfirmationDialog&&Result.shiftReplay.width===320;
 // Close only a new Explorer window displaying this owned test directory, never a pre-existing window.
 for(const hwnd of windows.filter(h=>!Before.has(h))){if(!/^\d+$/.test(hwnd))continue;spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$s=New-Object -ComObject Shell.Application;@($s.Windows())|ForEach-Object{if($_.HWND -eq ${hwnd} -and $_.Document.Folder.Self.Path -eq '${Folder.replaceAll("'","''")}'){$_.Quit()}}`],{windowsHide:true});}
}catch(e){Result.failure=e.message.slice(0,240);}finally{
 if(BindingKey){const bindings=await ReadBindings();if(bindings[BindingKey]===Folder){delete bindings[BindingKey];if(Object.keys(bindings).length)await writeFile(Bindings,JSON.stringify(bindings));else await rm(Bindings,{force:true});}}
 await writeFile(Path.join(Out,'result.json'),JSON.stringify(Result,null,2));console.log(JSON.stringify({artifact:Out,...Result}));await Context.close();
}if(!Result.passed)process.exitCode=2;
