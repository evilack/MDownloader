import test from 'node:test';
import assert from 'node:assert/strict';
import { BindTranslationSettings } from '../extension/options-translation.js';
function Harness(t, data){
 class Node {constructor(){this.events={};this.options=[];this.value='';this.checked=false;this.parentElement={};this.dataset={};this.attributes={};this.classList={toggle(){},remove(){},add(){}};} addEventListener(name,fn){this.events[name]=fn;} replaceChildren(...items){this.options=items;}append(...items){this.options.push(...items);}add(item){this.options.push(item);}closest(selector){assert.equal(selector,'.target-field');return q('target-field');}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}setCustomValidity(v){this.validationMessage=v;}reportValidity(){return !this.validationMessage;}dispatchEvent(){} }
 const nodes=new Map(),q=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};let stored=structuredClone(data), writes=0;
 globalThis.document={querySelector:s=>q(s.slice(1)),createElement:()=>new Node()};globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
 globalThis.chrome={permissions:{request:async()=>true},storage:{local:{get:async()=>({subtitleTranslation:structuredClone(stored)}),setAccessLevel:async()=>{},set:async v=>{stored=structuredClone(v.subtitleTranslation);writes++;}}},runtime:{connectNative(){throw Error('missing helper');}}};
 t.after(()=>{delete globalThis.document;delete globalThis.Option;delete globalThis.chrome;});return {q,stored:()=>stored,writes:()=>writes};
}
const Data=()=>({enabled:false,provider:'openai',targetLanguage:'ko',kakaoDefaultInitialized:true,providers:{openai:{key:'test-only',model:'one',effort:'unsupported',models:[{id:'one',efforts:['low','high']}]},azure:{key:'test-azure',region:'westus'},kakao:{key:'test-kakao'}}});
test('translation provider fields and reasoning reflect only the selected provider and model',async t=>{
 const h=Harness(t,Data());await BindTranslationSettings();assert.equal(h.q('effort-field').hidden,false);assert.deepEqual(h.q('translation-effort').options.map(x=>x.value),['','low','high']);
 h.q('translation-provider').value='azure';h.q('translation-provider').events.change();assert.equal(h.q('azure-fields').hidden,false);assert.equal(h.q('model-card').hidden,true);assert.equal(h.q('kakao-import').hidden,true);
 h.q('translation-provider').value='kakao';h.q('translation-provider').events.change();assert.equal(h.q('kakao-import').hidden,false);assert.equal(h.q('azure-fields').hidden,true);
 h.q('translation-provider').value='google';h.q('translation-provider').events.change();assert.equal(h.q('model-card').hidden,true);assert.equal(h.q('model-field').hidden,true);assert.equal(h.q('effort-field').hidden,true);
 for(const provider of ['deepl','gemini','deepseek','openai']){h.q('translation-provider').value=provider;h.q('translation-provider').events.change();assert.equal(h.q('model-card').hidden,false,provider);}
});
test('missing native helper reports an error and recovers the capture button',async t=>{
 const h=Harness(t,Data());await BindTranslationSettings();h.q('translation-provider').value='kakao';h.q('translation-provider').events.change();await h.q('translation-capture').events.click();assert.equal(h.q('translation-capture').disabled,false);assert.equal(h.q('helper-instructions').hidden,false);assert.equal(h.q('capture-status').dataset.error,'true');assert.equal(h.writes(),0);
});
test('reset reads saved settings and removes unsaved provider drafts',async t=>{
 const h=Harness(t,Data());await BindTranslationSettings();h.q('translation-key').value='unsaved';h.q('translation-provider').value='azure';h.q('translation-provider').events.change();await h.q('translation-form').events['settings-reset']();assert.equal(h.q('translation-provider').value,'openai');assert.equal(h.q('translation-key').value,'test-only');assert.equal(h.writes(),0);
});
test('enabled translation rejects missing credentials and emits failed save state',async t=>{
 const h=Harness(t,Data());await BindTranslationSettings();h.q('translation-enabled').checked=true;h.q('translation-key').value='';await h.q('translation-form').events.submit({preventDefault(){}});assert.equal(h.writes(),0);assert.equal(h.q('translation-status').dataset.error,'true');
});

