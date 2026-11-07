/**
 * 설정 키와 기본값, 저장 전후 값 검증을 한곳에서 관리합니다. 이전 버전 기록의 형식이 다르면 기본값을 사용하고 새 저장에는 검증된 값만 씁니다.
 */
import { NormalizeDownloadFolder } from './download-folder.js';
export const DEFAULT_LOCALE = 'en';
export const AUTO_LANGUAGE = 'auto';
export const SupportedLocales = Object.freeze([DEFAULT_LOCALE, 'ko', 'ja', 'zh_CN', 'es', 'pt_BR', 'fr', 'hi', 'ar', 'ru']);
export const SettingKeys = Object.freeze({
	debugLogging: 'debugLogging',
	debugDownloads: 'debugDownloads',
	logDownloads: 'logDownloads',
	showPanelMedia: 'showPanelMedia',
	usePageTitle: 'usePageTitle',
	useDownloadDateTime: 'useDownloadDateTime',
	downloadFolder: 'downloadFolder',
	pickedDownloadFolder: 'pickedDownloadFolder',
	language: 'language',
});
const Defaults = {
	[SettingKeys.debugLogging]: false,
	[SettingKeys.debugDownloads]: false,
	[SettingKeys.logDownloads]: false,
	[SettingKeys.showPanelMedia]: false,
	[SettingKeys.usePageTitle]: true,
	[SettingKeys.useDownloadDateTime]: false,
	[SettingKeys.downloadFolder]: '',
	[SettingKeys.pickedDownloadFolder]: '',
	[SettingKeys.language]: AUTO_LANGUAGE,
};
function NormalizeValue(Key, Value)
{
	if (Key === SettingKeys.downloadFolder)
	{
		return NormalizeDownloadFolder(Value);
	}
	if (Key === SettingKeys.pickedDownloadFolder)
	{
		return typeof Value === 'string' && (Value === '' || /^[a-f\d-]{36}$/i.test(Value)) ? Value : null;
	}
	if (Key === SettingKeys.language)
	{
		return Value === AUTO_LANGUAGE || SupportedLocales.includes(Value) ? Value : null;
	}
	// 이전 기록이 문자열 등 다른 형태여도 저장된 값이 불리언 true인 경우에만 옵션을 켭니다.
	return (Value ?? Defaults[Key]) === true;
}

function StoredValue(Key, Values)
{
	return NormalizeValue(Key, Values[Key]) ?? Defaults[Key];
}

export async function GetSetting(Key)
{
	return StoredValue(Key, await chrome.storage.local.get(Key));
}

export async function GetSettings(Keys)
{
	const Values = await chrome.storage.local.get(Keys);
	return Object.fromEntries(Keys.map(Key => [Key, StoredValue(Key, Values)]));
}

export async function SetSetting(Key, Value)
{
	if (!Object.hasOwn(Defaults, Key) || typeof Value !== typeof Defaults[Key])
	{
		throw new TypeError(`Invalid setting value: ${Key}`);
	}
	const Normalized = NormalizeValue(Key, Value);
	if (Normalized === null)
	{
		throw new TypeError(`Invalid setting value: ${Key}`);
	}
	await chrome.storage.local.set({ [Key]: Normalized });
}

export async function SetDownloadLocation(Folder, PickedFolder = '')
{
	const DownloadFolder = NormalizeValue(SettingKeys.downloadFolder, Folder);
	const PickedDownloadFolder = NormalizeValue(SettingKeys.pickedDownloadFolder, PickedFolder);
	if (DownloadFolder === null || PickedDownloadFolder === null)
	{
		throw new TypeError('Invalid download location');
	}
	// 텍스트 경로와 선택한 폴더의 키를 한 번에 저장하여 새 작업이 두 저장 방식을 동시에 읽지 않게 합니다.
	await chrome.storage.local.set({ downloadFolder: DownloadFolder, pickedDownloadFolder: PickedDownloadFolder });
}

export function OnSettingChanged(Key, Listener)
{
	const OnChanged = (Changes, Area) =>
	{
		if (Area === 'local' && Object.hasOwn(Changes, Key))
		{
			Listener(Changes[Key]);
		}
	};
	chrome.storage.onChanged.addListener(OnChanged);
	return () => chrome.storage.onChanged.removeListener(OnChanged);
}

/** 자주 확인하는 옵션만 실행 문맥에 캐시합니다. 기능 데이터의 영속 저장을 대신하지 않습니다.
 * 리스너를 먼저 연결하고 키별 변경 여부를 기억하여 늦은 최초 읽기가 최신 변경을 덮지 않게 합니다.
 * 같은 캐시를 쓰는 호출은 Ready 이후 저장소를 다시 읽지 않습니다. 소유자가 Dispose로 해제합니다. */
export function CreateSettingsCache(Keys, Storage = chrome.storage, OnChange = () =>
{
})
{
	const Values = Object.fromEntries(Keys.map(Key => [Key, Defaults[Key]]));
	const Changed = new Set();
	let bDisposed = false;
	function Apply(Key, Value)
	{
		const Normalized = NormalizeValue(Key, Value) ?? Defaults[Key];
		if (Values[Key] === Normalized)
		{
			return;
		}
		Values[Key] = Normalized;
		OnChange(Key, Normalized);
	}
	function OnChanged(Changes, Area)
	{
		if (bDisposed || Area !== 'local')
		{
			return;
		}
		for (const Key of Keys)
		{
			if (Object.hasOwn(Changes, Key))
			{
				Changed.add(Key);
				Apply(Key, Changes[Key].newValue);
			}
		}
	}
	Storage.onChanged?.addListener?.(OnChanged);
	const Ready = Storage.local.get(Keys).then(Stored =>
	{
		if (!bDisposed)
		{
			for (const Key of Keys)
			{
				if (!Changed.has(Key))
				{
					Apply(Key, Stored[Key]);
				}
			}
		}
	});
	return {
		Ready,
		Get: Key => Values[Key],
		Update(Key, Value)
		{
			if (bDisposed || !Object.hasOwn(Values, Key))
			{
				return;
			}
			Changed.add(Key);
			Apply(Key, Value);
		},
		Dispose()
		{
			bDisposed = true;
			Storage.onChanged?.removeListener?.(OnChanged);
		},
	};
}
