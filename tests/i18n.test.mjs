import Assert from 'node:assert/strict';
import { readdir as Readdir, readFile as ReadFile } from 'node:fs/promises';
import { test as Test } from 'node:test';
import {
	ErrorText, GetLanguagePreference, GetLocale, InitializeLocale, LocalizedError, MessageRef,
	ReceivedError, ResolveLocale, SerializeError, supportedLocales as SupportedLocales, Translate,
} from '../extension/lib/i18n.js';
Test('resolves the supported system language, manual override and English fallback', () =>
{
	Assert.equal(SupportedLocales.length, 10);
	Assert.equal(ResolveLocale(undefined, 'ko-KR'), 'ko');
	Assert.equal(ResolveLocale('auto', 'zh-Hant-TW'), 'zh_CN');
	Assert.equal(ResolveLocale('auto', 'pt-PT'), 'pt_BR');
	Assert.equal(ResolveLocale('auto', 'sv-SE'), 'en');
	Assert.equal(ResolveLocale('ja', 'ko-KR'), 'ja');
	Assert.equal(ResolveLocale('../../ja', 'es-MX'), 'es');
});
Test('uses equivalent Chrome message keys and substitutions in all ten catalogs', async () =>
{
	const Root = new URL('../extension/_locales/', import.meta.url);
	Assert.deepEqual((await Readdir(Root)).sort(), [...SupportedLocales].sort());
	const Read = async Locale => JSON.parse(await ReadFile(new URL(`${Locale}/messages.json`, Root), 'utf8'));
	const Base = await Read('en');
	const Extension = new URL('../extension/', import.meta.url);
	const Files = (await Readdir(Extension)).filter(Name => /\.html$|^manifest\.json$/.test(Name));
	for (const File of Files)
	{
		const Source = await ReadFile(new URL(File, Extension), 'utf8');
		for (const [, HtmlKey, ManifestKey] of Source.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z0-9_]+)"|__MSG_([a-z0-9_]+)__/g))
		{
			const Key = HtmlKey ?? ManifestKey;
			Assert.ok(Base[Key], `${File}:${Key}`);
		}
	}
	for (const Locale of SupportedLocales)
	{
		const Messages = await Read(Locale);
		Assert.deepEqual(Object.keys(Messages).sort(), Object.keys(Base).sort(), Locale);
		for (const [Key, Entry] of Object.entries(Messages))
		{
			Assert.ok(Entry.message.trim(), `${Locale}:${Key}`);
			Assert.deepEqual(Entry.placeholders, Base[Key].placeholders, `${Locale}:${Key}`);
		}
	}
});
Test('loads the chosen locale and renders saved or transferred errors in the active language', async Test =>
{
	let Language = 'auto';
	Test.mock.method(globalThis, 'fetch', async Url => new Response(await ReadFile(Url)));
	globalThis.chrome = {
		i18n: { getUILanguage: () => 'ko-KR' },
		storage: { local: { get: async () => ({ language: Language }) } },
	};
	Test.after(() =>
	{
		delete globalThis.chrome;
	});
	await InitializeLocale();
	Assert.equal(GetLanguagePreference(), 'auto');
	Assert.equal(GetLocale(), 'ko');
	Assert.equal(Translate('action_title'), 'MDownloader · 현재 페이지');
	const Wire = JSON.parse(JSON.stringify(SerializeError(new LocalizedError('job_browser_error', 'NETWORK_FAILED'))));
	Assert.deepEqual(Wire, MessageRef('job_browser_error', 'NETWORK_FAILED'));
	Assert.match(ErrorText(ReceivedError(Wire)), /브라우저.+NETWORK_FAILED/);
	Language = 'en';
	await InitializeLocale();
	Assert.equal(GetLanguagePreference(), 'en');
	Assert.equal(Translate('action_title'), 'MDownloader · Current page');
	Assert.equal(ErrorText(Wire), 'Browser download error: NETWORK_FAILED');
});
