import { InitializeDebugLogging } from './lib/debug-runtime.js';
void InitializeDebugLogging();
/**
 * 옵션 화면의 시작점입니다. 저장된 설정을 한 번에 읽은 뒤 언어, 체크박스, 다운로드 위치, 접근 권한, 로그 설정을 각각 연결합니다.
 */
import { BindDownloadLocation } from './options-download-location.js';
import {BeforePickDownloadFolder} from './options-explorer-setup.js';
import {BindExplorerRemoval} from './options-explorer-remove.js';
import { BindNetworkAccess } from './options-network-access.js';
import { BindDownloadLog } from './options-download-log.js';
import {
	GetLanguagePreference, GetLocale, InitializeLocale, LocalizePage, supportedLocales as SupportedLocales, Translate, WatchLanguage
} from './lib/i18n.js';
import { AUTO_LANGUAGE, GetSettings, SetSetting, SettingKeys } from './lib/settings.js';
import { RuntimePolicy } from './lib/runtime-policy.js';
import { BindTranslationSettings } from './options-translation.js';
import {CanUseYoutube} from './lib/distribution-policy.js';
WatchLanguage();
const Settings = await GetSettings(Object.values(SettingKeys)).catch(() => null);
// 한꺼번에 읽은 설정에서 언어 값을 넘겨 시작할 때 같은 값을 다시 조회하지 않습니다.
await InitializeLocale(Settings?.[SettingKeys.language] ?? AUTO_LANGUAGE);
LocalizePage();
void BindTranslationSettings();
function BindLanguagePicker()
{
	const Select = document.querySelector('#language');
	const Status = document.querySelector('#language-status');
	for (const Locale of SupportedLocales)
	{
		const LanguageTag = Locale.replace('_', '-');
		const DisplayTag = Locale === 'zh_CN' ? 'zh-Hans' : LanguageTag;
		const SelectOption = document.createElement('option');
		SelectOption.value = Locale;
		SelectOption.lang = LanguageTag;
		SelectOption.dir = 'auto';
		SelectOption.textContent = new Intl.DisplayNames(LanguageTag, { type: 'language' }).of(DisplayTag);
		Select.append(SelectOption);
	}
	Select.value = GetLanguagePreference();
	Select.disabled = false;
	Select.addEventListener('change', async () =>
	{
		Select.disabled = true;
		Status.textContent = '';
		try
		{
			await SetSetting(SettingKeys.language, Select.value);
		}
		catch
		{
			Select.value = GetLanguagePreference();
			Status.textContent = Translate('opt_language_save_failed');
		}
		finally
		{
			Select.disabled = false;
		}
	});
}

function BindToggles(Settings, StatusSelector, Toggles)
{
	const Status = document.querySelector(StatusSelector);
	for (const [Key, Selector, LabelKey] of Toggles)
	{
		const Input = document.querySelector(Selector);
		const Label = Translate(LabelKey);
		if (!Settings)
		{
			Status.textContent = Translate('opt_setting_read_failed', Label);
			continue;
		}
		Input.checked = Settings[Key];
		Input.disabled = false;
		Input.addEventListener('change', async () =>
		{
			const Enabled = Input.checked;
			Input.disabled = true;
			try
			{
				await SetSetting(Key, Enabled);
				Status.textContent = Translate(Enabled ? 'opt_setting_enabled' : 'opt_setting_disabled', Label);
			}
			catch
			{
				Input.checked = !Enabled;
				Status.textContent = Translate('opt_setting_save_failed', Label);
			}
			finally
			{
				Input.disabled = false;
			}
		});
	}
}

BindLanguagePicker();
if (CanUseYoutube())
{
	document.querySelector('#youtube-caption-settings').hidden = false;
	BindToggles(Settings, '#youtube-caption-settings-status', [[SettingKeys.includeYoutubeAutoCaptions, '#include-youtube-auto-captions', 'opt_youtube_auto_captions']]);
}
void BindDownloadLocation(Settings?.[SettingKeys.downloadFolder], Settings?.[SettingKeys.pickedDownloadFolder], BeforePickDownloadFolder);
void BindExplorerRemoval();
BindToggles(Settings, '#debug-status', [
	[SettingKeys.debugLogging, '#debug-logging', 'opt_debug_logging'],
	[SettingKeys.debugDownloads, '#debug-downloads', 'opt_debug'],
	[SettingKeys.usePageTitle, '#use-page-title', 'opt_page_title_short'],
	[SettingKeys.useDownloadDateTime, '#use-download-date-time', 'opt_download_date_time'],
]);
BindToggles(Settings, '#panel-settings-status', [[SettingKeys.showPanelMedia, '#show-panel-media', 'opt_show_panel_media']]);
BindDownloadLog(Settings?.[SettingKeys.logDownloads]);
document.querySelector('#debug-logging-help').textContent = Translate('opt_debug_logging_help', new Intl.NumberFormat(GetLocale()).format(RuntimePolicy.Debug.MaxEntries));
BindNetworkAccess(document.querySelector('#network-form'));
document.querySelector('#version').textContent = chrome.runtime.getManifest().version;
document.querySelector('#reload-extension').addEventListener('click', () => chrome.runtime.reload());
