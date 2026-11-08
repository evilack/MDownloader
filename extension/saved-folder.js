import {InitializeLocale, LocalizePage, Translate, ErrorText, WatchLanguage} from './lib/i18n.js';
import {GetSetting, SettingKeys} from './lib/settings.js';
import {ReadPickedFolder} from './lib/picked-download-folder.js';
import {SendRequest, CreateElement} from './lib/ui.js';
import {SavedMediaMime, SelectedFolderEntries} from './lib/saved-folder-view.js';
WatchLanguage();
await InitializeLocale(await GetSetting(SettingKeys.language)); LocalizePage();
const Status = document.querySelector('#folder-status'), Access = document.querySelector('#folder-access');
const Link = document.querySelector('#open-saved-file'), List = document.querySelector('#saved-files');
let Folder, Location, MediaUrl, Revision = 0;
function Release()
{
	Revision++; Link.hidden = true; Link.removeAttribute('href');
	if (MediaUrl) URL.revokeObjectURL(MediaUrl); MediaUrl = undefined;
}
window.addEventListener('pagehide', Release);
window.addEventListener('pageshow', Event => { if (Event.persisted) void Load(); });
async function Load()
{
	Release(); const Current = Revision; List.replaceChildren(); Access.hidden = true; Status.textContent = '';
	try
	{
		Location = await SendRequest('savedLocation', {requestId: new URL(location.href).searchParams.get('job')});
		Folder = await ReadPickedFolder(Location.folder);
		if (Current !== Revision) return;
		if (!Folder || await Folder.queryPermission({mode: 'read'}) !== 'granted')
		{
			Access.hidden = !Folder; Status.textContent = Translate('folder_access_required'); return;
		}
		document.querySelector('#folder-name').textContent = Folder.name;
		document.querySelector('#saved-name').textContent = Location.name;
		const File = await (await Folder.getFileHandle(Location.name)).getFile();
		if (Current !== Revision) return;
		// Only the saved media gets a link. Arbitrary local HTML/scripts in the
		// directory must not execute under the extension's origin.
		const Mime = SavedMediaMime(Location.name);
		if (Mime) { MediaUrl = URL.createObjectURL(File.slice(0, File.size, Mime)); Link.href = MediaUrl; Link.hidden = false; }
		const Contents = await SelectedFolderEntries(Folder, Location.name);
		if (Contents.truncated) Status.textContent = Translate('view_folder_list_limit');
		for (const Entry of Contents.entries)
		{
			if (Current !== Revision) return;
			const Item = CreateElement('li');
			Item.append(CreateElement(Entry.name === Location.name ? 'strong' : 'span', Entry.name));
			if (Entry.name === Location.name) Item.setAttribute('aria-current', 'true');
			List.append(Item);
		}
	}
	catch (ErrorValue) { if (Current === Revision) {Release(); Status.textContent = ErrorText(ErrorValue);} }
}
Access.addEventListener('click', async () =>
{
	Access.disabled = true;
	try
	{
		if (await Folder.requestPermission({mode:'read'}) === 'granted') await Load();
		else Status.textContent = Translate('folder_access_required');
	}
	catch (ErrorValue) { Status.textContent = ErrorText(ErrorValue); }
	finally { Access.disabled = false; }
});
await Load();
