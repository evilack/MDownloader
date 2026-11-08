/**
 * 다운로드 위치를 편집하는 영역입니다. 텍스트는 브라우저 다운로드 폴더 아래의 상대 경로이고, 폴더 선택은 브라우저가 반환한 디렉터리 핸들을 사용합니다.
 * 두 값은 동시에 사용하지 않도록 하나의 저장 변경으로 처리합니다.
 */
import { NormalizeDownloadFolder } from './lib/download-folder.js';
import {
	HasPickedFolderAccess, PickDownloadFolder, ReadPickedFolder, RememberPickedFolder, RestorePickedFolderAccess,
} from './lib/picked-download-folder.js';
import { Translate } from './lib/i18n.js';
import { SetDownloadLocation } from './lib/settings.js';

/** 텍스트 하위 경로와 폴더 선택은 서로 다른 저장 방식입니다. 화면에서 선택한 한 가지를 원자적으로 기록합니다. */
export async function BindDownloadLocation(DownloadFolder, PickedFolderKey, BeforePick = () => true)
{
	const Form = document.querySelector('#download-folder-form');
	const Input = document.querySelector('#download-folder');
	const Save = document.querySelector('#save-download-folder');
	const Picker = document.querySelector('#pick-download-folder');
	const Restore = document.querySelector('#restore-folder-access');
	const Default = document.querySelector('#use-default-download-folder');
	const Selected = document.querySelector('#picked-download-folder');
	const Status = document.querySelector('#download-folder-status');
	let PickedFolder;
	let CurrentPickedKey = PickedFolderKey ?? '';
	window.addEventListener?.('download-location-default',()=>{
		CurrentPickedKey='';PickedFolder=undefined;Input.value='';Input.setCustomValidity('');
		void DisplayPickedFolder();Status.textContent=Translate('opt_default_folder_saved');
	});
	async function DisplayPickedFolder()
	{
		Selected.hidden = !PickedFolder;
		Selected.textContent = PickedFolder ? Translate('opt_picked_folder', PickedFolder.name) : '';
		Restore.hidden = !PickedFolder || await HasPickedFolderAccess(PickedFolder);
		Default.hidden = false;
		Input.placeholder = PickedFolder ? PickedFolder.name : Translate('opt_default_folder');
	}

	function SetBusy(Busy)
	{
		for (const Control of [Input, Save, Picker, Restore, Default])
		{
			Control.disabled = Busy;
		}
	}

	if (DownloadFolder === undefined)
	{
		Status.textContent = Translate('opt_folder_read_failed');
		return;
	}
	Input.value = DownloadFolder;
	Picker.hidden = typeof window.showDirectoryPicker !== 'function';
	Input.addEventListener('input', () =>
	{
		Input.setCustomValidity('');
		Status.textContent = '';
	});
	Form.addEventListener('submit', async UiEvent =>
	{
		UiEvent.preventDefault();
		const Folder = NormalizeDownloadFolder(Input.value);
		if (Folder === null)
		{
			Input.setCustomValidity(Translate('opt_invalid_folder'));
			Input.reportValidity();
			return;
		}
		SetBusy(true);
		try
		{
			// Selecting a native folder clears the relative input. Confirming that
			// selection must not interpret the empty input as a default reset.
			const KeepPicked = !!CurrentPickedKey && !Folder;
			if (KeepPicked && !await HasPickedFolderAccess(PickedFolder))
			{
				await DisplayPickedFolder();
				Status.textContent = Translate('folder_access_required');
				return;
			}
			await SetDownloadLocation(Folder, KeepPicked ? CurrentPickedKey : '');
			if (!KeepPicked) { PickedFolder = undefined; CurrentPickedKey = ''; }
			await DisplayPickedFolder();
			Input.value = Folder;
			Status.textContent = Translate(KeepPicked || Folder ? 'opt_folder_saved' : 'opt_default_folder_saved');
		}
		catch
		{
			Status.textContent = Translate('opt_folder_save_failed');
		}
		finally
		{
			SetBusy(false);
		}
	});
	Picker.addEventListener('click', async () =>
	{
		SetBusy(true);
		try
		{
			if(!await BeforePick())return;
			// 폴더 선택기는 사용자가 클릭한 순간에만 열 수 있으므로 저장소 조회보다 먼저 호출합니다.
			const Directory = await PickDownloadFolder(PickedFolder);
			if (!await HasPickedFolderAccess(Directory))
			{
				Status.textContent = Translate('folder_access_required');
				return;
			}
			const Key = await RememberPickedFolder(Directory);
			await SetDownloadLocation('', Key);
			CurrentPickedKey = Key;
			PickedFolder = Directory;
			Input.value = '';
			Input.setCustomValidity('');
			await DisplayPickedFolder();
			Status.textContent = Translate('opt_folder_saved');
		}
		catch (ErrorValue)
		{
			if (ErrorValue.name !== 'AbortError')
			{
				Status.textContent = Translate('opt_folder_picker_failed');
			}
		}
		finally
		{
			SetBusy(false);
		}
	});
	Default.addEventListener('click', async () =>
	{
		SetBusy(true);
		try
		{
			await SetDownloadLocation('');
			CurrentPickedKey = ''; PickedFolder = undefined;
			Input.value = ''; Input.setCustomValidity('');
			await DisplayPickedFolder();
			Status.textContent = Translate('opt_default_folder_saved');
		}
		catch { Status.textContent = Translate('opt_folder_save_failed'); }
		finally { SetBusy(false); }
	});
	Restore.addEventListener('click', async () =>
	{
		SetBusy(true);
		try
		{
			const bGranted = await RestorePickedFolderAccess(PickedFolder);
			await DisplayPickedFolder();
			Status.textContent = Translate(bGranted ? 'opt_folder_access_restored' : 'folder_access_required');
		}
		catch
		{
			Status.textContent = Translate('folder_access_required');
		}
		finally
		{
			SetBusy(false);
		}
	});
	if (PickedFolderKey)
	{
		try
		{
			PickedFolder = await ReadPickedFolder(PickedFolderKey);
			await DisplayPickedFolder();
			if (!PickedFolder || !Restore.hidden)
			{
				Status.textContent = Translate('folder_access_required');
			}
		}
		catch
		{
			Status.textContent = Translate('opt_folder_read_failed');
		}
	}
	else await DisplayPickedFolder();
	SetBusy(false);
}
