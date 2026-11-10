import {CreateElement,CreateButton} from './lib/ui.js';
import {Translate,ErrorText} from './lib/i18n.js';
import {RemoveExplorerInstallation,ReconcileExplorerRemoval,ExplorerRemovalKey} from './lib/explorer-lifecycle.js';
import {DownloadExplorerInstaller} from './lib/explorer-installer.js';
import {SubscribeHelperAvailability,CurrentHelperAvailability} from './lib/helper-availability.js';
export async function ConfirmExplorerRemoval(){
	return new Promise(Resolve=>{
		const Dialog=CreateElement('dialog','','download-options-dialog explorer-setup-dialog common-helper-setup-dialog'),Form=CreateElement('form');
		const Title=CreateElement('h2',Translate('explorer_remove_title'));Title.id='explorer-remove-'+crypto.randomUUID();Dialog.setAttribute('aria-labelledby',Title.id);
		const Header=CreateElement('header');Header.append(Title);
		const Body=CreateElement('div','','download-options-body explorer-setup-body'),Text=CreateElement('p',Translate('explorer_remove_body')),Note=CreateElement('p',Translate('explorer_remove_keep'),'muted');Body.append(Text,Note);
		const Cancel=CreateButton(Translate('html_cancel'),()=>Dialog.close());Cancel.autofocus=true;
		const Confirm=CreateButton(Translate('explorer_remove_confirm'),()=>Dialog.close('remove'),true);Confirm.classList.add('danger');
		const Footer=CreateElement('footer');Footer.append(Cancel,Confirm);Form.append(Header,Body,Footer);Dialog.append(Form);document.body.append(Dialog);
		Dialog.addEventListener('close',()=>{const Accepted=Dialog.returnValue==='remove';Dialog.returnValue='';Dialog.remove();Resolve(Accepted);},{once:true});Dialog.showModal();
	});
}
export async function BindExplorerRemoval(){
	const Root=document.querySelector('#explorer-helper-management'),Button=document.querySelector('#remove-explorer-helper'),Status=document.querySelector('#explorer-helper-status');
	const Platform=(await chrome.runtime.getPlatformInfo()).os;
	if(!Root||!Button||!Status||!['win','mac'].includes(Platform))return;
	if(Root.dataset.removalBound)return;Root.dataset.removalBound='true';
	Root.hidden=false;let Busy=false,Timer,Until,LegacyId,Revision=0;
	const LocationForm=document.querySelector('#download-folder-form');
 function SetBusy(Value){Busy=Value;Root.dataset.removing=String(Value);if(LocationForm)LocationForm.inert=Value;window.dispatchEvent(new Event('helper-removal-state'));}
	function Refresh(State){
		if(Busy&&State.confirmedMissing){void Finished();return;}
		if(document.querySelector('#section-helper')?.getAttribute('aria-busy')==='true'){Button.disabled=true;return;}
		if(Busy||LegacyId!==undefined)return;
		Button.disabled=!State.connected||(Platform==='mac'&&!State.canUninstall);
		Status.textContent=!State.checked?Status.textContent:!State.connected?Translate('explorer_remove_absent'):State.canUninstall?Translate('explorer_remove_available'):Translate('explorer_remove_update_required');
  Status.classList.toggle('error',State.checked&&!State.connected);Status.dataset.error=String(State.checked&&!State.connected);
	}
	async function Finished(){
		Revision++;clearInterval(Timer);SetBusy(false);LegacyId=undefined;Button.disabled=true;Button.textContent=Translate('explorer_remove_button');Status.textContent=Translate('explorer_remove_done');Status.classList.add('error');Status.dataset.error='true';
		const Event=new CustomEvent('download-location-default');window.dispatchEvent(Event);
	}
	chrome.storage.onChanged.addListener((Changes,Area)=>{if(Area==='local'&&Changes[ExplorerRemovalKey]?.newValue)void Finished();});
	Button.addEventListener('click',async()=>{
		if(LegacyId!==undefined){
			try{if(!await chrome.permissions.request({permissions:['downloads.open']}))throw Error(Translate('view_permission_denied'));await chrome.downloads.open(LegacyId);Status.textContent=Translate('explorer_remove_pending');}catch{await chrome.downloads.show(LegacyId);Status.textContent=Translate('explorer_remove_run_help');}
			return;
		}
		if(Busy||!await ConfirmExplorerRemoval())return;
		Revision++;SetBusy(true);Button.disabled=true;Status.classList.remove('error');Status.dataset.error='false';Status.textContent=Translate('explorer_remove_pending');
		try{
			const Result=await RemoveExplorerInstallation();
			if(Result.removed){await Finished();return;}
			if(Result.legacy){LegacyId=await DownloadExplorerInstaller(Result.token);SetBusy(false);Button.disabled=false;Button.textContent=Translate('explorer_remove_run');Status.textContent=Translate('explorer_remove_run_help');return;}
			Until=Date.now()+45000;
			let Checking=false;
			Timer=setInterval(async()=>{if(Checking)return;Checking=true;try{if(await ReconcileExplorerRemoval())return;if(Date.now()>Until){clearInterval(Timer);SetBusy(false);Button.disabled=false;Status.textContent=Translate('explorer_remove_failed');}}finally{Checking=false;}},1500);
		}catch(ErrorValue){SetBusy(false);Button.disabled=false;Status.textContent=ErrorText(ErrorValue);}
	});
	SubscribeHelperAvailability(Refresh);
 window.addEventListener('helper-operation-state',()=>Refresh(CurrentHelperAvailability()));
}
