import {StartHelperAvailability,RefreshHelperAvailability} from './helper-availability.js';
const AlarmName='mdownloader-helper-availability';
let Started=false,Updating,Again=false;
const NeedsHelper=Saved=>!!(Saved.pickedDownloadFolder||Saved.localCaptions?.enabled||Saved.localCaptions?.engine&&Saved.localCaptions.engine!=='none');
async function Configured(){return NeedsHelper(await chrome.storage.local.get(['pickedDownloadFolder','localCaptions']));}
async function Schedule(){
 if(Updating){Again=true;return Updating;}
 Updating=(async()=>{do{Again=false;if(await Configured()){StartHelperAvailability();if(chrome.alarms)await chrome.alarms.create(AlarmName,{periodInMinutes:1});}else if(chrome.alarms)await chrome.alarms.clear(AlarmName);}while(Again);})();
 try{await Updating;}finally{Updating=undefined;}
}
export function StartHelperMonitor(){
 if(Started)return;Started=true;
 chrome.storage.onChanged.addListener((Changes,Area)=>{if(Area==='local'&&(Changes.localCaptions||Changes.pickedDownloadFolder))void Schedule().catch(()=>{});});
 chrome.alarms?.onAlarm.addListener(Alarm=>{if(Alarm.name===AlarmName)void (async()=>{if(await Configured())await RefreshHelperAvailability({force:true});else await Schedule();})().catch(()=>{});});
 void Schedule().catch(()=>{});
}
/** Before a new job snapshots defaults, confirm a genuinely missing registration. */
export async function RefreshHelperForDownload(){
 if(!await Configured())return;
 let State=await RefreshHelperAvailability({force:true});
 for(let Count=0;Count<2&&State.reason==='missing'&&!State.confirmedMissing;Count++){
  await new Promise(Resolve=>setTimeout(Resolve,1100));State=await RefreshHelperAvailability({force:true});
 }
}