test('deleting a provider credential preserves unrelated unsaved drafts and the Kakao seed marker',async t=>{
 const h=Harness(t,Data());await BindTranslationSettings();h.q('translation-key').value='unsaved-openai';h.q('translation-provider').value='kakao';h.q('translation-provider').events.change();await h.q('translation-delete').events.click();assert.equal(h.stored().providers.kakao.key,'');assert.equal(h.stored().providers.openai.key,'test-only');assert.equal(h.stored().kakaoDefaultInitialized,true);h.q('translation-provider').value='openai';h.q('translation-provider').events.change();assert.equal(h.q('translation-key').value,'unsaved-openai');
});
test('failed translation storage writes keep the form usable and report failure',async t=>{
 const h=Harness(t,Data());await BindTranslationSettings();chrome.storage.local.set=async()=>{throw Error('storage unavailable');};await h.q('translation-form').events.submit({preventDefault(){}});assert.equal(h.q('translation-status').dataset.error,'true');assert.equal(h.q('apply-settings').disabled,false);assert.equal(h.writes(),0);
});
test('model refresh failure releases loading controls and retains the selected saved model',async t=>{
 const h=Harness(t,Data());await BindTranslationSettings();t.mock.method(globalThis,'fetch',async()=>{throw Error('network unavailable');});await h.q('translation-refresh').events.click();assert.equal(h.q('translation-refresh').disabled,false);assert.equal(h.q('translation-model').disabled,false);assert.equal(h.q('translation-model').value,'one');assert.equal(h.q('translation-status').dataset.error,'true');
});

test('credential visibility uses a real button and exposes pressed state',async t=>{
 const h=Harness(t,Data());await BindTranslationSettings();h.q('translation-show-key').events.click();assert.equal(h.q('translation-key').type,'text');assert.equal(h.q('translation-show-key').attributes['aria-pressed'],'true');h.q('translation-show-key').events.click();assert.equal(h.q('translation-key').type,'password');assert.equal(h.q('translation-show-key').attributes['aria-pressed'],'false');
});
test('captured Kakao credentials persist without applying unrelated form drafts',async t=>{
 const h=Harness(t,Data());let onMessage,onDisconnect;
 chrome.runtime.connectNative=()=>({onMessage:{addListener:fn=>{onMessage=fn;}},onDisconnect:{addListener:fn=>{onDisconnect=fn;}},postMessage(){},disconnect(){onDisconnect?.();}});
 await BindTranslationSettings();h.q('translation-key').value='unsaved-openai';h.q('translation-provider').value='kakao';h.q('translation-provider').events.change();await h.q('translation-capture').events.click();await onMessage({ok:true,captureProtocol:2,capabilities:['listProcesses','captureHeaders']});await onMessage({ok:true,processes:[{pid:71,name:'PotPlayerMini64.exe'}]});await onMessage({ok:true,status:'waiting'});await onMessage({ok:true,status:'captured',headers:'Authorization: KakaoAK captured-test-only'});
 assert.equal(h.stored().providers.kakao.key,'captured-test-only');assert.equal(h.stored().providers.openai.key,'test-only');assert.equal(h.stored().provider,'openai');assert.equal(h.q('translation-key').value,'captured-test-only');assert.equal(h.q('translation-capture').disabled,false);assert.equal(h.q('capture-status').dataset.error,'false');
});
test('legacy credential helper requires an update without persisting a legacy key reply',async t=>{
 const h=Harness(t,Data());let onMessage,onDisconnect;const Requests=[];
 chrome.runtime.connectNative=()=>({onMessage:{addListener:fn=>{onMessage=fn;}},onDisconnect:{addListener:fn=>{onDisconnect=fn;}},postMessage:M=>Requests.push(M),disconnect(){onDisconnect?.();}});
 await BindTranslationSettings();h.q('translation-provider').value='kakao';h.q('translation-provider').events.change();await h.q('translation-capture').events.click();await onMessage({status:'captured',key:'legacy-test-only'});
 assert.deepEqual(Requests,[{action:'ping'}]);assert.equal(h.writes(),0);assert.equal(h.q('translation-capture').disabled,false);assert.equal(h.q('capture-status').dataset.error,'true');assert.match(h.q('helper-status').textContent,/update|업데이트/i);
});
