import {CreateCaptionSettings,CaptionText as T} from './local-captions-ui.js';
import {CaptionSettingKey,NormalizeCaptionSettings} from './lib/local-captions-settings.js';
import {SendRequest} from './lib/ui.js';
import {RefreshHelperAvailability,SubscribeHelperAvailability} from './lib/helper-availability.js';
import {EnsureHelperForFeature} from './options-helper-navigation.js';
export async function BindLocalCaptionSettings()
{
 const Platform=await chrome.runtime.getPlatformInfo();
 const Probe=async Options=>{
  const Common=await RefreshHelperAvailability();
  const Caption=Options.engine==='none'||!Common.connected?{connected:false,installedModels:[]}:await SendRequest('captionProbe',Options).catch(()=>({connected:false}));
  return {...Caption,commonHelper:Common};
 };
 const Disable=async()=>{const Saved=await chrome.storage.local.get(CaptionSettingKey);await chrome.storage.local.set({[CaptionSettingKey]:NormalizeCaptionSettings({...Saved[CaptionSettingKey],enabled:false,engine:'none',model:''},Platform.os)});Ui.feedback.dataset.error='false';Ui.feedback.dataset.saved='true';Ui.feedback.textContent=T('음성 인식 엔진을 None으로 변경하고 자동 저장했습니다.','Speech recognition was set to None and saved automatically.');};
 const DeleteModel=async Options=>{
  const Result=await SendRequest('captionDeleteModel',Options),Saved=await chrome.storage.local.get(CaptionSettingKey),Value=Saved[CaptionSettingKey];
  if(Value?.engine===Options.engine&&Value?.model===Options.model)await chrome.storage.local.set({[CaptionSettingKey]:{...Value,enabled:false,model:''}});
  return Result;
 };
 const Ui=CreateCaptionSettings({platform:Platform.os,probe:Probe,prepare:Options=>SendRequest('captionPrepareModel',Options),cancelModel:Options=>SendRequest('captionCancelModel',Options),deleteModel:DeleteModel,ensureHelper:Options=>EnsureHelperForFeature({feature:'captions',...Options}),onNone:Disable});
 document.getElementById('section-captions').append(Ui.form);
 chrome.runtime.onMessage?.addListener((Message,Sender)=>{if(Message.type==='captionModelProgress'&&Sender.id===chrome.runtime.id)Ui.modelProgress(Message);});
 async function Load(){const V=await chrome.storage.local.get(CaptionSettingKey);Ui.write(NormalizeCaptionSettings(V[CaptionSettingKey],Platform.os));}
 Ui.form.addEventListener('submit',async Event=>{Event.preventDefault();try{await Ui.refresh();const Value=Ui.read();if(Value.engine!=='none'&&!await EnsureHelperForFeature({feature:'captions',engine:Value.engine})){Ui.forceNone();await Disable();return;}if(Value.enabled&&!Value.model){Ui.feedback.dataset.error='true';Ui.feedback.textContent=T('모델을 다운로드한 뒤 자동 자막을 켜 주세요.','Download a model before enabling automatic captions.');return;}await chrome.storage.local.set({[CaptionSettingKey]:Value});Ui.feedback.dataset.error='false';Ui.feedback.dataset.saved='true';Ui.feedback.textContent=T('자동 자막 기본값을 적용했습니다.','Automatic caption defaults applied.');}catch{Ui.feedback.dataset.error='true';Ui.feedback.textContent=T('설정을 저장하지 못했습니다. 출력 형식과 연결 상태를 확인해 주세요.','Could not save settings. Check the output format and connection.');}});
 Ui.form.addEventListener('settings-reset',()=>void Load().then(()=>Ui.refresh()));
 await Load();void Ui.refresh();
 let LastHelperState='';
 SubscribeHelperAvailability(State=>{const Signature=[State.connected,State.ready,State.confirmedMissing].join(':');if(Signature===LastHelperState)return;LastHelperState=Signature;if(State.confirmedMissing){void Ui.cancelActiveModel().catch(()=>{});Ui.forceNone();}else void Ui.refresh();});
 chrome.storage.onChanged.addListener((Changes,Area)=>{if(Area==='local'&&Changes[CaptionSettingKey]?.newValue?.engine==='none'){Ui.forceNone();}});
 return Ui;
}
