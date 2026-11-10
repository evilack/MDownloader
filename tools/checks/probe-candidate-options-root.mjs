/** Browser regression: production candidate list with Document and Element roots.
 * Uses synthetic media and transport only; never starts a download. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import Path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const Root=Path.resolve('extension'),Out=Path.resolve('artifacts/candidate-options-root');await mkdir(Out,{recursive:true});
const Fixture=String.raw`
const Event=()=>({addListener(){},removeListener(){}});
globalThis.requests=[];
globalThis.chrome={i18n:{getMessage:()=>''},tabs:{query:async()=>[{id:8,windowId:1,url:'https://media.test/'}],onUpdated:Event(),onActivated:Event()},downloads:{onChanged:Event(),onErased:Event()},
 storage:{onChanged:Event(),local:{get:async()=>({subtitleTranslation:{enabled:false,providers:{}},localCaptions:{enabled:false}})}},permissions:{request:async()=>true},
 runtime:{getPlatformInfo:async()=>({os:'win'}),sendMessage:async M=>{requests.push(M.type);return {ok:true,data:M.type==='scan'?{scanId:'fixture',candidates:[{id:0,mediaKey:'fixture',name:'Fixture.m3u8',format:'M3U8',supported:true,live:true}]}:M.type==='hlsQualities'?[{resolution:'1280x720'}]:[]};}}};
const {InitializeLocale,LocalizePage}=await import('./lib/i18n.js');await InitializeLocale('ko');LocalizePage();
const {CreateCandidateList}=await import('./candidate-list.js');
const Split=new URLSearchParams(location.search).has('split');
if(Split){document.body.classList.add('panel-resizable');const Section=document.createElement('section');Section.id='fixture-media';document.querySelector('main').append(Section);Section.append(document.querySelector('[data-candidate-status]'),document.querySelector('#candidates'));}
const View=CreateCandidateList({root:Split?document.querySelector('#fixture-media'):document,mediaPreview:{isHoveringWithin:()=>false,close(){},attach(){},resumeHover(){}},scrollRoot:document.querySelector('main')});View.setEnabled(true);
globalThis.fixtureReady=true;
`;
const Server=createServer(async(Q,R)=>{try{
 const U=new URL(Q.url,'http://fixture'),F=U.pathname.slice(1);
 if(F==='fixture.js'){R.setHeader('Content-Type','text/javascript');R.end(Fixture);return;}
 const File=Path.resolve(Root,F);if(!File.startsWith(Root+Path.sep))throw Error('path');
 let Data=await readFile(File);if(F==='popup.html')Data=Buffer.from(Data.toString().replace('src="popup.js"','src="fixture.js"'));
 R.setHeader('Content-Type',F.endsWith('.html')?'text/html':F.endsWith('.js')?'text/javascript':F.endsWith('.css')?'text/css':F.endsWith('.json')?'application/json':'image/png');R.end(Data);
}catch{R.writeHead(404).end();}});
await new Promise(R=>Server.listen(0,'127.0.0.1',R));
const {chromium}=await import(pathToFileURL(Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const Results=[];
try{
 for(const Split of [false,true]){
  const Page=await Browser.newPage({viewport:{width:500,height:600}});
  await Page.goto('http://127.0.0.1:'+Server.address().port+'/popup.html'+(Split?'?split':''));
  await Page.waitForFunction(()=>globalThis.fixtureReady&&document.querySelector('#candidates button'));
  await Page.locator('#candidates button[aria-label*="Shift"]').click({modifiers:['Shift']});
  const Editor=Page.locator(Split?'dialog[open] form':'.quality-slot form');
  await Editor.waitFor({state:'visible',timeout:3000});
  await Page.waitForFunction(()=>[...document.querySelectorAll('.download-options-actions button')].some(B=>B.type==='submit'&&!B.disabled));
  const Result=await Page.evaluate(()=>({status:document.querySelector('[data-candidate-status]').textContent,inline:document.querySelectorAll('.quality-slot').length,modal:!!document.querySelector('dialog[open]'),width:document.body.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth,downloads:requests.filter(T=>T==='enqueue').length}));
  assert.doesNotMatch(Result.status,/closest|not a function/);assert.equal(Result.inline,Split?0:1);assert.equal(Result.modal,Split);assert.equal(Result.downloads,0);assert.equal(Result.width,500);assert.equal(Result.overflow,false);
  await Editor.locator('footer button').first().click();await Editor.waitFor({state:'hidden'});assert.equal(await Page.locator('.quality-slot').count(),0);
  Results.push({root:Split?'Element inside split panel':'Document popup',...Result,cancelled:true});await Page.close();
 }
 await writeFile(Path.join(Out,'result.json'),JSON.stringify(Results,null,2));console.log(JSON.stringify({passed:true,results:Results}));
}finally{await Browser.close();await new Promise(R=>Server.close(R));}
