import {LocalizedError} from './i18n.js';
import {PickedMediaFile, FileFingerprint, IsSavedMedia} from './saved-media.js';
import {RequestExplorer as CallExplorer} from './explorer-native.js';
import {RememberExplorerInstallation} from './explorer-lifecycle.js';
import {HasPickedFolderAccess} from './picked-download-folder.js';
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
	const Target = {folderKey:Location.folder,folderName:Folder.name,filename:Location.name,...await FileFingerprint(File)};
	const Bound = await CallExplorer({action:'revealBound',...Target});
	if (Bound?.ok) return;
	if (Bound?.code === 'invalid_message') throw new LocalizedError('explorer_remove_update_required');
	if (Bound?.code !== 'binding_required') throw new LocalizedError('explorer_reveal_failed');
	if (!await HasPickedFolderAccess(Folder)) throw new LocalizedError('folder_access_required');

	// The browser keeps the absolute path private. An exact-name creation event
	// lets the native host identify this directory without a second folder picker.
	const Marker = `.mdownloader-reveal-${crypto.randomUUID()}.tmp`;
	let Creation;
	try {
		const Result = await CallExplorer({action:'revealFromMarker',...Target,marker:Marker},{
			onWatching: () => (Creation = Folder.getFileHandle(Marker,{create:true})),
		});
		if (!Result?.ok || !Creation) throw new LocalizedError('explorer_reveal_failed');
	} finally {
		if (Creation && await Creation.catch(()=>null)) await Folder.removeEntry(Marker).catch(()=>{});
	}
}
