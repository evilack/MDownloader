import {CreateExplorerInstaller} from './explorer-installer.js';
import {PrepareCommonHelper} from './common-helper-setup.js';
import {CreateMacCommonPackage} from './mac-caption-package.js';
import {MinimumHelperVersion,MinimumWindowsHelperRevision} from './common-helper-contract.js';

/** A real download link; opening the setup dialog never downloads or launches a file. */
export async function CreateHelperInstallerLink(Platform){
 if(!['win','mac'].includes(Platform))throw Error('unsupported_platform');
 const Bundle=await PrepareCommonHelper(Platform,{refresh:true});
 const Contents=Platform==='mac'?await CreateMacCommonPackage(Bundle,chrome.runtime.id):CreateExplorerInstaller(Bundle,chrome.runtime.id);
 const url=URL.createObjectURL(new Blob([Contents],{type:'application/octet-stream'}));
 return {url,filename:'MDownloader-Helper-Setup-v'+MinimumHelperVersion+(Platform==='win'?'.'+MinimumWindowsHelperRevision+'.cmd':'.pkg'),revoke(){URL.revokeObjectURL(url);}};
}
