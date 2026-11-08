import {LocalizedError} from './i18n.js';
import {PickedMediaFile, FileFingerprint, IsSavedMedia} from './saved-media.js';
import {RequestExplorer as CallExplorer} from './explorer-native.js';
import {RememberExplorerInstallation} from './explorer-lifecycle.js';
export {ExplorerHost} from './explorer-native.js';
export async function ConnectExplorer()
{
	const Result=await CallExplorer({action:'ping'});
	if(!Result?.ok || Result.protocol!==1)throw new LocalizedError('explorer_bridge_required');
	if(Result.installationId)await RememberExplorerInstallation(Result.installationId);
	return {connected:true};
}
export async function RevealPickedMedia(Location)
{
	if (!IsSavedMedia(Location.name)) throw new LocalizedError('job_source_unknown');
	const {folder: Folder, file: File} = await PickedMediaFile(Location);
	const Fingerprint=await FileFingerprint(File);
	const Result = await CallExplorer({action:'reveal',folderKey:Location.folder,
		folderName:Folder.name,filename:Location.name,...Fingerprint});
	if (Result?.code === 'canceled') return;
	if (!Result?.ok) throw new LocalizedError('explorer_reveal_failed');
}
