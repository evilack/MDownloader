import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
import{BeforePickDownloadFolder}from'../extension/options-explorer-setup.js';import{InitializeLocale}from'../extension/lib/i18n.js';
async function setup(t,open){
 const nodes=[],shown=[];let downloads=0;
 class Node{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.events={};nodes.push(this);}append(...v){this.children.push(...v);}setAttribute(){}addEventListener(k,f){this.events[k]=f;}showModal(){this.open=true;}close(v=''){this.open=false;this.returnValue=v;this.events.close?.();}remove(){} }
 globalThis.document={createElement:tag=>new Node(tag),body:new Node('body')};globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.chrome={runtime:{id:'a'.repeat(32),getPlatformInfo:async()=>({os:'win'}),getURL:p=>'https://extension.test/'+p,connectNative(){throw Error('not installed');}},permissions:{contains:async()=>false,request:async()=>true},downloads:{onDeterminingFilename:{addListener(){},removeListener(){}},download:async()=>{downloads++;return 123;},search:async()=>[{id:123,state:'complete'}],open,show:async id=>shown.push(id)}};
 t.after(()=>{for(const k of['chrome','document','window'])delete globalThis[k];});
 const files={};for(const n of['host.ps1','dialog.ps1','install.ps1'])files[n]={base64:'eA=='};
 t.mock.method(globalThis,'fetch',async url=>new Response(String(url).endsWith('/data/explorer-installer.json')?JSON.stringify({files}):await readFile(url)));
 await InitializeLocale('en');const gate=BeforePickDownloadFolder();await new Promise(setImmediate);
 return{nodes,shown,gate,get dialog(){return nodes.find(n=>n.tag==='dialog');},get primary(){return nodes.filter(n=>n.tag==='button')[1];},get cancel(){return nodes.filter(n=>n.tag==='button')[0];},get downloads(){return downloads;}};
}
test('a rejected installer launch exposes file reveal instead of a repeat-execution loop',async t=>{
 const s=await setup(t,async()=>{throw Error('blocked');});await s.primary.events.click();assert.equal(s.primary.textContent,'Run installer');
 await s.primary.events.click();assert.equal(s.primary.textContent,'Show installer');assert.equal(s.primary.disabled,false);
 await s.primary.events.click();assert.deepEqual(s.shown,[123]);assert.equal(s.downloads,1);s.cancel.events.click();assert.equal(await s.gate,false);
});
test('an execution confirmation in progress cannot submit another run and cancel still closes the gate',async t=>{
 let finish;const s=await setup(t,()=>new Promise(r=>{finish=r;}));await s.primary.events.click();const opening=s.primary.events.click();
 assert.equal(s.primary.disabled,true);assert.equal(s.primary.textContent,'Please wait…');assert.equal(s.downloads,1);
 s.cancel.events.click();assert.equal(await s.gate,false);finish();await opening;
});
