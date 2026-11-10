import {CreateElement,CreateButton} from './lib/ui.js';
import {Translate,GetLocale} from './lib/i18n.js';
import {ProbeCommonHelper} from './lib/common-helper.js';
import {CreateHelperInstallerLink} from './lib/helper-installer-link.js';
import {ShowSettingsDialog} from './settings-dialog.js';
const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;

/** Download is a direct user-selected link; installation is checked only on request. */
export function ShowCommonHelperSetup({platform='win',update=false,probe=ProbeCommonHelper}={})
{
 return new Promise(Resolve=>{
  const Dialog=CreateElement('dialog','','download-options-dialog explorer-setup-dialog common-helper-setup-dialog'),Form=CreateElement('form');
  const Header=CreateElement('header'),Title=CreateElement('h2',update?T('MDownloader 도우미 업데이트','Update MDownloader helper'):Translate('explorer_setup_title'));
  Title.id='helper-setup-'+crypto.randomUUID();Dialog.setAttribute('aria-labelledby',Title.id);Header.append(Title);
  const Body=CreateElement('div','','download-options-body explorer-setup-body'),Kind=platform==='mac'?'PKG':'CMD';
  const Guide=CreateElement('p',T('아래 링크를 눌러 '+Kind+' 파일을 다운로드한 뒤 실행해 주세요. 이후 설치확인을 눌러 주세요.','Download the '+Kind+' file from the link below and run it. When installation finishes, choose Verify installation.'));
  const Link=CreateElement('a',T('다운로드 링크 준비 중…','Preparing download link…'),'helper-installer-link');Link.setAttribute('aria-disabled','true');
  const Note=CreateElement('p',T('브라우저가 다운로드를 차단할 수 있습니다. 진행되지 않으면 다운로드 목록에서 차단 여부를 확인해 주세요.','Your browser may block the download. If it does not start, check the downloads list for a blocked file.'),'muted explorer-setup-note');
  const Downloads=CreateElement('a',T('브라우저 다운로드 목록 열기','Open browser downloads'),'helper-installer-link');Downloads.href='chrome://downloads/';Downloads.addEventListener('click',Event=>{Event.preventDefault();void chrome.tabs.create({url:'chrome://downloads/'}).catch(()=>{});});
  const Status=CreateElement('p','','notice');Status.setAttribute('role','status');Status.hidden=true;
  const Progress=CreateElement('progress','','helper-setup-progress');Progress.max=1;Progress.removeAttribute('value');Progress.hidden=true;Progress.setAttribute('aria-label',T('도우미 설치 확인 중','Verifying helper installation'));
  Body.append(Guide,Link,Note,Downloads,Status,Progress);
  let Closed=false,Busy=false,Resource;
  Link.addEventListener('click',Event=>{if(!Resource||Busy){Event.preventDefault();return;}Status.hidden=false;Status.dataset.error='false';Status.textContent=T('다운로드한 파일을 실행하고, 설치가 끝나면 설치확인을 눌러 주세요.','Run the downloaded file, then choose Verify installation when setup finishes.');});
  const Cancel=CreateButton(Translate('html_cancel'),()=>Dialog.close());
  const Confirm=CreateButton(T('설치확인','Verify installation'),async()=>{
   if(Busy||Closed)return;Busy=true;Confirm.disabled=true;Link.setAttribute('aria-disabled','true');Confirm.textContent=T('설치 확인 중…','Verifying installation…');Progress.hidden=false;Status.hidden=false;Status.dataset.error='false';Status.textContent=T('설치된 도우미를 확인하고 있습니다. 잠시 기다려 주세요.','Checking the installed helper. Please wait.');Form.setAttribute('aria-busy','true');
   try{
    const Permissions={permissions:['nativeMessaging']};
    let Result;
    if(!await chrome.permissions.contains(Permissions)&&!await chrome.permissions.request(Permissions))Result={connected:false,ready:false,reason:'permission'};
    else{try{Result=await probe();}catch(ErrorValue){Result={connected:false,ready:false,reason:ErrorValue?.reason||'unavailable'};}}
    if(Closed)return;
    const Ready=Result?.ready===true||(Result?.ready===undefined&&Result?.connected===true);
    Progress.hidden=true;Confirm.textContent=T('확인 완료','Check complete');Form.setAttribute('aria-busy','false');
    if(Ready){
     Status.textContent=T('도우미 설치를 확인했습니다.','Helper installation verified.');
     await ShowSettingsDialog({title:T('설치 완료','Installation complete'),message:T('도우미 설치가 확인되었습니다. 확인을 누르면 필요한 기능 준비를 이어갑니다.','The helper is installed. Choose OK to continue preparing the required features.'),noticeOnly:true});
     if(!Closed)Dialog.close('ready');return;
    }
    const Previous=Result?.connected||Result?.reason==='update-required';
    const Message=Previous?T('이전 버전 도우미가 설치되어 있습니다. 이 창의 링크로 받은 새 '+Kind+' 파일을 실행한 뒤 다시 설치확인을 눌러 주세요.','An older helper is installed. Run the new '+Kind+' file from this window’s download link, then choose Verify installation again.'):Result?.reason==='permission'?T('도우미 확인 권한이 허용되지 않았습니다. 권한을 허용한 뒤 설치확인을 다시 눌러 주세요.','Permission to check the helper was not granted. Allow access, then choose Verify installation again.'):Result?.reason==='timeout'?T('도우미가 응답하지 않아 설치를 확인하지 못했습니다. 설치 파일 실행이 끝났는지 확인한 뒤 다시 시도해 주세요.','The helper did not respond. Wait for the installer to finish, then try verification again.'):T('도우미 설치를 확인하지 못했습니다. 이 창의 링크로 '+Kind+' 파일을 다시 받아 실행한 뒤 설치확인을 눌러 주세요.','The helper installation could not be verified. Download and run the '+Kind+' file from this window, then choose Verify installation.');
    Status.dataset.error='true';Status.textContent=Message;
    await ShowSettingsDialog({title:T('다시 설치해 주세요','Please install again'),message:Message,noticeOnly:true});
   }catch{
    if(Closed)return;Progress.hidden=true;Status.dataset.error='true';Status.textContent=T('설치를 확인하지 못했습니다. 설치 파일을 다시 실행한 뒤 설치확인을 눌러 주세요.','Installation could not be verified. Run the installer again, then choose Verify installation.');
    await ShowSettingsDialog({title:T('다시 설치해 주세요','Please install again'),message:Status.textContent,noticeOnly:true});
   }finally{
    Busy=false;Confirm.disabled=false;Confirm.textContent=T('설치확인','Verify installation');Progress.hidden=true;Form.setAttribute('aria-busy','false');if(Resource)Link.removeAttribute('aria-disabled');
   }
  },true);Confirm.autofocus=true;
  const Footer=CreateElement('footer');Footer.append(Cancel,Confirm);Form.append(Header,Body,Footer);Dialog.append(Form);document.body.append(Dialog);
  Dialog.addEventListener('close',()=>{Closed=true;const Accepted=Dialog.returnValue==='ready';Dialog.returnValue='';Dialog.remove();if(Resource)setTimeout(()=>Resource.revoke(),1000);Resolve(Accepted);},{once:true});
  Dialog.showModal();
  void CreateHelperInstallerLink(platform).then(Value=>{
   if(Closed){Value.revoke();return;}Resource=Value;Link.href=Value.url;Link.download=Value.filename;if(!Busy)Link.removeAttribute('aria-disabled');Link.textContent=Value.filename+T(' 다운로드',' — Download');
  }).catch(()=>{if(Closed)return;Link.textContent=T('다운로드 링크를 준비하지 못했습니다. 이 창을 닫고 도우미 설치를 다시 눌러 주세요.','Could not prepare the download link. Close this window and choose Install helper again.');Link.classList.add('error');});
 });
}
