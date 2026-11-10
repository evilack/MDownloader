/** Real Chrome, production filename helper, harmless CMD; no native registration changes. */
import {createRequire} from 'node:module';import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';import Path from 'node:path';import {spawn} from 'node:child_process';
const Pw=createRequire(import.meta.url)(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||'playwright');
const Root=Path.resolve('artifacts/single-click-setup-'+Date.now()),Ext=Path.join(Root,'extension'),Profile=Path.join(Root,'profile'),Downloads=Path.join(Root,'downloads');
await mkdir(Ext,{recursive:true});await mkdir(Path.join(Profile,'Default'),{recursive:true});await mkdir(Downloads,{recursive:true});await cp('extension/lib',Path.join(Ext,'lib'),{recursive:true});
const Marker=Path.join(Root,'executed.txt');await writeFile(Path.join(Profile,'Default/Preferences'),JSON.stringify({download:{default_directory:Downloads,prompt_for_download:process.env.MDOWNLOADER_PROMPT_FOR_DOWNLOAD==='1'}}));
await writeFile(Path.join(Ext,'manifest.json'),JSON.stringify({manifest_version:3,name:'MDownloader one-click setup probe',version:'1.0',permissions:['downloads','downloads.open']}));
await writeFile(Path.join(Ext,'probe.html'),'<!doctype html><html><meta charset="utf-8"><button id="install">Install</button><pre id="result"></pre><script type="module" src="probe.js"></script></html>');
await writeFile(Path.join(Ext,'probe.js'),`import {DownloadNamedFile} from './lib/browser-download.js';
document.querySelector('#install').addEventListener('click',async()=>{
 const R={clicks:1,startActivation:navigator.userActivation.isActive};
 try{
  const Text=${JSON.stringify('@echo off\r\n>"'+Marker+'" echo executed\r\nexit /b 0\r\n')};
  const Url=URL.createObjectURL(new Blob([Text],{type:'application/octet-stream'}));
  const Id=await DownloadNamedFile(Url,'MDownloader-OneClick-Probe.cmd',{saveAs:false});R.id=Id;
  for(let I=0;I<750;I++){const [D]=await chrome.downloads.search({id:Id});R.download={state:D.state,danger:D.danger,filename:D.filename};if(D.state==='complete')break;await new Promise(r=>setTimeout(r,20));}
  if(R.download.state!=='complete')throw Error('Installer download did not complete within 15 seconds');
  R.openActivation=navigator.userActivation.isActive;await chrome.downloads.open(Id);R.openSucceeded=true;
 }catch(E){R.error=E.message;}document.querySelector('#result').textContent=JSON.stringify(R);
});`);
const Proc=spawn(process.env.MDOWNLOADER_BROWSER_PATH,['--user-data-dir='+Profile,'--remote-debugging-port=0','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check','--start-minimized',...(process.env.MDOWNLOADER_HEADFUL==='1'?[]:['--headless=new']),'about:blank'],{stdio:'ignore',windowsHide:true});
let Browser;
try{
 let Port;for(let I=0;I<100;I++){try{Port=(await readFile(Path.join(Profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{}await new Promise(R=>setTimeout(R,100));}
 if(!Port)throw Error('Chrome debugging port unavailable');
 Browser=await Pw.chromium.connectOverCDP('http://127.0.0.1:'+Port,{noDefaults:true});const Context=Browser.contexts()[0],Cdp=await Browser.newBrowserCDPSession();
 const{id}=await Cdp.send('Extensions.loadUnpacked',{path:Ext});const Page=await Context.newPage();await Page.goto('chrome-extension://'+id+'/probe.html');await Page.locator('#install').click();await Page.waitForFunction(()=>document.querySelector('#result').textContent,{timeout:15000});
 const Result=JSON.parse(await Page.locator('#result').textContent());
 for(let I=0;I<30;I++){Result.markerExecuted=await readFile(Marker,'utf8').then(T=>T.includes('executed')).catch(()=>false);if(Result.markerExecuted)break;await new Promise(R=>setTimeout(R,100));}
 Result.browser=(await Cdp.send('Browser.getVersion')).product;Result.headful=process.env.MDOWNLOADER_HEADFUL==='1';await writeFile(Path.join(Root,'result.json'),JSON.stringify(Result,null,2));console.log(JSON.stringify({root:Root,...Result}));
}finally{if(Browser){const Cdp=await Browser.newBrowserCDPSession();await Cdp.send('Browser.close').catch(()=>{});}else Proc.kill();}
