import { GetLocale } from './lib/i18n.js';
import { DistributionPolicy, CanUseYoutube } from './lib/distribution-policy.js';
import { GetSettings, SettingKeys, SetSetting } from './lib/settings.js';
import { SafeFilename } from './lib/download-folder.js';
import {EnsureHelperForFeature} from './options-helper-navigation.js';

const Sections = {
 general:['일반','표시 언어, 사이드 패널과 Chrome 알림을 설정합니다.','General','Set the display language, side panel behavior and Chrome notifications.'],
 download:['다운로드·파일명','저장할 위치와 파일 이름을 한곳에서 정리합니다.','Download · Filename','Manage the download location and file names.'],
 translation:['자막·번역','원본 자막을 유지하고, 필요한 언어만 자동으로 번역합니다.','Subtitles · Translation','Keep original subtitles and translate only the languages you need.'],
 captions:['음성 자막 생성','다운로드한 영상의 음성을 이 컴퓨터에서 자막으로 만듭니다.','Speech captions','Recognize speech from downloaded videos on this computer.'],
 helper:['도우미','도우미를 설치·삭제하고 연결 상태를 진단합니다.','Helper','Install, remove and diagnose the helper.'],
 permissions:['사이트 권한','영상 페이지와 미디어 서버의 접근 범위를 관리합니다.','Site permissions','Manage access to video pages and media servers.'],
 diagnostics:['진단·로그','다운로드 문제를 확인하고 필요한 기록을 살펴봅니다.','Diagnostics · Logs','Investigate download issues and review recorded events.'],
 about:['앱 정보','설치 버전과 배포판의 기능 범위를 확인합니다.','About','Check your installed version and distribution policy.'],
};
export const ResolveSettingsSection = Value => Object.hasOwn(Sections,Value) ? Value : 'general';
export {ProviderPresentation} from './lib/translation-provider-catalog.js';
// Example inputs are presentation placeholders; the real download naming utility owns formatting.
export const FilenameExample = (Title, IncludeDate, Now = new Date()) => SafeFilename(
 'video.mp4', Title ? '여름 여행' : undefined, IncludeDate ? Now : undefined, '.mp4', 'https://example.com'
);
export const SettingsText = (Korean,English) => GetLocale().startsWith('ko') ? Korean : English;
const EnglishText = new Map(Object.entries({
 '설정':'Settings','환경설정':'Preferences','일반':'General','언어, 사이드 패널, 알림':'Language, side panel and notifications','다운로드·파일명':'Download · Filename','저장 위치와 이름 규칙':'Location and naming rules','자막·번역':'Subtitles · Translation','서비스, 인증, 모델':'Service, credentials and models','사이트 권한':'Site permissions','사이트와 미디어 서버':'Sites and media servers','진단·로그':'Diagnostics · Logs','문제 확인과 기록':'Troubleshooting and history','앱 정보':'About','버전과 배포판':'Version and distribution',
 '표시 언어':'Display language','사이드 패널':'Side panel','팝업, 사이드 패널, 설정 화면에 적용합니다.':'Applies to the popup, side panel and settings.','다운로드 목록 위에 현재 페이지의 영상을 함께 표시합니다.':'Show media from the current page above the download list.',
 '저장 위치':'Download location','저장 방식':'Save mode','브라우저 다운로드 폴더 안에 저장':'Save inside the browser download folder','폴더 직접 선택':'Choose a folder directly','브라우저 기본 다운로드 위치를 기준으로 하는 상대 경로입니다.':'A relative path inside the browser’s default download location.','선택한 폴더 없음':'No folder selected','파일 이름':'File names','영상 제목과 원래 파일 이름을 함께 사용합니다.':'Use the page title together with the original file name.','파일 이름 끝에 날짜와 시간을 붙입니다.':'Append the download start date and time.','파일명 예시':'File name example','사이트 도메인을 앞에 붙이고, 공백·점·파일명에 쓸 수 없는 문자는 밑줄로 정리합니다.':'The site domain is prepended. Spaces, dots and unsupported filename characters become underscores.',
 '자막과 자동 번역':'Subtitles and automatic translation','원본 자막':'Original subtitles','다운로드한 자막을 MP4에 모두 포함합니다.':'Include all downloaded subtitles in the MP4.','원본 유지':'Keep originals','개발판에서 수동 자막과 자동 생성 자막을 함께 받습니다.':'Include manual and automatically generated captions in the development build.','번역한 자막은 원본과 함께 파일에 포함합니다.':'Translated subtitles are included alongside the originals.','언어 코드로 지정합니다. 목표 언어 자막이 이미 있으면 번역을 건너뜁니다.':'Use a language code. Translation is skipped when subtitles already exist in that language.','자동 번역 꺼짐 · 서비스 설정은 유지됩니다.':'Automatic translation is off · Service settings are retained.',
 '번역 서비스와 인증':'Translation service and credentials','서비스별 인증정보를 각각 관리합니다.':'Credentials are stored separately for each service.','선택':'Optional','팟플레이어에서 가져오기':'Import from PotPlayer','연결 시 확인':'Checked on connection','가져오기를 시작한 뒤 팟플레이어에서 자막 번역을 한 번 실행하세요.':'Start importing, then trigger subtitle translation once in PotPlayer.','설치 안내':'Setup instructions','Python 3.11 이상과 Frida를 설치합니다.':'Install Python 3.11 or later and Frida.','프로젝트의 native/kakao/install.ps1을 실제 확장 ID와 Python 경로로 실행합니다.':'Run native/kakao/install.ps1 from the project with the actual extension ID and Python path.','확장 프로그램을 새로고침합니다. 이 도우미는 64비트 팟플레이어 하나를 대상으로 연결합니다.':'Reload the extension. The helper connects to one 64-bit PotPlayer instance.','팟플레이어를 실행하고 자막이 있는 영상을 엽니다.':'Open a video with subtitles in PotPlayer.','가져오기를 누르고 팟플레이어의 카카오 자막 번역을 실행합니다.':'Click Import, then run Kakao subtitle translation in PotPlayer.',
 '모델과 추론':'Model and reasoning','번역 모델: NMT':'Translation model: NMT','선택한 모델에서 제공하는 수준만 표시합니다.':'Only reasoning levels supported by the selected model are shown.','번역 서비스의 API 사용료가 발생할 수 있습니다. 번역에 실패하면 다운로드 항목에 실패 상태가 표시됩니다.':'The translation service may charge API usage fees. Failed translation is reported on the download item.',
 '사이트 접근 범위':'Site access scope','모든 사이트에 접근 허용':'Allow access to all sites','영상 페이지와 미디어 서버에 대한 접근을 허용합니다.':'Allow access to video pages and media servers.','사이트별 권한':'Permissions by site','영상 서버가 페이지와 다른 도메인에 있을 때 함께 지정합니다.':'Specify the media server when it uses a different domain from the page.',
 '문제 확인':'Troubleshooting','다운로드 문제를 확인할 때 별도의 진단 탭을 엽니다.':'Open a separate diagnostic tab to investigate download issues.','단계 코드, 소요 시간, 수치를 확장 콘솔에 기록합니다.':'Write stage codes, elapsed times and metrics to the extension console.','다운로드 기록':'Download history','문제 해결을 위해 다운로드 작업의 기록을 남깁니다.':'Keep a record of download jobs for troubleshooting.','최근 기록':'Recent events','버전':'Version','배포판':'Distribution','되돌리기':'Revert','변경사항 적용':'Apply changes'
}));
function LocalizeSettingsMarkup()
{
 EnglishText.set('음성 자막 생성','Speech captions');EnglishText.set('음성 인식과 모델 관리','Speech recognition and model management');EnglishText.set('도우미','Helper');EnglishText.set('설치, 삭제와 연결 진단','Installation, removal and diagnostics');EnglishText.set('도우미 설치','Install helper');EnglishText.set('도우미 진단','Helper diagnostics');EnglishText.set('폴더 직접 선택과 음성 인식에 필요한 도우미를 관리합니다. 설치 시 모델은 다운로드하지 않습니다.','Manage the helper for folder selection and speech recognition. Models are not downloaded during installation.');
 if(GetLocale().startsWith('ko'))return;
 const Walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 for(let Node=Walker.nextNode();Node;Node=Walker.nextNode()){
  const Value=Node.nodeValue.trim(),Replacement=EnglishText.get(Value);
  if(Replacement)Node.nodeValue=Node.nodeValue.replace(Value,Replacement);
 }
 document.querySelector('#settings-nav').setAttribute('aria-label','Settings categories');
 document.querySelector('#download-folder').placeholder='Leave blank to use the default folder';
}
export function SettingsFeedback(Text, Error = false)
{
 const Status=document.querySelector('#save-feedback');
 if(Status){Status.textContent=Text;Status.classList.toggle('error',Error);}
}

