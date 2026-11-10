import {CreateElement,CreateButton} from './lib/ui.js';
import {GetLocale} from './lib/i18n.js';
const T=(Ko,En)=>GetLocale().startsWith('ko')?Ko:En;
export function CreateSettingsDialog(Heading)
{
 const dialog=CreateElement('dialog','','common-helper-setup-dialog settings-action-dialog'),form=CreateElement('form'),header=CreateElement('header'),title=CreateElement('h2',Heading),body=CreateElement('div','','explorer-setup-body'),footer=CreateElement('footer');
 title.id='settings-dialog-'+crypto.randomUUID();dialog.setAttribute('aria-labelledby',title.id);header.append(title);form.append(header,body,footer);dialog.append(form);document.body.append(dialog);
 return {dialog,body,footer};
}
export function ShowSettingsDialog({title,message,confirmText=T('확인','OK'),cancelText=T('취소','Cancel'),danger=false,noticeOnly=false})
{
 const {dialog,body,footer}=CreateSettingsDialog(title);body.append(CreateElement('p',message));
 return new Promise(Resolve=>{
  const confirm=CreateButton(confirmText,()=>dialog.close('confirm'),true);
  if(danger)confirm.classList.add('danger');
  if(!noticeOnly){const cancel=CreateButton(cancelText,()=>dialog.close());cancel.autofocus=danger;footer.append(cancel);}
  confirm.autofocus=!danger||noticeOnly;footer.append(confirm);
  dialog.addEventListener('close',()=>{const Accepted=dialog.returnValue==='confirm';dialog.returnValue='';dialog.remove();Resolve(Accepted);},{once:true});dialog.showModal();
 });
}
/** Shared temporary overlay for asynchronous settings checks. */
export function ShowSettingsLoading()
{
 const {dialog,body,footer}=CreateSettingsDialog(T('로딩 중','Loading'));
 const Message=CreateElement('p',T('필요한 정보를 확인하고 있습니다. 잠시 기다려 주세요.','Checking the required information. Please wait.'));
 const Progress=CreateElement('progress','','helper-setup-progress');Progress.max=1;Progress.removeAttribute('value');Progress.setAttribute('aria-label',T('로딩 중','Loading'));
 body.append(Message,Progress);footer.remove();
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 return {close(){if(dialog.open)dialog.close();}};
}
