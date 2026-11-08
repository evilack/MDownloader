import test from'node:test';import assert from'node:assert/strict';
import{BindTranslationSettings}from'../extension/options-translation.js';
test('a late model response remains bound to its original provider after switching services',async t=>{
 class Node{constructor(){this.events={};this.options=[];this.value='';this.parentElement={};}addEventListener(name,fn){this.events[name]=fn;}replaceChildren(...items){this.options=items;}add(item){this.options.push(item);}}
 const nodes=new Map(),q=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 const settings={enabled:false,provider:'openai',targetLanguage:'ko',kakaoDefaultInitialized:true,providers:{openai:{key:'fixture-only',model:'initial',models:[{id:'initial'}]},google:{key:'fixture-only',model:'nmt',models:[{id:'nmt'}]}}};let stored;
 globalThis.document={querySelector:selector=>q(selector.slice(1))};globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
 globalThis.chrome={permissions:{request:async()=>true},storage:{local:{get:async()=>({subtitleTranslation:structuredClone(settings)}),setAccessLevel:async()=>{},set:async value=>{stored=structuredClone(value.subtitleTranslation);}}}};
 t.after(()=>{delete globalThis.document;delete globalThis.Option;delete globalThis.chrome;});
 const pending=Promise.withResolvers(),started=Promise.withResolvers();t.mock.method(globalThis,'fetch',async()=>{started.resolve();return pending.promise;});
 await BindTranslationSettings();const refreshing=q('translation-refresh').events.click();await started.promise;
 q('translation-provider').value='google';q('translation-provider').events.change();
 pending.resolve(new Response(JSON.stringify({data:[{id:'fixture-openai-only'}]})));await refreshing;
 await q('translation-form').events.submit({preventDefault(){}});
 assert.deepEqual(stored.providers.google.models,[{id:'nmt'}]);assert.equal(stored.providers.openai.models[0].id,'fixture-openai-only');assert.equal(q('translation-model').value,'nmt');
});
