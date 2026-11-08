import {LocalizedError} from './i18n.js';
import {PickedMediaFile, FileFingerprint, IsSavedMedia} from './saved-media.js';
export const ExplorerHost = 'com.mdownloader.explorer';
function CallExplorer(Message)
{
	// A native port keeps the worker alive while the first folder chooser is open.
	return new Promise((Resolve, Reject) =>
	{
		let Port, Done=false;
		const Finish=(ErrorValue, Result)=>{if(Done)return;Done=true;Port?.disconnect();if(ErrorValue)Reject(ErrorValue);else Resolve(Result);};
		try {
			Port=chrome.runtime.connectNative(ExplorerHost);
			Port.onMessage.addListener(Result=>Finish(null,Result));
			Port.onDisconnect.addListener(()=>{const Reason=chrome.runtime.lastError?.message??'';Finish(new LocalizedError(/not found|forbidden|permission/i.test(Reason)?'explorer_bridge_required':'explorer_reveal_failed'));});
			Port.postMessage(Message);
		} catch {Finish(new LocalizedError('explorer_bridge_required'));}
	});
}
export async function ConnectExplorer()
{
	const Result=await CallExplorer({action:'ping'});
	if(!Result?.ok || Result.protocol!==1)throw new LocalizedError('explorer_bridge_required');
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
