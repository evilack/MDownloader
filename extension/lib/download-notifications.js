import {GetSettings,SettingKeys} from './settings.js';
import {InitializeLocale,Translate} from './i18n.js';
import {IconCatalog} from './icon-catalog.js';
import {JobIdFromKey,JobKey,ReadJob,ListStoredJobs} from './job-storage.js';
import {GetBrowserDownload,SummarizeJob} from './browser-job-state.js';
import {NotificationViewPort,NotificationViewRefresh} from './notification-view.js';

const MarkerKey=Id=>'downloadNotice:'+Id;
const Page=(Context,Root,Name)=>Context.documentUrl?.split(/[?#]/)[0]===Root+Name;
export function ShouldNotifyCompletion(RequestId,Contexts,Views,Root){
	if(Contexts.some(C=>C.contextType==='SIDE_PANEL'&&Page(C,Root,'sidepanel.html')))return false;
	return !Contexts.some(C=>C.contextType==='POPUP'&&Page(C,Root,'popup.html'))||
		!Object.values(Views).some(V=>V.visible===true&&Array.isArray(V.requestIds)&&V.requestIds.includes(RequestId));
}

/** Background-owned events; handled claims survive worker restarts, UI views do not survive Chrome. */
export function CreateDownloadNotifications({waitForUi=()=>new Promise(R=>setTimeout(R,200)),initializeLocale=InitializeLocale}={}){
	let Queue=Promise.resolve();const Views=new Map();
	const Enqueue=Work=>{const Pending=Queue.then(Work);Queue=Pending.catch(()=>{});return Pending;};
	const Contexts=()=>chrome.runtime.getContexts({contextTypes:['POPUP','SIDE_PANEL']});
	async function Marker(Id){return(await chrome.storage.local.get(MarkerKey(Id)))[MarkerKey(Id)]??{};}
	async function Claim(Job,Event){
		const State=await Marker(Job.requestId);if(State[Event])return false;
		await chrome.storage.local.set({[MarkerKey(Job.requestId)]:{...State,[Event]:true}});return true;
	}
	async function Notify(Job,Event){
		if(!await Claim(Job,Event))return;
		const Key=Event==='complete'?SettingKeys.notifyDownloadComplete:SettingKeys.notifyScheduledStart;
		if(!(await GetSettings([Key]))[Key]||!await chrome.permissions.contains({permissions:['notifications']}))return;
		try{
			if(!chrome.notifications||await chrome.notifications.getPermissionLevel()!=='granted')return;
			if(Event==='complete'){
				await waitForUi();
				// Popup message senders need not contain documentId. Refresh a live port
				// and await its acknowledgement, including after worker suspension.
				try{await chrome.runtime.sendMessage({type:NotificationViewRefresh});}catch{}
				if(!await ReadJob(JobKey(Job.requestId)))return;
				if(!ShouldNotifyCompletion(Job.requestId,await Contexts(),Object.fromEntries(Views),chrome.runtime.getURL('')))return;
			}
			await initializeLocale();
			const Filename=String(Job.filename??'').split(/[\\/]/).at(-1).replace(/[\r\n\t]/g,' ').slice(0,200)||Translate('notification_file_fallback');
			await chrome.notifications.create('mdownloader:'+Event+':'+Job.requestId,{
				type:'basic',iconUrl:chrome.runtime.getURL(IconCatalog.app[128]),
				title:Translate(Event==='complete'?'notification_complete_title':'notification_scheduled_start_title'),message:Filename,
			});
		}catch{/* A notification never owns or fails the download. */}
	}
	async function ChangedJob(Id,Previous,Next,CheckCompletion){
		const Job=await ReadJob(JobKey(Id));if(!Job)return;
		let State=await Marker(Id);
		if((Previous?.waiting||Next.waiting||Job.scheduled)&&!State.scheduled){
			State={...State,scheduled:true};await chrome.storage.local.set({[MarkerKey(Id)]:State});
		}
		if(State.scheduled&&!Next.snapshot&&Next.state==='active'&&!Next.waiting&&Next.bytesReceived>0)await Notify({...Next,requestId:Id},'start');
		if(!CheckCompletion)return;
		const Item=Number.isInteger(Job.downloadId)?await GetBrowserDownload(Job.downloadId):null;
		if(!Item&&!Job.pickedDownloadFolder)return;
		const Summary=SummarizeJob({...Job,requestId:Id},Item);
		if(Summary.state==='complete')await Notify(Summary,'complete');
	}
	return{
		storageChanged(Changes,Area){
			if(Area!=='local')return Promise.resolve();const Pending=[];
			for(const [Key,{oldValue:Old,newValue:Next}]of Object.entries(Changes)){
				const Id=JobIdFromKey(Key);if(!Id)continue;
				if(!Next){Pending.push(Enqueue(()=>chrome.storage.local.remove(MarkerKey(Id))));continue;}
				const CaptionFinished=Next.captionPipeline==='staged'&&Next.captionStatus?.phase==='complete'&&Old?.captionStatus?.phase!=='complete';
				if(Old?.state==='complete'&&Next.state==='complete'&&!CaptionFinished)continue;
				const CheckCompletion=CaptionFinished||Next.state==='complete'||Number.isInteger(Next.downloadId)&&Next.downloadId!==Old?.downloadId;
				if(CheckCompletion||Next.waiting!==Old?.waiting||Next.bytesReceived>0&&!(Old?.bytesReceived>0))
					Pending.push(Enqueue(()=>ChangedJob(Id,Old,Next,CheckCompletion)));
			}
			return Promise.all(Pending);
		},
		downloadChanged(Change){
			if(Change.state?.current!=='complete')return Promise.resolve();
			return Enqueue(async()=>{
				const Item=await GetBrowserDownload(Change.id);if(!Item||Item.state!=='complete')return;
				for(const Job of await ListStoredJobs())if(Job.downloadId===Change.id){
					const Summary=SummarizeJob(Job,Item);if(Summary.state==='complete')await Notify(Summary,'complete');
				}
			});
		},
		connectView(Port){
			const Sender=Port.sender??{};
			const Root=chrome.runtime.getURL('');
			if(Port.name!==NotificationViewPort||Sender.id!==chrome.runtime.id||Sender.url!==Root+'popup.html')return false;
			const Id=crypto.randomUUID();
			Port.onMessage.addListener(Message=>{
				if(typeof Message.visible!=='boolean'||!Number.isSafeInteger(Message.serial)||!Array.isArray(Message.requestIds)||Message.requestIds.length>2048||Message.requestIds.some(R=>typeof R!=='string'||!R||R.length>128))return;
				Views.set(Id,{visible:Message.visible,requestIds:[...new Set(Message.requestIds)]});
				try{Port.postMessage({ack:Message.serial});}catch{}
			});
			Port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;Views.delete(Id);});return true;
		},
	};
}
