import {DownloadExplorerInstaller,PrepareExplorerInstaller} from './explorer-installer.js';
import {DownloadNamedFile,ForgetDownloadFilename} from './browser-download.js';
import {CreateMacCommonPackage} from './mac-caption-package.js';
import {RunOneClickSetup} from './helper-one-click.js';
import {ProbeCommonHelper} from './common-helper.js';
let MacPayload;
export function PrepareCommonHelper(Platform='win',Options={}){
 if(Platform!=='mac')return PrepareExplorerInstaller(Options);
 if(Options.refresh)MacPayload=undefined;
 return MacPayload??=fetch(chrome.runtime.getURL('data/mac-common-installer.json'),{cache:'no-store'}).then(async R=>{if(!R.ok)throw Error('Common helper payload unavailable');return R.json();}).catch(E=>{MacPayload=undefined;throw E;});
}
async function DownloadMacCommonInstaller(){
 const Bytes=await CreateMacCommonPackage(await PrepareCommonHelper('mac'),chrome.runtime.id);
 const Url=URL.createObjectURL(new Blob([Bytes],{type:'application/octet-stream'}));let Id;
 try{
  Id=await DownloadNamedFile(Url,'MDownloader-Common-Setup.pkg',{saveAs:false});
  const End=Date.now()+15000;
  while(Date.now()<End){const [Item]=await chrome.downloads.search({id:Id});if(Item?.state==='complete')return Id;if(Item?.state==='interrupted')throw Error(Item.error??'Installer download interrupted');await new Promise(R=>setTimeout(R,100));}
  throw Error('Common helper download timed out');
 }finally{if(Id!==undefined)ForgetDownloadFilename(Id);URL.revokeObjectURL(Url);}
}
export async function InstallCommonHelper(OnState,{signal,onDownload=()=>{},platform,probe=async()=>{const R=await ProbeCommonHelper();return {...R,connected:R.ready};}}={}){
 signal?.throwIfAborted();
 const Permissions={permissions:['nativeMessaging','downloads.open']};
 if(!await chrome.permissions.contains(Permissions)&&!await chrome.permissions.request(Permissions))throw Error('permission_denied');
 signal?.throwIfAborted();
 const Platform=platform??(await chrome.runtime.getPlatformInfo()).os;
 signal?.throwIfAborted();
 // An installer launch failure does not mean a manually installed host is missing.
 let Existing;try{Existing=await probe();}catch{}
 signal?.throwIfAborted();
 if(Existing?.connected){OnState?.('complete');return Existing;}
 return RunOneClickSetup({signal,download:async()=>{const Id=await (Platform==='mac'?DownloadMacCommonInstaller():DownloadExplorerInstaller());signal?.throwIfAborted();onDownload(Id);return Id;},open:Id=>chrome.downloads.open(Id),onState:OnState,probe});
}
