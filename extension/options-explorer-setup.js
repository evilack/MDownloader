import {CreateElement,CreateButton} from './lib/ui.js';
import {Translate,ErrorText} from './lib/i18n.js';
import {ConnectExplorer} from './lib/explorer-bridge.js';
import {DownloadExplorerInstaller} from './lib/explorer-installer.js';

/** Called before the directory picker: a cancel cannot change the saved handle. */
export async function BeforePickDownloadFolder()
{
	if((await chrome.runtime.getPlatformInfo()).os!=='win')return true;
	if(await chrome.permissions.contains({permissions:['nativeMessaging']})){
		try {if((await ConnectExplorer()).connected)return true;}catch{}
	}
	return new Promise(Resolve=>{
		const Dialog=CreateElement('dialog','','download-options-dialog explorer-setup-dialog'),Form=CreateElement('form');
		const Header=CreateElement('header'),Title=CreateElement('h2',Translate('explorer_setup_title'));
		Title.id='explorer-setup-'+crypto.randomUUID();Dialog.setAttribute('aria-labelledby',Title.id);Header.append(Title);
		const Body=CreateElement('div','','download-options-body explorer-setup-body'),Status=CreateElement('p',Translate('explorer_setup_body'),'notice');
		const Question=CreateElement('p',Translate('explorer_setup_question')),Note=CreateElement('p',Translate('explorer_setup_cancel'),'muted explorer-setup-note');
		Status.setAttribute('role','status');Body.append(Status,Question,Note);
		let Id,Busy=false,Ready=false,Waiting=false,ShowInstaller=false,OpenTimer,Timer,Checking=false,Deadline;
		const Cancel=CreateButton(Translate('html_cancel'),()=>Dialog.close());Cancel.autofocus=true;
		async function Check(){
			if(!Dialog.open||Checking||!Deadline)return;
			if(Date.now()>Deadline){clearInterval(Timer);return;}
			Checking=true;
			try {if((await ConnectExplorer()).connected&&Dialog.open){Ready=true;Waiting=false;clearInterval(Timer);clearTimeout(OpenTimer);Status.textContent=Translate('explorer_setup_ready');Confirm.textContent=Translate('explorer_setup_continue');Confirm.disabled=false;}}catch{}
			finally{Checking=false;}
		}
		const Confirm=CreateButton(Translate('explorer_setup_install'),async()=>{
			if(ShowInstaller&&!Ready){
				try{await chrome.downloads.show(Id);Status.textContent=Translate('explorer_setup_file_help');Deadline=Date.now()+120000;clearInterval(Timer);Timer=setInterval(()=>void Check(),1000);}catch(ErrorValue){Status.textContent=ErrorText(ErrorValue);}
				return;
			}
			if(Ready){Dialog.close('ready');return;}if(Busy)return;Busy=true;Confirm.disabled=true;
			try {
				if(Id!==undefined){
					// Keep this call directly on the fresh click: downloads.open requires a gesture.
					const Opening=chrome.downloads.open(Id);
					Waiting=true;Status.textContent=Translate('explorer_setup_installing');Confirm.textContent=Translate('explorer_setup_pending');
					OpenTimer=setTimeout(()=>{if(Dialog.open&&!Ready&&Waiting){ShowInstaller=true;Confirm.disabled=false;Confirm.textContent=Translate('explorer_setup_show');Status.textContent=Translate('explorer_setup_delayed');}},10000);
					Deadline=Date.now()+120000;clearInterval(Timer);Timer=setInterval(()=>void Check(),1000);
					try{await Opening;}catch{clearTimeout(OpenTimer);if(Dialog.open&&!Ready){Waiting=false;ShowInstaller=true;Status.textContent=Translate('explorer_setup_manual');Confirm.textContent=Translate('explorer_setup_show');}}
					await Check();return;
				}
				if(!await chrome.permissions.request({permissions:['nativeMessaging','downloads.open']}))throw Error(Translate('view_permission_denied'));
				if(!Dialog.open)return;
				try{if((await ConnectExplorer()).connected&&Dialog.open){Dialog.close('ready');return;}}catch{}
				Question.hidden=Note.hidden=true;Status.textContent=Translate('explorer_setup_downloading');
				if(Id===undefined)Id=await DownloadExplorerInstaller();
				if(!Dialog.open)return;
				Status.textContent=Translate('explorer_setup_downloaded');Confirm.textContent=Translate('explorer_setup_open');
			} catch(ErrorValue){if(Dialog.open){Status.textContent=ErrorText(ErrorValue);Status.dataset.error='true';}}
			finally{Busy=false;Confirm.disabled=Waiting&&!Ready&&!ShowInstaller;}
		},true);
		const Footer=CreateElement('footer');Footer.append(Cancel,Confirm);Form.append(Header,Body,Footer);Dialog.append(Form);document.body.append(Dialog);
		const Refocus=()=>{if(Dialog.open&&Waiting){Deadline=Date.now()+120000;clearInterval(Timer);Timer=setInterval(()=>void Check(),1000);void Check();}};
		window.addEventListener('focus',Refocus);
		Dialog.addEventListener('close',()=>{clearInterval(Timer);clearTimeout(OpenTimer);window.removeEventListener('focus',Refocus);const Accepted=Dialog.returnValue==='ready';Dialog.remove();Resolve(Accepted);},{once:true});
		Dialog.showModal();
	});
}
