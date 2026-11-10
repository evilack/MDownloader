import test from 'node:test';
import assert from 'node:assert/strict';
import { BindSettingsUI, ResolveSettingsSection, ProviderPresentation, FilenameExample } from '../extension/settings-ui.js';
import { BindDownloadLocation } from '../extension/options-download-location.js';

test('settings default to General while explicit deep links retain their category',()=>{
 for(const id of ['general','download','translation','permissions','diagnostics','about']) assert.equal(ResolveSettingsSection(id),id);
 assert.equal(ResolveSettingsSection('missing'),'general');
 assert.equal(ResolveSettingsSection(null),'general');
 assert.equal(ResolveSettingsSection(''),'general');
});
test('provider capabilities hide irrelevant models, effort and credentials fields',()=>{
 assert.deepEqual(ProviderPresentation('azure',[]),{azure:true,kakao:false,models:false,fixed:false,effort:false,refresh:false});
 assert.equal(ProviderPresentation('kakao',[]).kakao,true);
 assert.equal(ProviderPresentation('google',[]).fixed,true);
 assert.equal(ProviderPresentation('deepl',[]).refresh,false);
 assert.equal(ProviderPresentation('openai',[]).effort,false);
 assert.equal(ProviderPresentation('openai',['low']).effort,true);
});
test('filename example tracks both persisted filename preferences without presenting a real transfer',()=>{
 const Now=new Date(2031,0,2,3,4,5);
 assert.equal(FilenameExample(true,true,Now),'example_com_여름_여행_video_2031-01-02_03-04-05.mp4');
 assert.equal(FilenameExample(false,false,Now),'example_com_video.mp4');
 assert.equal(FilenameExample(false,true,Now),'example_com_video_2031-01-02_03-04-05.mp4');
 assert.equal(FilenameExample(true,false,Now),'example_com_여름_여행_video.mp4');
});
test('filename example uses the current local date when no clock is injected',t=>{
 const Now=new Date(2032,5,7,8,9,10);
 t.mock.timers.enable({apis:['Date'],now:Now.getTime()});
 assert.equal(FilenameExample(false,true),'example_com_video_2032-06-07_08-09-10.mp4');
});

test('verified helper removal resets the location controls without applying the form',async t=>{
 class Node extends EventTarget{
  hidden=false;checked=false;value='';textContent='';dataset={};parentElement={};classList={toggle(){}};
  setAttribute(){}removeAttribute(){}setCustomValidity(){}
 }
 const nodes=new Map(),q=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 const radios=['relative','picked'].map(value=>Object.assign(new Node(),{value}));
 const saved={downloadFolder:'previous-folder',pickedDownloadFolder:'12345678-1234-1234-1234-123456789abc'};
 globalThis.window=Object.assign(new EventTarget(),{showDirectoryPicker(){}});
 globalThis.document={body:{},getElementById:q,createTreeWalker:()=>({nextNode:()=>null}),
  querySelector:selector=>selector.startsWith('#')?q(selector.slice(1)):selector.endsWith(':checked')?radios.find(r=>r.checked):radios.find(r=>selector.includes('"'+r.value+'"')),
  querySelectorAll:selector=>selector==='[name="locationMode"]'?radios:[],
 };
 globalThis.NodeFilter={SHOW_TEXT:4};globalThis.MutationObserver=class{observe(){}};
 globalThis.location={href:'https://extension.test/options.html?section=download'};
 globalThis.chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({optional_host_permissions:[]})},permissions:{contains:async()=>false},storage:{local:{get:async()=>saved,set:async()=>assert.fail('presentation reset must not need a form save')}}};
 t.after(()=>{for(const name of ['window','document','NodeFilter','MutationObserver','location','chrome'])delete globalThis[name];});
 await BindDownloadLocation(saved.downloadFolder,'');await BindSettingsUI();
 assert.equal(radios[1].checked,true);assert.equal(q('picked-location').hidden,false);
 // The removal receipt has already saved these values before announcing completion.
 saved.downloadFolder='';saved.pickedDownloadFolder='';window.dispatchEvent(new Event('download-location-default'));
 assert.equal(radios[0].checked,true);assert.equal(radios[1].checked,false);
 assert.equal(q('relative-location').hidden,false);assert.equal(q('picked-location').hidden,true);
 assert.equal(q('download-folder').value,'');assert.equal(q('picked-download-folder').hidden,true);
 await BindSettingsUI();assert.equal(radios[0].checked,true,'reopening settings keeps the saved default');
});
