import {GetLocale,ErrorText} from './lib/i18n.js';
import {HelperVersionLabel} from './lib/common-helper-contract.js';
import {ShowCommonHelperSetup} from './common-helper-setup-dialog.js';
import {BindExplorerRemoval} from './options-explorer-remove.js';
import {RefreshHelperAvailability,SubscribeHelperAvailability,StartHelperAvailability,CurrentHelperAvailability} from './lib/helper-availability.js';
import {SendRequest} from './lib/ui.js';
import {InstallCaptionHelper} from './lib/caption-installer.js';
import {CaptionRuntimeReady,CaptionRuntimeOutdated,CaptionRuntimeEngines,CaptionPackageVersion} from './lib/caption-runtime-contract.js';
const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
export async function BindHelperSettings(){
 const Root=document.querySelector('#section-helper'),Install=document.querySelector('#helper-install'),Diagnose=document.querySelector('#helper-diagnose'),Status=document.querySelector('#explorer-helper-status'),Details=document.querySelector('#helper-diagnostics'),Removal=document.querySelector('#explorer-helper-management');
 if(!Root||!Install||!Diagnose||!Status||!Details)return;
 if(Root.dataset.helperBound)return;Root.dataset.helperBound='true';
 const Platform=(await chrome.runtime.getPlatformInfo()).os,Supported=['win','mac'].includes(Platform);let Busy=false,EngineUpdate=false,Inspecting=false,InspectedVersion,InspectionRevision=0;
 async function InspectRuntime(){let Timer;try{
  const Engines=CaptionRuntimeEngines(Platform);
  const Results=await Promise.race([Promise.all(Engines.map(Engine=>SendRequest('captionProbe',{engine:Engine,model:''}))),new Promise((_,Reject)=>{Timer=setTimeout(()=>Reject(Error('caption_helper_missing')),20000);})]);
  return {ready:Results.every(CaptionRuntimeReady),outdated:Results.some(CaptionRuntimeOutdated),captionPackageVersion:Math.min(...Results.map(R=>R?.captionPackageVersion||0)),engineReady:Results.every(R=>R?.engineReady),converterReady:Results.every(R=>R?.converterReady),recognitionOptionsVersion:Results.every(R=>R?.recognitionOptionsVersion>=1)?1:0};
 }finally{clearTimeout(Timer);}}
 function Render(State){
  const Removing=Removal?.dataset.removing==='true';
  if(!State.ready){EngineUpdate=false;InspectedVersion=undefined;Inspecting=false;++InspectionRevision;}
  else if(!Busy&&!Removing&&InspectedVersion!==State.helperVersion){
   InspectedVersion=State.helperVersion;Inspecting=true;const Own=++InspectionRevision;
   void InspectRuntime().then(Result=>{if(Own!==InspectionRevision)return;EngineUpdate=!Result.ready||Result.outdated;Inspecting=false;Render(CurrentHelperAvailability());},()=>{if(Own!==InspectionRevision)return;EngineUpdate=true;Inspecting=false;Render(CurrentHelperAvailability());});
  }
  Install.textContent=State.ready&&EngineUpdate?T('음성 기능 업데이트','Update speech features'):State.checked&&State.connected&&!State.ready?T('도우미 업데이트','Update helper'):T('도우미 설치','Install helper');Install.disabled=Busy||Inspecting||Removing||!Supported||!State.checked||State.ready&&!EngineUpdate;Diagnose.disabled=Busy||Inspecting||Removing||!Supported;
  if(Removing)return;
  if(Busy||Inspecting){
   Status.textContent=State.connected?T('도우미가 설치되어 있습니다. 로딩 중...','The helper is installed. Loading...'):T('도우미 설치를 확인하고 있습니다. 로딩 중...','Checking helper installation. Loading...');
   Status.classList.remove('error');Status.dataset.error='false';return;
  }
  Status.textContent=!Supported?T('이 운영체제에서는 도우미를 지원하지 않습니다.','The helper is not supported on this operating system.'):!State.checked?T('도우미 연결 확인 중…','Checking helper connection…'):State.ready&&!EngineUpdate?T('도우미가 설치되어 있습니다.','The helper is installed.'):State.ready&&EngineUpdate?T('음성 패키지 업데이트가 필요합니다.','A speech package update is required.'):State.connected?T('도우미 업데이트가 필요합니다.','A helper update is required.'):State.reason==='permission'?T('연결 권한 없음 · 설치 버튼에서 권한을 허용해 주세요.','Connection permission is required. Allow it from Install.'):State.reason==='unavailable'?T('연결 확인 실패 · 다시 진단해 주세요.','Connection check failed. Run diagnostics again.'):T('도우미가 설치되어 있지 않습니다.','The helper is not installed.');
  Status.classList.toggle('error',State.checked&&!State.connected);Status.dataset.error=String(State.checked&&!State.connected);
 }
 SubscribeHelperAvailability(Render);
 window.addEventListener('helper-removal-state',()=>Render(CurrentHelperAvailability()));
 Install.addEventListener('click',async()=>{
  if(Busy||Inspecting||!Supported||CurrentHelperAvailability().ready&&!EngineUpdate)return;Busy=true;Details.hidden=true;Details.textContent='';Render(CurrentHelperAvailability());Root.setAttribute('aria-busy','true');window.dispatchEvent(new Event('helper-operation-state'));
  try{
   const Previous=CurrentHelperAvailability();
   if(!(Previous.ready&&EngineUpdate)&&!await ShowCommonHelperSetup({platform:Platform,update:Previous.connected&&!Previous.ready}))return;
   const State=await RefreshHelperAvailability({force:true});
   if(!State.ready)throw Error(T('도우미 연결을 확인하지 못했습니다. 다시 진단해 주세요.','The helper connection could not be verified. Run diagnostics again.'));
   const Probe=Options=>SendRequest('captionProbe',Options),Engines=CaptionRuntimeEngines(Platform);let NeedsInstall=false;
   for(const Engine of Engines){try{const Captions=await Probe({engine:Engine,model:''});if(!CaptionRuntimeReady(Captions)||CaptionRuntimeOutdated(Captions))NeedsInstall=true;}catch{NeedsInstall=true;}}
   if(NeedsInstall){
    await InstallCaptionHelper(Platform,Probe,()=>Render(CurrentHelperAvailability()));
   }
   for(const Engine of Engines){const Captions=await Probe({engine:Engine,model:''});if(!CaptionRuntimeReady(Captions)||CaptionRuntimeOutdated(Captions))throw Error(T('음성 인식 또는 모델 관리 기능이 준비되지 않았습니다. 다시 진단해 주세요.','Speech recognition or model management is not ready. Run diagnostics again.'));}
   EngineUpdate=false;InspectedVersion=State.helperVersion;Details.hidden=false;Details.textContent=T('도우미와 자막 엔진 연결을 확인했습니다. 음성 인식 설정에서 원하는 모델을 다운로드하고 선택해 주세요.','The helper and caption engine are connected. Download and select a model in Speech recognition settings.');
  }
  catch(ErrorValue){if(CurrentHelperAvailability().ready){EngineUpdate=true;InspectedVersion=CurrentHelperAvailability().helperVersion;}Details.hidden=false;Details.textContent=ErrorValue?.message==='caption_package_write_failed'?T('음성 패키지 파일을 교체하지 못했습니다. 도우미 진단으로 연결을 확인하고 다시 시도해 주세요.','Could not replace the speech package. Run helper diagnostics and try again.'):ErrorValue?.message==='common_setup_failed'?T('음성 기능 설치를 시작하지 못했습니다. 도우미의 helper-last-error.json에 기록된 오류를 확인해 주세요.','Could not start speech setup. See helper-last-error.json in the helper folder.'):ErrorText(ErrorValue);}
  finally{Busy=false;Root.removeAttribute('aria-busy');Render(CurrentHelperAvailability());window.dispatchEvent(new Event('helper-operation-state'));}
 });
 Diagnose.addEventListener('click',async()=>{
  if(Busy||!Supported)return;Busy=true;Render(CurrentHelperAvailability());Root.setAttribute('aria-busy','true');window.dispatchEvent(new Event('helper-operation-state'));Details.hidden=false;Details.textContent=T('연결과 자막 엔진을 확인하고 있습니다…','Checking the connection and caption engine…');
  try{
   const State=await RefreshHelperAvailability({force:true}),Saved=await chrome.storage.local.get('localCaptions'),Engine=Saved.localCaptions?.engine;
   let Captions,Failure;
   if(await chrome.permissions.contains({permissions:['nativeMessaging']})){
    try{Captions=await SendRequest('captionProbe',{engine:['faster-whisper','whisper.cpp'].includes(Engine)?Engine:Platform==='mac'?'whisper.cpp':'faster-whisper',model:Saved.localCaptions?.model||''});}catch(ErrorValue){Failure=ErrorText(ErrorValue);}
   }
   if(State.ready){try{const Runtime=await InspectRuntime();EngineUpdate=!Runtime.ready||Runtime.outdated;}catch{EngineUpdate=true;}InspectedVersion=State.helperVersion;}
   const Yes=T('사용 가능','Ready'),No=T('사용 불가','Unavailable');
   Details.textContent=[T('도우미 연결: ','Helper connection: ')+(State.connected?Yes:No),T('자막 설치 기능: ','Caption setup: ')+(State.ready?Yes:State.connected?T('도우미 업데이트 필요','Helper update required'):No),T('도우미 버전: ','Helper version: ')+(State.connected?HelperVersionLabel(State)||T('이전 버전','Legacy'):T('확인 불가','Unknown')),T('음성 패키지 버전: ','Speech package version: ')+(Captions?.captionPackageVersion||T('미설치','Not installed'))+' / '+CaptionPackageVersion,T('자막 엔진: ','Caption engine: ')+(Captions?.engineReady?Yes:No),T('오디오 변환 도구: ','Audio converter: ')+(Captions?.converterReady?Yes:No),T('설치된 모델: ','Installed models: ')+(Captions?.installedModels?.join(', ')||T('없음','None')),...(Failure?[T('자막 연결 정보: ','Caption connection details: ')+Failure]:[]),...(!State.connected&&Captions?.engineReady?[T('자막 엔진이 남아 있어도 도우미 연결은 별도로 필요합니다.','The retained caption engine does not replace the helper connection.')]:[])].join('\n');
  }catch(ErrorValue){Details.textContent=ErrorValue?.message==='caption_package_write_failed'?T('음성 패키지 파일을 교체하지 못했습니다. 도우미 진단으로 연결을 확인하고 다시 시도해 주세요.','Could not replace the speech package. Run helper diagnostics and try again.'):ErrorValue?.message==='common_setup_failed'?T('음성 기능 설치를 시작하지 못했습니다. 도우미의 helper-last-error.json에 기록된 오류를 확인해 주세요.','Could not start speech setup. See helper-last-error.json in the helper folder.'):ErrorText(ErrorValue);}
  finally{Busy=false;Root.removeAttribute('aria-busy');Render(CurrentHelperAvailability());window.dispatchEvent(new Event('helper-operation-state'));}
 });
 await BindExplorerRemoval();if(Supported)StartHelperAvailability();
}
