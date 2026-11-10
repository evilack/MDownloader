import {DiscoverModels} from './lib/translation-providers.js';
import {Translate} from './lib/i18n.js';
import {DefaultKakaoKey} from './lib/kakao-default.js';
import {SettingsText, SettingsFeedback} from './settings-ui.js';
import {TranslationProviderCatalog, TranslationProviderIds, TranslationProviderNames, TranslationProviderOrigins, ProviderPresentation} from './lib/translation-provider-catalog.js';
import {CreateLanguageCodeControl,LanguageCodeLabel} from './language-code-control.js';
import {StartKakaoCapture} from './lib/kakao-capture.js';

const Q = Id => document.querySelector(`#translation-${Id}`), Node = Id => document.querySelector(`#${Id}`);
export async function BindTranslationSettings()
{
 const Form = document.querySelector('#translation-form'), Status = Q('status'), T=SettingsText;
 const TargetInput=Q('target'),TargetField=TargetInput.closest('.target-field'),TargetHelp=Node('target-help'),TargetName=Node('target-language-name');
 const TargetPicker=CreateLanguageCodeControl({label:Translate('translation_target'),input:TargetInput});
 TargetPicker.select.setAttribute('aria-describedby','target-help');TargetField.replaceChildren(TargetPicker.element,TargetName,TargetHelp);
 Q('provider').replaceChildren(...TranslationProviderIds.map(Id=>new Option(TranslationProviderNames[Id],Id)));
 let Data = (await chrome.storage.local.get('subtitleTranslation')).subtitleTranslation || {enabled:false,targetLanguage:'ko',provider:'deepl',providers:{}};
 Data.providers ||= {};
 // Seed the default once, so a user's replacement or deletion is respected.
 if (!Data.kakaoDefaultInitialized)
 {
  try
  {
    if (DefaultKakaoKey && !Data.providers.kakao?.key) Data.providers.kakao = {...Data.providers.kakao,key:DefaultKakaoKey};
    Data.kakaoDefaultInitialized = true;
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    await chrome.storage.local.set({subtitleTranslation:Data});
  }
  catch { Status.textContent=Translate('translation_error'); }
 }
 let Previous = Data.provider || 'deepl', Models = [], RefreshRevision=0, CapturePort, CaptureRevision=0, Saving=false, ShowKey=false;
 const Announce=(Text,Error=false,Target=Status)=>{
  Target.textContent=Text;Target.hidden=!Text;if(Target.dataset)Target.dataset.error=String(Error);Target.classList?.toggle('error',Error);
  // Legacy test doubles and older options markup do not expose the footer.
  const Footer=Node('save-feedback');if(Text&&Footer?.classList)SettingsFeedback(Text,Error);
 };
 const Collect = () => {
  const Old = Data.providers[Previous] || {};
  Data.providers[Previous] = {...Old,key:Q('key').value,region:Q('region').value.trim(),endpoint:Q('endpoint').value.trim(),model:Q('model').value,effort:Q('effort').value};
 };
 const UpdateCredential=()=>{
  Node('credential-status').textContent=Q('key').value?T('입력됨','Entered'):T('미입력','Not entered');
  Q('key').required=Q('enabled').checked;Q('target').required=Q('enabled').checked;
  Q('model').required=Q('enabled').checked&&TranslationProviderCatalog[Previous]?.capabilities.requiresModel;
  Node('translation-off').hidden=Q('enabled').checked;
  const Language=Q('target').value.trim();Node('target-language-name').textContent=Language?LanguageCodeLabel(Language,{includeCode:false}):'';
 };
 const FillEfforts = Selected => {
  const Levels=Models.find(X=>X.id===Q('model').value)?.efforts || [];
  Q('effort').replaceChildren(new Option(Translate('translation_default'),''));
  for (const Item of Levels) Q('effort').add(new Option(Item,Item));
  const Supported=ProviderPresentation(Previous,Levels).effort;
  Q('effort').value=Levels.includes(Selected)?Selected:'';Q('effort').disabled=!Supported;Node('effort-field').hidden=!Supported;
 };
 const Fill = () => {
  const Config=Data.providers[Previous]||{}, View=ProviderPresentation(Previous);
  Q('provider').value=Previous;Q('key').value=Config.key||'';Q('region').value=Config.region||'';Q('endpoint').value=Config.endpoint||'';
  ShowKey=false;Q('key').type='password';Q('show-key').textContent=T('표시','Show');Q('show-key').setAttribute?.('aria-pressed','false');
  Node('key-label').textContent=View.kakao?T('카카오 인증값','Kakao credential'):T('API 키','API key');Node('azure-fields').hidden=!View.azure;Node('kakao-import').hidden=!View.kakao;Node('model-card').hidden=!View.models;Node('model-field').hidden=!View.models;Node('fixed-model').hidden=!View.fixed;
  Q('region').parentElement.hidden=!View.azure;Q('endpoint').parentElement.hidden=!View.azure;Q('kakao-help').hidden=!View.kakao;Q('capture').hidden=!View.kakao;Q('refresh').hidden=!View.refresh;
  Models=Config.models||[];
  if(Previous==='deepl'&&!Models.length)Models=['latency_optimized','quality_optimized','prefer_quality_optimized'].map(id=>({id,efforts:[]}));
  Q('model').replaceChildren(new Option(Translate('translation_default'),''));
  const DeepLLabels={prefer_quality_optimized:T('품질 우선 · 가능한 경우','Prefer quality · When available'),quality_optimized:T('품질 최적화','Quality optimized'),latency_optimized:T('속도 최적화','Latency optimized')};
  for(const Item of Models)Q('model').add(new Option(Previous==='deepl'?(DeepLLabels[Item.id]||Item.id):(Item.label||Item.id),Item.id));
  if(Config.model&&!Models.some(X=>X.id===Config.model))Q('model').add(new Option(Config.model,Config.model));
  Q('model').value=Config.model||'';FillEfforts(Config.effort);Q('refresh').disabled=false;Q('model').disabled=false;
  Node('model-status').classList?.remove('error');Node('model-status').textContent=Previous==='deepl'?T('서비스에서 제공하는 최적화 방식을 선택합니다.','Choose a service optimization mode.'):Models.length?T(`모델 ${Models.length}개 · 조회한 목록에서 선택합니다.`,`${Models.length} models · Choose from the retrieved list.`):T('인증정보를 입력하고 모델 목록을 조회하세요.','Enter your credential and refresh the model list.');
  Q('key').setCustomValidity?.('');Q('model').setCustomValidity?.('');Status.textContent='';UpdateCredential();
 };
 const StopCapture=()=>{CaptureRevision++;if(CapturePort){const Port=CapturePort;CapturePort=undefined;Port.disconnect();}Q('capture').disabled=false;};
 Q('enabled').checked=!!Data.enabled;TargetPicker.set(Data.targetLanguage||'ko');Fill();
 Q('provider').addEventListener('change',()=>{Collect();StopCapture();Previous=Q('provider').value;Fill();Announce('',false,Node('capture-status'));});
 Q('model').addEventListener('change',()=>{Q('model').setCustomValidity?.('');FillEfforts('');});
 Q('show-key').addEventListener('click',()=>{ShowKey=!ShowKey;Q('key').type=ShowKey?'text':'password';Q('show-key').textContent=ShowKey?T('숨김','Hide'):T('표시','Show');Q('show-key').setAttribute?.('aria-pressed',String(ShowKey));});
 Q('key').addEventListener('input',()=>{Q('key').setCustomValidity?.('');UpdateCredential();});Q('target').addEventListener('input',()=>{Q('target').setCustomValidity?.('');UpdateCredential();});Q('enabled').addEventListener('change',UpdateCredential);
 Node('helper-guide').addEventListener('click',()=>{const Open=Node('helper-instructions').hidden;Node('helper-instructions').hidden=!Open;Node('helper-guide').setAttribute?.('aria-expanded',String(Open));});
 Q('capture').addEventListener('click',async()=>{
  StopCapture();const Revision=CaptureRevision;Q('capture').disabled=true;
  const Fail=Code=>{
   if(Revision!==CaptureRevision)return;
   const Update=Code==='capture_helper_update_required';
   Announce(Update?T('인증 가져오기 도우미를 최신 버전으로 다시 설치하세요.','Reinstall the latest credential import helper.'):Translate('translation_capture_failed'),true,Node('capture-status'));Node('helper-status').textContent=Update?T('도우미 업데이트 필요','Helper update required'):T('연결 실패','Connection failed');Node('helper-instructions').hidden=false;Node('helper-guide').setAttribute?.('aria-expanded','true');Q('capture').disabled=false;
  };
  try{
   if(!await chrome.permissions.request({permissions:['nativeMessaging']}))throw Error('permission');
   if(Revision!==CaptureRevision)return;
   Announce(Translate('translation_capture_wait'),false,Node('capture-status'));Node('helper-status').textContent=T('연결 확인 중','Connecting');
   const Port=StartKakaoCapture({onMessage:async Message=>{
    if(Revision!==CaptureRevision)return;
    if(Message.status==='waiting'){Announce(Translate('translation_capture_wait'),false,Node('capture-status'));Node('helper-status').textContent=T('인증 대기','Waiting for credential');}
    if(Message.status==='captured'&&typeof Message.key==='string'&&Message.key){
     // Persist only the captured credential; leave other unsaved form drafts pending.
     try{
      const Saved=(await chrome.storage.local.get('subtitleTranslation')).subtitleTranslation||{enabled:false,targetLanguage:'ko',provider:'deepl',providers:{}};
      Saved.providers||={};Saved.providers.kakao={...(Saved.providers.kakao||{}),key:Message.key};Saved.kakaoDefaultInitialized=true;
      await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.local.set({subtitleTranslation:Saved});
      Data.providers.kakao={...(Data.providers.kakao||{}),key:Message.key};Data.kakaoDefaultInitialized=true;if(Previous==='kakao')Q('key').value=Message.key;UpdateCredential();Announce(Translate('translation_saved'),false,Node('capture-status'));Node('helper-status').textContent=T('가져오기 완료','Imported');
     }catch{Fail();}
     Q('capture').disabled=false;CapturePort=undefined;Port.disconnect();
    }
    if(Message.status==='error'){Fail(Message.code);CapturePort=undefined;Port.disconnect();}
   },onDisconnect:()=>{if(CapturePort===Port){CapturePort=undefined;Fail();}}});
   CapturePort=Port;
  }catch{Fail();}
 });
 Q('delete').addEventListener('click',async()=>{
  const Owner=Previous,OldKey=Q('key').value;Q('delete').disabled=true;
  try{
   const Saved=(await chrome.storage.local.get('subtitleTranslation')).subtitleTranslation||{enabled:false,targetLanguage:'ko',provider:'deepl',providers:{}};
   Saved.providers||={};Saved.providers[Owner]={...(Saved.providers[Owner]||{}),key:''};Saved.kakaoDefaultInitialized=true;
   await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.local.set({subtitleTranslation:Saved});
   Data.providers[Owner]={...(Data.providers[Owner]||{}),key:''};if(Previous===Owner)Q('key').value='';UpdateCredential();Announce(Translate('translation_saved'));
  }catch{if(Previous===Owner)Q('key').value=OldKey;Announce(Translate('translation_error'),true);}finally{Q('delete').disabled=false;}
 });
 Q('refresh').addEventListener('click',async()=>{
  Collect();const Owner=Previous,Config={...Data.providers[Owner]},OwnRevision=++RefreshRevision;
  Q('refresh').disabled=true;Q('model').disabled=true;Node('model-status').textContent=Translate('translation_loading');
  try{
   const Granted=await chrome.permissions.request({origins:TranslationProviderOrigins(Owner,Config)});if(!Granted)throw Error('permission');
   const Fetched=await DiscoverModels(Owner,Config);if(OwnRevision!==RefreshRevision)return;
   Data.providers[Owner]={...Data.providers[Owner],models:Fetched};
   if(Previous===Owner){Models=Fetched;Fill();Node('model-status').textContent=Translate('translation_models_loaded');}
  }catch{if(Previous===Owner&&OwnRevision===RefreshRevision){Node('model-status').classList?.add('error');Node('model-status').textContent=Translate('translation_error');Announce(Translate('translation_error'),true);}}
  finally{if(Previous===Owner&&OwnRevision===RefreshRevision){Q('refresh').disabled=false;Q('model').disabled=false;}}
 });
 Form.addEventListener('settings-reset',async()=>{
  StopCapture();RefreshRevision++;
  try{const Saved=(await chrome.storage.local.get('subtitleTranslation')).subtitleTranslation;if(Saved)Data=Saved;Data.providers||={};Previous=Data.provider||'deepl';Q('enabled').checked=!!Data.enabled;TargetPicker.set(Data.targetLanguage||'ko');Fill();Announce(T('저장된 설정을 다시 불러왔습니다.','Restored the saved settings.'));}
  catch{Announce(Translate('translation_error'),true);}
 });
 Form.addEventListener('submit',async Event=>{
  Event.preventDefault();if(Saving)return;Collect();
  try{
   const Enabled=Q('enabled').checked,Target=Q('target').value.trim();
   if(Enabled&&!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(Target))throw Error('language');
   if(Enabled&&!Q('key').value.trim()){Q('key').setCustomValidity?.(T('인증정보를 입력하세요.','Enter a credential.'));Q('key').reportValidity?.();throw Error('credential');}
   if(Enabled&&TranslationProviderCatalog[Previous]?.capabilities.requiresModel&&!Q('model').value){Q('model').setCustomValidity?.(T('모델을 선택하세요.','Choose a model.'));Q('model').reportValidity?.();throw Error('model');}
   const PendingPermission=Enabled?chrome.permissions.request({origins:TranslationProviderOrigins(Previous,{endpoint:Q('endpoint').value.trim()})}):Promise.resolve(true);
   Saving=true;Node('apply-settings').disabled=true;
   if(!await PendingPermission)throw Error('permission');
   Data.enabled=Enabled;Data.targetLanguage=Target||Data.targetLanguage||'ko';Data.provider=Previous;
   await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.local.set({subtitleTranslation:Data});Announce(Translate('translation_saved'));
  }catch{Announce(Translate('translation_error'),true);}finally{Saving=false;Node('apply-settings').disabled=false;}
 });
}
