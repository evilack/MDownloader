import {RefreshHelperAvailability} from './lib/helper-availability.js';
import {SendRequest} from './lib/ui.js';
import {GetLocale} from './lib/i18n.js';
import {ShowSettingsDialog,ShowSettingsLoading} from './settings-dialog.js';
import {EnsureCaptionRuntime} from './lib/caption-runtime.js';
const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
export function NavigateToHelper()
{
 if(document.querySelector('#section-helper'))window.dispatchEvent(new CustomEvent('settings-navigate',{detail:{section:'helper'}}));
 else location.href=chrome.runtime.getURL('options.html?section=helper');
}
let Pending;
export async function EnsureHelperForFeature({feature='folder',engine,loading=true,beforePrompt}={})
{
 const Loading=loading?ShowSettingsLoading():undefined;let Ready=false;
 try{
  const State=await RefreshHelperAvailability({force:true});
  Ready=State.connected&&(feature!=='captions'||State.ready);
  if(Ready&&feature==='captions'){
   try{const Platform=(await chrome.runtime.getPlatformInfo()).os;await EnsureCaptionRuntime(Platform,engine);Ready=true;}catch{Ready=false;}
  }
 }finally{Loading?.close();}
 if(Ready)return true;
 beforePrompt?.();
 Pending??=ShowSettingsDialog({title:T('도우미 설치 필요','Helper installation required'),message:T('이 기능을 사용하려면 도우미가 필요합니다. 도우미 탭에서 설치해 주세요. 확인을 누르면 도우미 탭으로 이동합니다.','This feature needs the helper. Choose OK to open the Helper tab and install it.')}).then(Accepted=>{if(Accepted)NavigateToHelper();}).finally(()=>{Pending=undefined;});
 await Pending;return false;
}
export function BindHelperRemovalNotice()
{
 let Showing=false;
 const Show=async Record=>{
  if(Showing||!Record?.removedAt||Record.notify===false)return;Showing=true;
  try{
   const Seen=await chrome.storage.local.get('helperRemovalNoticeSeen');if(Seen.helperRemovalNoticeSeen>=Record.removedAt)return;
   await ShowSettingsDialog({title:T('도우미가 삭제되었습니다','Helper removed'),message:T('저장 방식을 브라우저 다운로드 폴더로, 음성 인식 엔진을 None으로 변경했습니다. 다시 사용하려면 도우미 탭에서 설치해 주세요.','The save mode was reset to the browser download folder and speech recognition to None. Install the helper from the Helper tab to use these features again.'),noticeOnly:true});
   await chrome.storage.local.set({helperRemovalNoticeSeen:Record.removedAt});
  }finally{Showing=false;}
 };
 window.addEventListener('helper-removed',Event=>void Show(Event.detail).catch(()=>{}));
 void chrome.storage.local.get('helperAvailability').then(Saved=>Show(Saved.helperAvailability)).catch(()=>{});
}
