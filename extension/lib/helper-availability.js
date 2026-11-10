import {RequestExplorer} from './explorer-native.js';
import {CommonHelperConnected,CommonHelperReady} from './common-helper-contract.js';

// This is the common helper's status. A retained captions host never makes it connected.
const RecordKey='helperAvailability',RemovalKey='explorerHelperRemoval',EvidenceKey='helperMissingEvidence';
const Listeners=new Set();
let State={connected:false,ready:false,confirmedMissing:false,checked:false,reason:'unknown'},Pending,Started=false,Timer,Failures=0,LastFailure=0,Revision=0,RemovalPending,LastNotice=0;
const Emit=(Name,Detail)=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(Name,{detail:Detail}));};
function Publish(Value){State={...State,...Value};for(const Listener of Listeners){try{Listener({...State});}catch{}}Emit('helper-availability-changed',{...State});return {...State};}
export function CurrentHelperAvailability(){return {...State};}
export function SubscribeHelperAvailability(Listener){Listeners.add(Listener);Listener({...State});return ()=>Listeners.delete(Listener);}

/** Reset future defaults only; installed caption engines/models and running jobs remain intact. */
export async function ResetHelperDependentSettings(){
 const Saved=await chrome.storage.local.get(['pickedDownloadFolder','downloadFolder','localCaptions']);
 const Captions=Saved.localCaptions&&typeof Saved.localCaptions==='object'?Saved.localCaptions:{};
 const Depended=!!(Saved.pickedDownloadFolder||Captions.enabled||Captions.model||Captions.engine&&Captions.engine!=='none');
 const Changed=Saved.pickedDownloadFolder!==null||Saved.downloadFolder!==''||Captions.enabled!==false||Captions.engine!=='none'||Captions.model!=='';
 if(Changed)await chrome.storage.local.set({pickedDownloadFolder:null,downloadFolder:'',localCaptions:{...Captions,enabled:false,engine:'none',model:''}});
 if(Changed)Emit('download-location-default');
 return {changed:Changed,depended:Depended};
}
function RemovedNotice(Record){
 if(!Record?.removedAt||Record.removedAt<=LastNotice)return;
 LastNotice=Record.removedAt;Emit('helper-removed',{...State,...Record});
}
/** Call only after an authenticated uninstall receipt or confirmed missing-host evidence. */
export async function MarkHelperRemoved({reason='removed',notify=true}={}){
 if(RemovalPending)return RemovalPending;
 RemovalPending=(async()=>{
  ++Revision;Failures=0;
  const Saved=await chrome.storage.local.get(RecordKey),Previous=Saved[RecordKey];
  const Reset=await ResetHelperDependentSettings();
  const SameRemoval=Previous?.connected===false&&!!Previous?.removedAt;
  const RemovedAt=SameRemoval?Previous.removedAt:Date.now();
  // Keep an unread notice across worker restarts and later missing observations.
  // The UI acknowledges helperRemovalNoticeSeen separately; it owns when to show it.
  const Record={connected:false,removedAt:RemovedAt,reason,notify:(SameRemoval&&Previous.notify===true)||(notify&&(Previous?.connected===true||Reset.depended||reason==='removed'))};
  Publish({connected:false,ready:false,checked:true,confirmedMissing:true,reason,checkedAt:Date.now()});
  await chrome.storage.local.set({[RecordKey]:Record});
  if(Record.notify)RemovedNotice(Record);
  return {...State};
 })();
 try{return await RemovalPending;}finally{RemovalPending=undefined;}
}
/** Missing means the native registration is absent, not permission denial, timeout or crash. */
export async function RefreshHelperAvailability({force=false}={}){
 if(Pending)return Pending;
 if(!force&&State.checkedAt&&Date.now()-State.checkedAt<1000)return {...State};
 const Own=Revision;
 Pending=(async()=>{
  if(!await chrome.permissions.contains({permissions:['nativeMessaging']})){Failures=0;LastFailure=0;await chrome.storage.local.remove(EvidenceKey);return Publish({connected:false,ready:false,checked:true,confirmedMissing:false,reason:'permission',checkedAt:Date.now(),canUninstall:false});}
  try{
   const Result=await RequestExplorer({action:'ping'});
   if(Own!==Revision)return {...State};
   Failures=0;LastFailure=0;await chrome.storage.local.remove(EvidenceKey);
   const Connected=CommonHelperConnected(Result),Ready=CommonHelperReady(Result);
   if(Connected){
    const Saved=await chrome.storage.local.get(RecordKey);
    if(Own!==Revision)return {...State};
    if(Saved[RecordKey]?.connected!==true)await chrome.storage.local.set({[RecordKey]:{connected:true,observedAt:Date.now()}});
   }
   if(Own!==Revision)return {...State};
   return Publish({connected:Connected,ready:Ready,checked:true,confirmedMissing:false,reason:Connected?Ready?'ready':'update-required':'invalid-response',checkedAt:Date.now(),helperVersion:Result?.helperVersion,helperRevision:Result?.helperRevision,platform:Result?.platform,capabilities:Result?.capabilities||[],canUninstall:Result?.canUninstall===true,installationId:Result?.installationId});
  }catch(ErrorValue){
   if(Own!==Revision)return {...State};
   const Now=Date.now(),Missing=ErrorValue?.reason==='missing';
   if(Missing){
    // Worker lifetimes can be shorter than the recheck interval. Keep conservative
    // evidence across worker restarts, never count simultaneous page probes twice.
    const Saved=await chrome.storage.local.get(EvidenceKey),Evidence=Saved[EvidenceKey];
    if(Own!==Revision)return {...State};
    LastFailure=Number(Evidence?.lastAt)||0;Failures=Now-LastFailure<=600000?Math.max(0,Number(Evidence?.count)||0):0;
    if(!LastFailure||Now-LastFailure>=1000){Failures++;LastFailure=Now;await chrome.storage.local.set({[EvidenceKey]:{count:Failures,lastAt:LastFailure}});}
   }
   else{Failures=0;LastFailure=0;await chrome.storage.local.remove(EvidenceKey);}
   if(Own!==Revision)return {...State};
   if(Missing&&Failures>=3)return MarkHelperRemoved({reason:'missing'});
   return Publish({connected:false,ready:false,checked:true,confirmedMissing:Missing&&State.confirmedMissing,reason:Missing?'missing':'unavailable',checkedAt:Now,canUninstall:false});
  }
 })();
 try{return await Pending;}finally{Pending=undefined;}
}
/** One watcher per page. Workers use explicit refreshes/their existing alarm, not intervals. */
export function StartHelperAvailability(){
 if(Started)return;Started=true;
 chrome.storage.onChanged.addListener((Changes,Area)=>{
  if(Area!=='local')return;
  const Record=Changes[RecordKey]?.newValue;
  if(Record?.connected===false&&Record.removedAt){
   ++Revision;Publish({connected:false,ready:false,checked:true,confirmedMissing:true,reason:Record.reason||'removed',checkedAt:Date.now()});
   Emit('download-location-default');if(Record.notify)RemovedNotice(Record);
  }
  if(Changes[RemovalKey]?.newValue)void MarkHelperRemoved().catch(()=>{});
 });
 if(typeof window!=='undefined'){
  const Refresh=()=>void RefreshHelperAvailability({force:true}).catch(()=>{});
  window.addEventListener('focus',Refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)Refresh();});
  Timer=setInterval(()=>{if(!document.hidden)void RefreshHelperAvailability().catch(()=>{});},5000);
  window.addEventListener('pagehide',()=>{clearInterval(Timer);Timer=undefined;},{once:true});
 }
 void RefreshHelperAvailability().catch(()=>{});
}
