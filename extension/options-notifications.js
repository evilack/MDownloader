import {SetSetting,SettingKeys} from './lib/settings.js';
import {Translate,LocalizedError,ErrorText} from './lib/i18n.js';
const Controls=[[SettingKeys.notifyDownloadComplete,'#notify-download-complete','opt_notify_complete'],[SettingKeys.notifyScheduledStart,'#notify-scheduled-start','opt_notify_scheduled_start']];
export async function SetNotificationOption(Key,Enabled){
	if(!Controls.some(([K])=>K===Key)||typeof Enabled!=='boolean')throw new TypeError('Invalid notification setting');
	if(Enabled){
		// Keep this API call inside the checkbox gesture, before any other await.
		if(!await chrome.permissions.request({permissions:['notifications']}))throw new LocalizedError('opt_notifications_permission_denied');
		if(!chrome.notifications||await chrome.notifications.getPermissionLevel()!=='granted')throw new LocalizedError('opt_notifications_blocked');
	}
	await SetSetting(Key,Enabled);
}
export function BindNotificationOptions(Settings){
	const Status=document.querySelector('#notification-settings-status');
	for(const [Key,Selector,LabelKey]of Controls){
		const Input=document.querySelector(Selector),Label=Translate(LabelKey);
		if(!Settings){Status.textContent=Translate('opt_setting_read_failed',Label);continue;}
		Input.checked=Settings[Key];Input.disabled=false;
		Input.addEventListener('change',async()=>{
			const Enabled=Input.checked;Input.disabled=true;
			try{await SetNotificationOption(Key,Enabled);Status.textContent=Translate(Enabled?'opt_setting_enabled':'opt_setting_disabled',Label);}
			catch(ErrorValue){Input.checked=!Enabled;Status.textContent=ErrorValue instanceof LocalizedError?ErrorText(ErrorValue):Translate('opt_setting_save_failed',Label);}
			finally{Input.disabled=false;}
		});
	}
}
