import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {HandleTranslationConfiguration} from '../extension/lib/translation-configuration.js';
const Root='chrome-extension://test/';
Test('translation credentials are sent only to the extension offscreen runner', async () =>
{
 let Reads=0;
 const Api={runtime:{id:'test',getURL:Path=>Root+Path},storage:{local:{get:async()=>{Reads++;return {subtitleTranslation:{enabled:true,provider:'google',targetLanguage:'ko',providers:{google:{key:'selected'},deepl:{key:'other'}}}};}}}};
 for (const Sender of [{id:'other',url:Root+'hls-runner.html'},{id:'test',url:Root+'options.html'},{id:'test',url:Root+'hls-runner.html',tab:{id:1}},{id:'test',url:'https://example.test/'}])
  Assert.equal(HandleTranslationConfiguration({type:'subtitleTranslationConfiguration'},Sender,()=>Assert.fail('must not reply'),Api),false);
 Assert.equal(Reads,0);
 const Result=await new Promise(Resolve=>Assert.equal(HandleTranslationConfiguration({type:'subtitleTranslationConfiguration'},{id:'test',url:Root+'hls-runner.html'},Resolve,Api),true));
 Assert.deepEqual(Result.data.providers,{google:{key:'selected'}});Assert.equal(Reads,1);
});
Test('disabled translation returns no credentials and settings failure fails explicitly', async () =>
{
 const Api={runtime:{id:'test',getURL:Path=>Root+Path},storage:{local:{get:async()=>({subtitleTranslation:{enabled:false,providers:{google:{key:'private'}}}})}}};
 const Call=()=>new Promise(Resolve=>HandleTranslationConfiguration({type:'subtitleTranslationConfiguration'},{id:'test',url:Root+'hls-runner.html'},Resolve,Api));
 Assert.deepEqual(await Call(),{ok:true,data:{enabled:false}});
 Api.storage.local.get=async()=>{throw Error('private detail');};
 Assert.deepEqual(await Call(),{ok:false,error:{key:'subtitle_translation_failed',args:[]}});
});
Test('per-download translation choices use the saved provider credential without exposing other providers', async () =>
{
 const Api={runtime:{id:'test',getURL:Path=>Root+Path},storage:{local:{get:async()=>({subtitleTranslation:{enabled:false,provider:'deepl',providers:{deepl:{key:'unused'},google:{key:'selected',model:'nmt'}}}})}}};
 const Options={enabled:true,provider:'google',targetLanguage:'ja',sourceLanguage:'fr',model:'nmt',effort:''};
 const Result=await new Promise(Resolve=>HandleTranslationConfiguration({type:'subtitleTranslationConfiguration',options:Options},{id:'test',url:Root+'hls-runner.html'},Resolve,Api));
 Assert.deepEqual(Result.data,{enabled:true,provider:'google',targetLanguage:'ja',sourceLanguage:'fr',providers:{google:{key:'selected',model:'nmt',effort:''}}});
});
