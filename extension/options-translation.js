import {DiscoverModels} from './lib/translation-providers.js';
import {Translate} from './lib/i18n.js';

const Hosts = {deepl:['https://api-free.deepl.com/*','https://api.deepl.com/*'], google:['https://translation.googleapis.com/*'], gemini:['https://generativelanguage.googleapis.com/*'], deepseek:['https://api.deepseek.com/*'], openai:['https://api.openai.com/*'], kakao:['https://dapi.kakao.com/*']};
const Q = Id => document.querySelector(`#translation-${Id}`);
function Origins(Provider, Endpoint)
{
 if (Provider !== 'azure') return Hosts[Provider] || [];
 const Url = new URL(Endpoint || 'https://api.cognitive.microsofttranslator.com');
 if (Url.protocol !== 'https:' || Url.username || Url.password || Url.search || Url.hash || Url.pathname !== '/' || !(Url.hostname === 'api.cognitive.microsofttranslator.com' || Url.hostname.endsWith('.cognitiveservices.azure.com'))) throw new Error('endpoint');
 return [`${Url.origin}/*`];
}
export async function BindTranslationSettings()
{
 const Form = document.querySelector('#translation-form');
 const Status = Q('status');
 const Data = (await chrome.storage.local.get('subtitleTranslation')).subtitleTranslation || {enabled:false,targetLanguage:'ko',provider:'deepl',providers:{}};
 Data.providers ||= {};
 // Seed the default once, so a user's replacement or deletion is respected.
 if (!Data.kakaoDefaultInitialized)
 {
  try
  {
    Data.kakaoDefaultInitialized = true;
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    await chrome.storage.local.set({subtitleTranslation:Data});
  }
  catch { Status.textContent=Translate('translation_error'); }
 }
 let Previous = Data.provider || 'deepl', Models = [], RefreshRevision=0;
 Q('enabled').checked = !!Data.enabled; Q('target').value = Data.targetLanguage || 'ko'; Q('provider').value = Previous;
 const Collect = () => {
  const Old = Data.providers[Previous] || {};
  Data.providers[Previous] = {...Old,key:Q('key').value,region:Q('region').value.trim(),endpoint:Q('endpoint').value.trim(),model:Q('model').value,effort:Q('effort').value};
 };
 const FillEfforts = Selected => {
  const Entry = Models.find(X=>X.id === Q('model').value); Q('effort').replaceChildren(new Option(Translate('translation_default'),''));
  for (const Item of Entry?.efforts || []) Q('effort').add(new Option(Item,Item));
  if (Selected && !Array.from(Q('effort').options).some(X=>X.value===Selected)) Q('effort').add(new Option(Selected,Selected));
  Q('effort').value = Selected || ''; Q('effort').disabled = Q('effort').options.length === 1;
 };
 const Fill = () => {
  const Config = Data.providers[Previous] || {};
  Q('key').value=Config.key || ''; Q('region').value=Config.region || ''; Q('endpoint').value=Config.endpoint || '';
  Q('region').parentElement.hidden=Previous!=='azure'; Q('endpoint').parentElement.hidden=Previous!=='azure'; Q('kakao-help').hidden=Previous!=='kakao'; Q('capture').hidden=Previous!=='kakao';
  Models=Config.models || []; Q('model').replaceChildren(new Option(Translate('translation_default'),''));
  for (const Item of Models) Q('model').add(new Option(Item.label || Item.id,Item.id));
  if (Config.model && !Models.some(X=>X.id===Config.model)) Q('model').add(new Option(Config.model,Config.model));
  Q('model').value=Config.model || ''; FillEfforts(Config.effort); Status.textContent='';
 };
 Fill();
 Q('provider').addEventListener('change',()=>{Collect(); Previous=Q('provider').value; Fill();});
 Q('model').addEventListener('change',()=>FillEfforts(''));
 Q('show-key').addEventListener('change',()=>{Q('key').type=Q('show-key').checked?'text':'password';});
 Q('capture').addEventListener('click',()=>{
  const Port=chrome.runtime.connectNative('com.mdownloader.kakao'); Q('capture').disabled=true;
  Port.onMessage.addListener(async Message=>{
   if (Message.status==='waiting') Status.textContent=Translate('translation_capture_wait');
   if (Message.status==='captured' && typeof Message.key==='string' && Message.key) {
    Data.providers.kakao={...(Data.providers.kakao || {}),key:Message.key};
    if (Previous==='kakao') Q('key').value=Message.key;
    Data.kakaoDefaultInitialized=true;
    try {await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}); await chrome.storage.local.set({subtitleTranslation:Data}); Status.textContent=Translate('translation_saved');}
    catch {Status.textContent=Translate('translation_error');}
    Q('capture').disabled=false; Port.disconnect();
   }
   if (Message.status==='error') {Status.textContent=Translate('translation_capture_failed'); Q('capture').disabled=false; Port.disconnect();}
  });
  Port.onDisconnect.addListener(()=>{if(Q('capture').disabled){Status.textContent=Translate('translation_capture_failed'); Q('capture').disabled=false;}});
  Port.postMessage({action:'capture'});
 });
 Q('delete').addEventListener('click',async()=>{Q('key').value=''; Collect(); try { await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}); await chrome.storage.local.set({subtitleTranslation:Data}); Status.textContent=Translate('translation_saved'); } catch {Status.textContent=Translate('translation_error');}});
 Q('refresh').addEventListener('click',async()=>{
  Collect();
  const Owner=Previous, Config={...Data.providers[Owner]}, OwnRevision=++RefreshRevision;
  try {
   const Granted = await chrome.permissions.request({origins:Origins(Owner,Config.endpoint)});
   if (!Granted) throw new Error('permission');
   if(Previous===Owner) Status.textContent=Translate('translation_loading');
   const Fetched=await DiscoverModels(Owner,Config);
   if(OwnRevision!==RefreshRevision) return;
   Data.providers[Owner]={...Data.providers[Owner],models:Fetched};
   if(Previous===Owner) {Models=Fetched; Fill(); Status.textContent=Translate('translation_models_loaded');}
  } catch {if(Previous===Owner && OwnRevision===RefreshRevision) Status.textContent=Translate('translation_error');}
 });
 Form.addEventListener('submit',async Event=>{
  Event.preventDefault(); Collect();
  try {
   const Target=Q('target').value.trim(); if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(Target)) throw new Error('language');
   if (Q('enabled').checked && ['gemini','deepseek','openai'].includes(Previous) && !Q('model').value) throw new Error('model');
   if (Q('enabled').checked) {const Granted=await chrome.permissions.request({origins:Origins(Previous,Q('endpoint').value.trim())}); if (!Granted) throw new Error('permission');}
   Data.enabled=Q('enabled').checked; Data.targetLanguage=Target; Data.provider=Previous;
   await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
   await chrome.storage.local.set({subtitleTranslation:Data}); Status.textContent=Translate('translation_saved');
  } catch {Status.textContent=Translate('translation_error');}
 });
}
