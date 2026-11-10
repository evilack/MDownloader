import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{BeforePickDownloadFolder}from'../extension/options-explorer-setup.js';import{InitializeLocale}from'../extension/lib/i18n.js';
async function setup(t,open,state='complete'){
 const nodes=[],shown=[],tabs=[],requests=[];let downloads=0,connected=false;
 class Node{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.events={};nodes.push(this);}append(...v){this.children.push(...v);}setAttribute(){}addEventListener(k,f){this.events[k]=f;}showModal(){this.open=true;}close(v=''){this.open=false;this.returnValue=v;this.events.close?.();}remove(){} }
 globalThis.document={createElement:tag=>new Node(tag),body:new Node('body')};globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.chrome={runtime:{id:'a'.repeat(32),getPlatformInfo:async()=>({os:'win'}),getURL:p=>'https://extension.test/'+p,connectNative(){if(!connected)throw Error('not installed');let reply;return{onMessage:{addListener:f=>reply=f},onDisconnect:{addListener(){}},postMessage(){queueMicrotask(()=>reply({ok:true,protocol:1}));},disconnect(){}};}},permissions:{contains:async()=>false,request:async()=>true},tabs:{create:async tab=>tabs.push(tab)},downloads:{onDeterminingFilename:{addListener(){},removeListener(){}},download:async options=>{requests.push(options);downloads++;return 123;},search:async()=>[{id:123,state,error:state==='interrupted'?'FILE_BLOCKED':undefined}],open,show:async id=>shown.push(id)}};
 t.after(()=>{for(const k of['chrome','document','window'])delete globalThis[k];});
 const files={};for(const n of['host.ps1','dialog.ps1','install.ps1'])files[n]={base64:'eA=='};
 t.mock.method(globalThis,'fetch',async url=>new Response(String(url).endsWith('/data/explorer-installer.json')?JSON.stringify({files}):await readFile(url)));
 await InitializeLocale('en');const gate=BeforePickDownloadFolder();await new Promise(setImmediate);
 return{nodes,shown,tabs,requests,gate,connect(){connected=true;},get dialog(){return nodes.find(n=>n.tag==='dialog');},get primary(){return nodes.find(n=>n.tag==='button'&&n.className==='primary');},get cancel(){return nodes.find(n=>n.tag==='button'&&n.textContent==='Cancel');},get downloadList(){return nodes.find(n=>n.tag==='button'&&n.textContent==='Open downloads');},get downloads(){return downloads;}};
}
test('a rejected installer launch exposes file reveal instead of a repeat-execution loop',async t=>{
 const s=await setup(t,async()=>{throw Error('blocked');});await s.primary.events.click();assert.equal(s.primary.textContent,'Check connection');assert.equal(s.primary.disabled,false);
 const Reveal=s.nodes.find(n=>n.tag==='button'&&n.textContent==='Show installer');await Reveal.events.click();assert.deepEqual(s.shown,[123]);assert.equal(s.downloads,1);s.cancel.events.click();assert.equal(await s.gate,false);
});
test('an execution confirmation in progress cannot submit another run and cancel still closes the gate',async t=>{
 let finish;const s=await setup(t,()=>new Promise(r=>{finish=r;}));const opening=s.primary.events.click();await new Promise(setImmediate);
 assert.equal(s.primary.disabled,true);assert.equal(s.primary.textContent,'Please wait…');assert.equal(s.downloads,1);
 s.cancel.events.click();assert.equal(await s.gate,false);finish();await opening;
});

test('a blocked installer keeps manual download guidance and the downloads page available',async t=>{
 const s=await setup(t,()=>assert.fail('a blocked installer must not run'),'interrupted');
 await s.primary.events.click();assert.equal(s.primary.disabled,false);assert.notEqual(s.primary.textContent,'Run installer');
 await s.downloadList.events.click();assert.deepEqual(s.tabs,[{url:'chrome://downloads/'}]);assert.equal(s.downloads,1);
 s.cancel.events.click();assert.equal(await s.gate,false);
});

test('a single install click requests execution and automatically accepts only after native connection',async t=>{
 let Opens=0;const s=await setup(t,async()=>{Opens++;s.connect();});await s.primary.events.click();
 assert.equal(Opens,1);assert.equal(s.downloads,1);assert.equal(s.requests[0].saveAs,false);assert.equal(await s.gate,true);assert.equal(s.dialog.open,false);
 assert.ok(!s.nodes.some(n=>n.tag==='button'&&['Run installer','Continue'].includes(n.textContent)));
});
