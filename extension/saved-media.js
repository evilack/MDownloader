import {InitializeLocale, LocalizePage, Translate, ErrorText, WatchLanguage} from './lib/i18n.js';
import {GetSetting, SettingKeys} from './lib/settings.js';
import {ReadPickedFolder} from './lib/picked-download-folder.js';
import {SavedMediaMime} from './lib/saved-media.js';
import {SendRequest} from './lib/ui.js';

WatchLanguage();
await InitializeLocale(await GetSetting(SettingKeys.language));
LocalizePage();
const Player = document.querySelector('#saved-player');
const Status = document.querySelector('#media-status');
const Access = document.querySelector('#media-access');
let Folder, MediaUrl, Revision = 0;

function Release()
{
	Revision++;
	Player.pause();
	Player.removeAttribute('src');
	Player.load();
	Player.hidden = true;
	if (MediaUrl) URL.revokeObjectURL(MediaUrl);
	MediaUrl = undefined;
}
window.addEventListener('pagehide', Release);
window.addEventListener('pageshow', EventValue =>
{
	if (EventValue.persisted) void Load();
});

async function Load()
{
	Release();
	const Current = Revision;
	Status.textContent = '';
	Access.hidden = true;
	try
	{
		const Location = await SendRequest('savedLocation', {requestId: new URL(location.href).searchParams.get('job')});
		Folder = await ReadPickedFolder(Location.folder);
		if (Current !== Revision) return;
		if (!Folder || await Folder.queryPermission({mode: 'read'}) !== 'granted')
		{
			Access.hidden = !Folder;
			Status.textContent = Translate('folder_access_required');
			return;
		}
		const Mime = SavedMediaMime(Location.name);
		if (!Mime) throw new Error(Translate('job_source_unknown'));
		const File = await (await Folder.getFileHandle(Location.name)).getFile();
		if (Current !== Revision) return;
		document.title = Location.name;
		// Supply the MIME without reading the entire saved file into memory.
		MediaUrl = URL.createObjectURL(File.slice(0, File.size, Mime));
		Player.src = MediaUrl;
		Player.hidden = false;
		void Player.play().catch(() => {});
	}
	catch (ErrorValue)
	{
		if (Current === Revision)
		{
			Release();
			Status.textContent = ErrorText(ErrorValue);
		}
	}
}
Player.addEventListener('error', () => { Status.textContent = Translate('view_preview_playback_failed'); });
Access.addEventListener('click', async () =>
{
	Access.disabled = true;
	try
	{
		if (await Folder.requestPermission({mode: 'read'}) === 'granted') await Load();
		else Status.textContent = Translate('folder_access_required');
	}
	catch (ErrorValue) { Status.textContent = ErrorText(ErrorValue); }
	finally { Access.disabled = false; }
});
await Load();
