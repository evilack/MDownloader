import {RequestExplorer} from './explorer-native.js';
import {LocalizedError} from './i18n.js';
export const ExplorerInstallationKey='explorerHelperInstallation';
export const ExplorerRemovalKey='explorerHelperRemoval';
export const ExplorerReceiptKey='explorerHelperRemovalReceipt';
const ValidId=Value=>typeof Value==='string'&&/^[a-f0-9]{32}$/.test(Value);
export async function RememberExplorerInstallation(InstallationId){
	if(!ValidId(InstallationId))throw new LocalizedError('explorer_reveal_failed');
	const Data=await chrome.storage.local.get(ExplorerInstallationKey);
	if(Data[ExplorerInstallationKey]?.installationId!==InstallationId)await chrome.storage.local.set({[ExplorerInstallationKey]:{installationId:InstallationId}});
}
export async function ReadExplorerInstallation(){
	const Status=await RequestExplorer({action:'ping'});
	if(!Status?.ok||Status.protocol!==1)throw new LocalizedError('explorer_bridge_required');
	if(ValidId(Status.installationId))await RememberExplorerInstallation(Status.installationId);
	return Status;
}
export async function RemoveExplorerInstallation(){
	const Status=await ReadExplorerInstallation();
	if(!Status.canUninstall||!ValidId(Status.installationId)){
		const Token=crypto.randomUUID().replaceAll('-','');await RememberExplorerInstallation(Token);return {legacy:true,token:Token};
	}
	const Result=await RequestExplorer({action:'uninstall',installationId:Status.installationId});
	if(!Result?.ok||!Result.scheduled)throw new LocalizedError('explorer_remove_failed');
	return {scheduled:true};
}
export async function ApplyExplorerRemoval(Token){
	if(!ValidId(Token))return false;
	const Data=await chrome.storage.local.get(ExplorerInstallationKey);
	if(Data[ExplorerInstallationKey]?.installationId!==Token)return false;
	try{await RequestExplorer({action:'ping'});return false;}catch(ErrorValue){if(ErrorValue?.reason!=='missing')return false;}
	// One write resets the current selection and consumes the removal identity.
	await chrome.storage.local.set({downloadFolder:'',pickedDownloadFolder:'',[ExplorerInstallationKey]:null,[ExplorerReceiptKey]:null,[ExplorerRemovalKey]:{removedAt:Date.now()}});
	await chrome.storage.local.remove([ExplorerInstallationKey,ExplorerReceiptKey]);
	return true;
}
export async function ReceiveExplorerRemoval(Token){
	if(!ValidId(Token))return false;
	const Data=await chrome.storage.local.get(ExplorerInstallationKey);
	if(Data[ExplorerInstallationKey]?.installationId!==Token)return false;
	// Only the post-removal callback supplies this receipt. A missing host alone is insufficient.
	await chrome.storage.local.set({[ExplorerReceiptKey]:{token:Token}});
	return ReconcileExplorerRemoval();
}
// Retry a received completion receipt if Chrome was interrupted during consumption.
export async function ReconcileExplorerRemoval(){
	const Data=await chrome.storage.local.get(ExplorerReceiptKey);
	const Token=Data[ExplorerReceiptKey]?.token;
	return ValidId(Token)?ApplyExplorerRemoval(Token):false;
}
