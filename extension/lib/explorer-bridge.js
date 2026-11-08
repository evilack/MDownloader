import {LocalizedError} from './i18n.js';
import {PickedMediaFile, FileFingerprint, IsSavedMedia} from './saved-media.js';
export const ExplorerHost = 'com.mdownloader.explorer';
export async function RevealPickedMedia(Location)
{
	if (!IsSavedMedia(Location.name)) throw new LocalizedError('job_source_unknown');
	const {folder: Folder, file: File} = await PickedMediaFile(Location);
	let Result;
	try { Result = await chrome.runtime.sendNativeMessage(ExplorerHost, {action:'reveal',folderKey:Location.folder,
		folderName:Folder.name,filename:Location.name,...await FileFingerprint(File)}); }
	catch { throw new LocalizedError('explorer_bridge_required'); }
	if (Result?.code === 'canceled') return;
	if (!Result?.ok) throw new LocalizedError('explorer_reveal_failed');
}