/** Presentation binds to the existing production handlers; it never synthesizes API results. */
export async function BindSettingsUI()
{
 const Q=Id=>document.getElementById(Id), T=SettingsText;
 LocalizeSettingsMarkup();
 Q('helper-command').textContent=`.\\native\\kakao\\install.ps1 -ExtensionId ${chrome.runtime.id} -PythonPath <python.exe>`;
 let Section='general';const Dirty=new Set();
 const SetSection=(Value,Push=false)=>{
  Section=ResolveSettingsSection(Value);
  for(const Node of document.querySelectorAll('.settings-section')) Node.hidden=Node.id!=='section-'+Section;
  for(const Link of document.querySelectorAll('[data-section]')){
   if(Link.dataset.section===Section)Link.setAttribute('aria-current','page');else Link.removeAttribute('aria-current');
  }
  const Entry=Sections[Section], Offset=GetLocale().startsWith('ko')?0:2;
  Q('page-title').textContent=Q('breadcrumb').textContent=Entry[Offset];Q('page-description').textContent=Entry[Offset+1];Q('pane-scroll').scrollTop=0;
  Q('save-bar').hidden=['helper','permissions','about'].includes(Section);
  SettingsFeedback(Dirty.has(Section)?T('적용하지 않은 변경사항','Pending changes'):T('변경사항 없음','No pending changes'));
  if(Push){const Url=new URL(location.href);Url.searchParams.set('section',Section);history.pushState(null,'',Url);Q('page-title').focus({preventScroll:true});}
 };
 for(const Link of document.querySelectorAll('[data-section]'))Link.addEventListener('click',Event=>{Event.preventDefault();SetSection(Link.dataset.section,true);});
 window.addEventListener('popstate',()=>SetSection(new URL(location.href).searchParams.get('section')));
 window.addEventListener('settings-navigate',Event=>SetSection(Event.detail?.section,true));
 const UpdateFilename=()=>{Q('filename-example').textContent=FilenameExample(Q('use-page-title').checked,Q('use-download-date-time').checked);};
 for(const Id of ['use-page-title','use-download-date-time'])Q(Id).addEventListener('change',UpdateFilename);
 UpdateFilename();
 const UpdateLocation=()=>{
  const Picked=document.querySelector('[name="locationMode"]:checked')?.value==='picked';Q('relative-location').hidden=Picked;Q('picked-location').hidden=!Picked;
  Q('no-picked-folder').hidden=!Q('picked-download-folder').hidden;
 };
 for(const Radio of document.querySelectorAll('[name="locationMode"]'))Radio.addEventListener('change',async()=>{if(Radio.value==='picked'&&Radio.checked&&!await EnsureHelperForFeature({feature:'folder'})){for(const Other of document.querySelectorAll('[name="locationMode"]'))Other.checked=Other.value==='relative';}UpdateLocation();});
 const Initial=await GetSettings(Object.values(SettingKeys));
 const NativeSupported=typeof window.showDirectoryPicker==='function';
 const PickedRadio=document.querySelector('[name="locationMode"][value="picked"]');
 PickedRadio.disabled=!NativeSupported;
 if(!NativeSupported)PickedRadio.parentElement.title=T('이 브라우저에서는 폴더 직접 선택을 지원하지 않습니다.','This browser does not support choosing a folder.');
 document.querySelector('[name="locationMode"][value="'+(Initial.pickedDownloadFolder&&NativeSupported?'picked':'relative')+'"]').checked=true;
 UpdateLocation();
 window.addEventListener('download-location-default',()=>{
  for(const Radio of document.querySelectorAll('[name="locationMode"]'))Radio.checked=Radio.value==='relative';
  UpdateLocation();Dirty.delete('download');
  if(Section==='download')SettingsFeedback(Q('download-folder-status').textContent);
 });
 window.addEventListener('helper-availability-changed',Event=>{if(Event.detail?.confirmedMissing){Dirty.delete('captions');if(Section==='captions')SettingsFeedback(T('도우미가 없어 음성 인식을 None으로 자동 저장했습니다.','The helper is missing. Speech recognition was reset to None and saved.'));}});
 new MutationObserver(UpdateLocation).observe(Q('picked-download-folder'),{attributes:true,attributeFilter:['hidden'],childList:true});
 Q('use-default-download-folder').addEventListener('click',()=>{document.querySelector('[name="locationMode"][value="relative"]').checked=true;UpdateLocation();});
 Q('browser-download-settings').addEventListener('click',async()=>{
  try{await chrome.tabs.create({url:'chrome://settings/downloads'});}catch{SettingsFeedback(T('브라우저 다운로드 설정을 열지 못했습니다.','Could not open browser download settings.'),true);}
 });
 const SyncPermissions=async()=>{
  try{const Allowed=await chrome.permissions.contains({origins:chrome.runtime.getManifest().optional_host_permissions});Q('all-sites').checked=Allowed;Q('all-sites').disabled=Q('all-sites-access').disabled;Q('permission-scope').textContent=Allowed?T('모든 사이트에 접근을 허용했습니다.','Access to all sites is allowed.'):T('지정한 사이트에만 접근합니다.','Access is limited to approved sites.');}
  catch{Q('all-sites').disabled=true;}
 };
 Q('all-sites').disabled=true;await SyncPermissions();
 Q('all-sites').addEventListener('change',()=>{Q('all-sites-access').click();void SyncPermissions();});
 new MutationObserver(()=>void SyncPermissions()).observe(Q('all-sites-access'),{attributes:true,attributeFilter:['disabled'],childList:true});
 chrome.permissions.onAdded?.addListener(()=>void SyncPermissions());chrome.permissions.onRemoved?.addListener(()=>void SyncPermissions());
 // Existing diagnostic toggles and permissions save immediately; translation and text location are submitted explicitly.
 for(const Form of document.querySelectorAll('.settings-form')){
  Form.addEventListener('submit',Event=>Event.preventDefault());
  Form.addEventListener('input',()=>{Dirty.add(Section);SettingsFeedback(T('적용하지 않은 변경사항','Pending changes'));});
 }
 for(const Id of ['language-status','panel-settings-status','debug-status','download-folder-status','translation-status','youtube-caption-settings-status','download-log-status','local-captions-status']){
  const Node=Q(Id);new MutationObserver(()=>{if(Node.textContent){Node.hidden=false;if(Node.dataset.error!=='true'&&(Id!=='local-captions-status'||Node.dataset.saved==='true'))Dirty.delete(Node.closest('.settings-section')?.id.replace('section-',''));SettingsFeedback(Node.textContent,Node.dataset.error==='true');}}).observe(Node,{childList:true,subtree:true});
 }
 Q('apply-settings').addEventListener('click',async()=>{
  if(Q('section-'+Section)?.querySelector('form[aria-busy="true"]')){SettingsFeedback(T('로딩 중입니다. 처리가 끝날 때까지 기다려 주세요.','Loading. Please wait for the current operation to finish.'));return;}
  if(Section==='captions'){Q('local-captions-form').requestSubmit();return;}
  if(Section==='translation'){Q('translation-form').requestSubmit();return;}
  if(Section==='download'){
   const Picked=document.querySelector('[name="locationMode"]:checked')?.value==='picked';
   const Current=await GetSettings([SettingKeys.pickedDownloadFolder]);
   if(Picked&&!Current.pickedDownloadFolder){Q('pick-download-folder').click();return;}
   if(!Picked&&!Q('download-folder').value&&Current.pickedDownloadFolder){Q('use-default-download-folder').click();return;}
   Q('download-folder-form').requestSubmit();return;
  }
  // Persist the values represented by this section and only announce after storage resolves.
  const Fields=Section==='general'?[[SettingKeys.language,'language',false],[SettingKeys.showPanelMedia,'show-panel-media',true],[SettingKeys.showPanelMediaResize,'show-panel-media-resize',true]]:[[SettingKeys.debugDownloads,'debug-downloads',true],[SettingKeys.debugLogging,'debug-logging',true],[SettingKeys.logDownloads,'log-downloads',true]];
  Q('apply-settings').disabled=true;
  try{for(const [Key,Id,Boolean] of Fields)await SetSetting(Key,Boolean?Q(Id).checked:Q(Id).value);Dirty.delete(Section);SettingsFeedback(T('설정을 적용했습니다.','Settings applied.'));}
  catch{SettingsFeedback(T('설정을 적용하지 못했습니다. 다시 시도하세요.','Could not apply settings. Try again.'),true);}
  finally{Q('apply-settings').disabled=false;}
 });
 Q('reset-settings').addEventListener('click',async()=>{
  if(Section==='captions'){Q('local-captions-form').dispatchEvent(new Event('settings-reset'));return;}
  if(Section==='translation'){Q('translation-form').dispatchEvent(new Event('settings-reset'));return;}
  try{
   const Saved=await GetSettings(Object.values(SettingKeys));
   for(const [Key,Id] of [['showPanelMedia','show-panel-media'],['showPanelMediaResize','show-panel-media-resize'],['usePageTitle','use-page-title'],['useDownloadDateTime','use-download-date-time'],['debugDownloads','debug-downloads'],['debugLogging','debug-logging'],['logDownloads','log-downloads']])Q(Id).checked=Saved[SettingKeys[Key]];
   Q('language').value=Saved.language;Q('download-folder').value=Saved.downloadFolder;Q('download-folder').setCustomValidity('');
   document.querySelector('[name="locationMode"][value="'+(Saved.pickedDownloadFolder&&NativeSupported?'picked':'relative')+'"]').checked=true;
   UpdateLocation();UpdateFilename();Dirty.delete(Section);SettingsFeedback(T('저장된 설정을 다시 불러왔습니다.','Restored the saved settings.'));
  }catch{SettingsFeedback(T('저장된 설정을 읽지 못했습니다.','Could not read saved settings.'),true);}
 });
 const Store=DistributionPolicy.flavor!=='development';Q('build-badge').textContent=Store?T('스토어판','Store build'):T('개발판','Development');Q('about-build').textContent=DistributionPolicy.flavor==='edge-store'?'Microsoft Edge Add-ons':Store?T('Chrome 웹 스토어판','Chrome Web Store'):T('개발판 · 수동 설치','Development · Manual install');
 Q('about-policy').textContent=CanUseYoutube()?T('이 배포판에서는 YouTube 다운로드를 사용할 수 있습니다.','This distribution supports YouTube downloads.'):T('이 배포판에서는 YouTube 다운로드를 지원하지 않습니다.','This distribution does not support YouTube downloads.');Q('about-policy').classList.toggle('policy-emphasis',!CanUseYoutube());Q('youtube-caption-settings').hidden=!CanUseYoutube();
 SetSection(new URL(location.href).searchParams.get('section'));
}
