/**
 * 사용자가 선택한 언어 또는 브라우저 언어로 메시지 카탈로그를 읽습니다. 워커의 오류는 번역 전 메시지 키와 인수로 전달하여 화면 언어에 맞게 표시합니다.
 */
import { AUTO_LANGUAGE, DEFAULT_LOCALE, GetSetting, OnSettingChanged, SettingKeys, SupportedLocales } from './settings.js';
export { SupportedLocales as supportedLocales };
const LocaleByLanguage = new Map(SupportedLocales.map(Locale => [Locale.split('_')[0], Locale]));
const Catalogs = new Map();
let ActiveLocale = DEFAULT_LOCALE;
let Preference = AUTO_LANGUAGE;
let SelectedMessages = {};
let DefaultMessages = {};
let Revision = 0;
export function ResolveLocale(Override, SystemLocale)
{
	if (SupportedLocales.includes(Override))
	{
		return Override;
	}
	const Language = SystemLocale?.toLowerCase().split(/[-_]/, 1)[0];
	return LocaleByLanguage.get(Language) ?? DEFAULT_LOCALE;
}

export const GetLocale = () => ActiveLocale.replace('_', '-');
export const GetLanguagePreference = () => Preference;
function LoadCatalog(Locale)
{
	if (!Catalogs.has(Locale))
	{
		const Url = new URL(`../_locales/${Locale}/messages.json`, import.meta.url);
		const Pending = fetch(Url).then(HttpResponse =>
		{
			if (!HttpResponse.ok)
			{
				throw new Error(String(HttpResponse.status));
			}
			return HttpResponse.json();
		}).catch(ErrorValue =>
		{
			Catalogs.delete(Locale);
			throw ErrorValue;
		});
		Catalogs.set(Locale, Pending);
	}
	return Catalogs.get(Locale);
}

export async function InitializeLocale(Language)
{
	const Update = ++Revision;
	const Override = Language ?? await GetSetting(SettingKeys.language).catch(() => AUTO_LANGUAGE);
	let Locale = Override;
	if (Override === AUTO_LANGUAGE)
	{
		const SystemLocale = await chrome.i18n?.getSystemUILanguage?.().catch(() => undefined);
		Locale = ResolveLocale(Override, SystemLocale || chrome.i18n?.getUILanguage?.());
	}
	const English = LoadCatalog(DEFAULT_LOCALE).catch(() => ({}));
	const [Fallback, Translated] = await Promise.all([English, Locale === DEFAULT_LOCALE ? English
		: LoadCatalog(Locale).catch(() => null)]);
	if (Update !== Revision)
	{
		return;
	}
	Preference = Override;
	ActiveLocale = Translated ? Locale : DEFAULT_LOCALE;
	DefaultMessages = Fallback;
	SelectedMessages = Translated ?? Fallback;
}

export function Translate(Key, ...Args)
{
	const Entry = SelectedMessages[Key] ?? DefaultMessages[Key];
	const Substitutions = Args.map(Value => IsMessageRef(Value) ? Translate(Value.key, ...Value.args) : String(Value ?? ''));
	if (!Entry)
	{
		return globalThis.chrome?.i18n?.getMessage?.(Key, Substitutions) || Key;
	}
	return Entry.message.replace(/\$\$|\$([a-z0-9_]+)\$/gi, (Token, Name) =>
	{
		if (!Name)
		{
			return '$';
		}
		const Argument = Entry.placeholders?.[Name.toLowerCase()]?.content;
		return Substitutions[Number(Argument?.slice(1)) - 1] ?? Token;
	});
}

export function LocalizePage()
{
	document.documentElement.lang = GetLocale();
	const Locale = new Intl.Locale(GetLocale());
	document.documentElement.dir = (Locale.getTextInfo?.() ?? Locale.textInfo)?.direction ?? 'ltr';
	for (const LocalNode of document.querySelectorAll('[data-i18n]'))
	{
		LocalNode.textContent = Translate(LocalNode.dataset.i18n);
	}
	for (const Attribute of ['title', 'aria-label', 'placeholder', 'alt'])
	{
		const Source = 'data-i18n-' + Attribute;
		for (const LocalNode of document.querySelectorAll(`[${Source}]`))
		{
			LocalNode.setAttribute(Attribute, Translate(LocalNode.getAttribute(Source)));
		}
	}
}

export function WatchLanguage()
{
	OnSettingChanged(SettingKeys.language, () => location.reload());
}

function IsMessageRef(Value)
{
	return typeof Value?.key === 'string' && Array.isArray(Value.args);
}

export const MessageRef = (Key, ...Args) => ({ key: Key, args: Args });
export class LocalizedError extends Error
{
	constructor(Key, ...Args)
	{
		super(Key);
		this.key = Key;
		this.args = Args;
	}
}

export function SerializeError(Value, Fallback = 'request_failed')
{
	if (IsMessageRef(Value))
	{
		return MessageRef(Value.key, ...Value.args);
	}
	const TextValue = typeof Value === 'string' ? Value : Value?.message;
	return TextValue || MessageRef(Fallback);
}

export function ReceivedError(Value, Fallback)
{
	const Detail = SerializeError(Value, Fallback);
	return IsMessageRef(Detail) ? new LocalizedError(Detail.key, ...Detail.args) : new Error(Detail);
}

export function ErrorText(Value, Fallback)
{
	const Detail = SerializeError(Value, Fallback);
	return IsMessageRef(Detail) ? Translate(Detail.key, ...Detail.args) : Detail;
}
