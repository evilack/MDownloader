/**
 * 사용자가 승인한 디렉터리 핸들을 IndexedDB에 보관합니다. 각 작업은 등록 때 선택한 핸들을 기억하므로 다운로드 중 옵션을 바꿔도 대상이 뒤바뀌지 않습니다.
 */
import { LocalizedError } from './i18n.js';
const DatabaseName = 'mdownloader-download-folders';
const DirectoryStore = 'directories';
const WritePermission = { mode: 'readwrite' };

// 브라우저의 디렉터리 핸들은 IndexedDB에 구조화된 데이터로 저장할 수 있습니다.
// 작업에는 핸들의 키만 기록하여 설정 변경이 진행 중 작업의 저장 위치를 바꾸지 않게 합니다.
async function UseDirectoryStore(Mode, Run)
{
	const Database = await new Promise((Resolve, Reject) =>
	{
		const Open = indexedDB.open(DatabaseName, 1);
		Open.onupgradeneeded = () => Open.result.createObjectStore(DirectoryStore);
		Open.onsuccess = () => Resolve(Open.result);
		Open.onerror = () => Reject(Open.error);
	});
	try
	{
		return await new Promise((Resolve, Reject) =>
		{
			const Transaction = Database.transaction(DirectoryStore, Mode);
			const Operation = Run(Transaction.objectStore(DirectoryStore));
			Transaction.oncomplete = () => Resolve(Operation.result);
			Transaction.onabort = () => Reject(Transaction.error);
		});
	}
	finally
	{
		Database.close();
	}
}

export const ReadPickedFolder = Key => UseDirectoryStore('readonly', Store => Store.get(Key));
export async function RememberPickedFolder(Handle)
{
	const Key = crypto.randomUUID();
	await UseDirectoryStore('readwrite', Store => Store.add(Handle, Key));
	return Key;
}

export const HasPickedFolderAccess = async Handle => (await Handle?.queryPermission(WritePermission)) === 'granted';
export const RestorePickedFolderAccess = async Handle => (await Handle.requestPermission(WritePermission)) === 'granted';
export function PickDownloadFolder(StartIn)
{
	return window.showDirectoryPicker({
		id: 'mdownloader-download-folder',
		startIn: StartIn ?? 'downloads',
		...WritePermission,
	});
}

export async function RequirePickedFolder(Key)
{
	const Handle = await ReadPickedFolder(Key);
	if (!await HasPickedFolderAccess(Handle))
	{
		throw new LocalizedError('folder_access_required');
	}
	return Handle;
}

export async function WriteToPickedFolder(Folder, Filename, Body, Signal)
{
	// 같은 폴더의 파일명 결정은 잠금으로 순서를 맞춥니다.
	// 중복 번호는 확장자 앞에 붙이고 같은 이름의 파일과 디렉터리를 모두 확인합니다.
	const MediaFile = await navigator.locks.request(DatabaseName, { signal: Signal }, async () =>
	{
		const Dot = Filename.lastIndexOf('.');
		const Stem = Dot > 0 ? Filename.slice(0, Dot) : Filename;
		const Extension = Dot > 0 ? Filename.slice(Dot) : '';
		for (let Index = 0; ; Index++)
		{
			const Name = Index ? `${Stem} (${Index})${Extension}` : Filename;
			try
			{
				await Folder.getFileHandle(Name);
			}
			catch (ErrorValue)
			{
				if (ErrorValue.name === 'TypeMismatchError')
				{
					continue;
				}
				if (ErrorValue.name !== 'NotFoundError')
				{
					throw ErrorValue;
				}
				return Folder.getFileHandle(Name, { create: true });
			}
		}
	});
	try
	{
		const Writable = await MediaFile.createWritable();
		// 네트워크 실패나 취소가 나면 pipeTo가 대상 쓰기를 중단합니다.
		await Body.pipeTo(Writable, { signal: Signal });
	}
	catch (ErrorValue)
	{
		await Folder.removeEntry(MediaFile.name).catch(() =>
		{
		});
		throw ErrorValue;
	}
	return MediaFile.name;
}
