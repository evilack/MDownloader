import {LocalizedError} from './i18n.js';
import {ReadPickedFolder} from './picked-download-folder.js';
// This is a saved-file safety allowlist, not a promise that Chrome supports every codec.
const Types = new Map(Object.entries({
	mp4:'video/mp4',m4v:'video/mp4',f4v:'video/mp4',m4a:'audio/mp4',
	webm:'video/webm',weba:'audio/webm',mov:'video/quicktime',mkv:'video/x-matroska',
	avi:'video/x-msvideo',flv:'video/x-flv',mp3:'audio/mpeg',aac:'audio/aac',
	ogg:'audio/ogg',oga:'audio/ogg',ogv:'video/ogg',opus:'audio/ogg',wav:'audio/wav',flac:'audio/flac',
}));
export const IsSavedMedia = Name => Types.has(Name.split('.').at(-1).toLowerCase());
export const SavedMediaMime = Name => Types.get(Name.split('.').at(-1).toLowerCase());
export async function PickedMediaFile(Location)
{
	const Folder = await ReadPickedFolder(Location.folder);
	if (!Folder || await Folder.queryPermission({mode:'read'}) !== 'granted') throw new LocalizedError('folder_access_required');
	return {folder: Folder, file: await (await Folder.getFileHandle(Location.name)).getFile()};
}
export async function FileFingerprint(File)
{
	const First = Math.min(File.size, 65536), Tail = Math.max(First, File.size - 65536);
	const Data = await new Blob([File.slice(0, First), File.slice(Tail)]).arrayBuffer();
	const Hash = await crypto.subtle.digest('SHA-256', Data);
	return {size:File.size, sampleHash:Array.from(new Uint8Array(Hash), N=>N.toString(16).padStart(2,'0')).join('')};
}
export function LocalMediaUrl(Filename)
{
	if (!SavedMediaMime(Filename)) throw new LocalizedError('job_source_unknown');
	const Path = Filename.replaceAll('\\', '/');
	if (/^[a-z]:\//i.test(Path)) return 'file:///' + Path.slice(0,2) + Path.slice(2).split('/').map(encodeURIComponent).join('/');
	if (Path.startsWith('//')) {const [Host,...Parts] = Path.slice(2).split('/'); return 'file://' + Host + '/' + Parts.map(encodeURIComponent).join('/');}
	if (Path.startsWith('/')) return 'file://' + Path.split('/').map(encodeURIComponent).join('/');
	throw new LocalizedError('job_source_unknown');
}
