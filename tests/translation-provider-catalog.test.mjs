import test from 'node:test';
import assert from 'node:assert/strict';
import { TranslationProviderCatalog, TranslationProviderIds, TranslationProviderNames, TranslationProviderOrigins, ProviderPresentation } from '../extension/lib/translation-provider-catalog.js';

test('the common provider catalogue keeps ids, labels and capabilities immutable',()=>{
 assert.deepEqual(TranslationProviderIds,['deepl','google','azure','gemini','deepseek','openai','kakao']);
 for(const id of TranslationProviderIds){assert.equal(TranslationProviderCatalog[id].id,id);assert.equal(TranslationProviderNames[id],TranslationProviderCatalog[id].name);assert.ok(Object.isFrozen(TranslationProviderCatalog[id].capabilities));}
 assert.ok(Object.isFrozen(TranslationProviderCatalog));assert.ok(Object.isFrozen(TranslationProviderIds));assert.ok(Object.isFrozen(TranslationProviderNames));
 assert.throws(()=>{TranslationProviderCatalog.openai.capabilities.requiresModel=false;},TypeError);
});
test('permission origins match the actual service, and callers cannot mutate the catalogue',()=>{
 assert.deepEqual(TranslationProviderOrigins('deepl'),['https://api-free.deepl.com/*','https://api.deepl.com/*']);
 for(const [id,host] of Object.entries({google:'translation.googleapis.com',gemini:'generativelanguage.googleapis.com',deepseek:'api.deepseek.com',openai:'api.openai.com',kakao:'dapi.kakao.com'}))assert.deepEqual(TranslationProviderOrigins(id),[`https://${host}/*`]);
 const origins=TranslationProviderOrigins('openai');origins.push('https://untrusted.test/*');assert.deepEqual(TranslationProviderOrigins('openai'),['https://api.openai.com/*']);assert.deepEqual(TranslationProviderOrigins('unknown'),[]);
});
test('Azure accepts only the existing HTTPS root endpoints before requesting permissions',()=>{
 assert.deepEqual(TranslationProviderOrigins('azure'),['https://api.cognitive.microsofttranslator.com/*']);
 assert.deepEqual(TranslationProviderOrigins('azure',{endpoint:'https://my-resource.cognitiveservices.azure.com/'}),['https://my-resource.cognitiveservices.azure.com/*']);
 for(const endpoint of ['http://api.cognitive.microsofttranslator.com','https://example.com','https://cognitiveservices.azure.com.attacker.test','https://user:password@api.cognitive.microsofttranslator.com','https://api.cognitive.microsofttranslator.com/path','https://api.cognitive.microsofttranslator.com?key=secret','https://api.cognitive.microsofttranslator.com#hash'])assert.throws(()=>TranslationProviderOrigins('azure',{endpoint}));
});
test('shared capabilities never expose provider-unsupported configuration fields',()=>{
 for(const id of ['azure','kakao','google']){const view=ProviderPresentation(id,['low']);assert.equal(view.models,false);assert.equal(view.effort,false);assert.equal(view.refresh,false);assert.equal(TranslationProviderCatalog[id].capabilities.requiresModel,false);}
 assert.equal(ProviderPresentation('google').fixed,true);assert.equal(ProviderPresentation('azure').azure,true);assert.equal(ProviderPresentation('kakao').kakao,true);
 assert.equal(ProviderPresentation('deepl',['low']).effort,false);assert.equal(ProviderPresentation('openai',['low']).effort,true);assert.equal(ProviderPresentation('openai').effort,false);
 assert.deepEqual(ProviderPresentation('unknown',['low']),{azure:false,kakao:false,models:false,fixed:false,effort:false,refresh:false});
});
