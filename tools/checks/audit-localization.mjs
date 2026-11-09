import {ArtifactPath} from '../lib/tool-config.mjs';
/** 실행 화면을 바꾸지 않고 카탈로그·참조 키·치환 결과를 검사합니다.
 * HTML뿐 아니라 하위 모듈의 동적 문구 키도 포함하며, 외부 라이브러리는 제외합니다.
 */
import Assert from 'node:assert/strict';
import {readFile as ReadFile, readdir as Readdir, writeFile as WriteFile, mkdir as Mkdir} from 'node:fs/promises';
import {InitializeLocale, Translate, ErrorText, supportedLocales as SupportedLocales} from '../../extension/lib/i18n.js';
const Root = new URL('../../extension/', import.meta.url);
const English = JSON.parse(await ReadFile(new URL('_locales/en/messages.json', Root), 'utf8'));
const Keys = Object.keys(English);
const Prefixes = new Set(Keys.map(Key => Key.split('_')[0]));
async function ReadSourceFiles(Directory)
{
	const Files = [];
	for (const Entry of await Readdir(Directory, {withFileTypes: true}))
	{
		if (['vendor', '_locales'].includes(Entry.name))
		{
			continue;
		}
		const Address = new URL(Entry.name + (Entry.isDirectory() ? '/' : ''), Directory);
		if (Entry.isDirectory())
		{
			Files.push(...await ReadSourceFiles(Address));
		}
		else if (/\.(js|html|json)$/.test(Entry.name))
		{
			Files.push(Address);
		}
	}
	return Files;
}

const Files = await ReadSourceFiles(Root);
const MissingReferences = [];
const LiteralUiCandidates = [];
for (const File of Files)
{
	const Source = await ReadFile(File, 'utf8');
	// DOM form names are identifiers, not displayed message keys. Explicit
	// Translate/data-i18n references below still scan the original source.
	const MessageSource = Source.replace(/\.name\s*=\s*(['"])[a-z][a-z0-9_]*\1/g, '');
	// 메시지 표나 조건식에서 고르는 키도 확인하도록 기존 메시지 이름공간의
	// 문자열을 수집합니다. 결과 파일에는 소스 본문이나 미디어 주소를 저장하지 않습니다.
	for (const Match of MessageSource.matchAll(/['"]([a-z][a-z0-9]+(?:_[a-z0-9]+)+)['"]/g))
	{
		const Key = Match[1];
		if (Prefixes.has(Key.split('_')[0]) && !English[Key])
		{
			MissingReferences.push({file: File.pathname, key: Key});
		}
	}
	for (const Match of Source.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z0-9_]+)"|__MSG_([a-z0-9_]+)__/g))
	{
		const Key = Match[1] ?? Match[2];
		if (!English[Key])
		{
			MissingReferences.push({file: File.pathname, key: Key});
		}
	}
	for (const Match of Source.matchAll(/(?:Translate|LocalizedError|MessageRef)\(\s*['"]([a-z0-9_]+)['"]/g))
	{
		if (!English[Match[1]])
		{
			MissingReferences.push({file: File.pathname, key: Match[1]});
		}
	}
	// 명시적 UI 문자열 대입도 검토 목록에 남깁니다. 빈 문자열·숫자·구분 기호는 제외합니다.
	for (const Match of Source.matchAll(/(?:\.textContent|\.title)\s*=\s*(['"])([^'"\r\n]+)\1/g))
	{
		if (/[\p{L}]/u.test(Match[2]))
		{
			LiteralUiCandidates.push({file: File.pathname, text: Match[2]});
		}
	}
}
Assert.deepEqual(MissingReferences, [], 'Missing source message keys');
const Catalogs = {};
const OriginalFetch = globalThis.fetch;
globalThis.fetch = async Address => new Response(await ReadFile(Address));
try
{
	for (const Locale of SupportedLocales)
	{
		const Catalog = JSON.parse(await ReadFile(new URL('_locales/' + Locale + '/messages.json', Root), 'utf8'));
		Assert.deepEqual(Object.keys(Catalog).sort(), [...Keys].sort(), Locale + ': catalog parity');
		await InitializeLocale(Locale);
		for (const Key of Keys)
		{
			const Entry = Catalog[Key];
			Assert.ok(Entry.message.trim(), Locale + ':' + Key);
			Assert.deepEqual(Entry.placeholders, English[Key].placeholders, Locale + ':' + Key + ': substitutions');
			for (const Match of Entry.message.replaceAll('$$', '').matchAll(/\$([a-z0-9_]+)\$/gi))
			{
				Assert.ok(Entry.placeholders?.[Match[1].toLowerCase()], Locale + ':' + Key + ': undeclared placeholder');
			}
			const Positions = Object.values(Entry.placeholders ?? {}).map(Value => Number(Value.content.slice(1)));
			const Arguments = Array.from({length: Math.max(0, ...Positions)}, (_, Index) => '[' + (Index + 1) + ']');
			const Rendered = Translate(Key, ...Arguments);
			Assert.notEqual(Rendered, Key, Locale + ':' + Key + ': untranslated key');
			Assert.ok(!/\$[a-z0-9_]+\$/i.test(Rendered), Locale + ':' + Key + ': unresolved placeholder');
		}
		for (const [Sentence, Emphasis] of [['hint_stream_playback', 'hint_playback_actions'], ['hint_stream_retry', 'hint_reload_page']])
		{
			const Text = Translate(Emphasis);
			Assert.equal(Translate(Sentence, Text).split(Text).length, 2, Locale + ': single emphasis phrase');
		}
		Catalogs[Locale] = {messages: Keys.length, missing: 0, unresolvedPlaceholders: 0,
			identicalToEnglish: Locale === 'en' ? [] : Keys.filter(Key => Catalog[Key].message === English[Key].message)};
	}
}
finally
{
	globalThis.fetch = OriginalFetch;
}

const Report = {sourceFiles: Files.length, messagesPerLocale: Keys.length, locales: SupportedLocales.length,
	renderedMessages: Keys.length * SupportedLocales.length, missingReferences: MissingReferences,
	literalUiCandidates: LiteralUiCandidates, catalogs: Catalogs,
	externalErrorPassthrough: {input: 'Failed to fetch', rendered: ErrorText(new Error('Failed to fetch')),
		finding: 'Browser and third-party error messages without a localized message key are displayed verbatim and can remain in English'},
	scope: 'Static application source and actual translation-function output; installed browser UI not changed'};
await Mkdir(ArtifactPath(), {recursive: true});
await WriteFile(ArtifactPath('localization.json'), JSON.stringify(Report, null, 2) + '\n');
console.log(JSON.stringify({sourceFiles: Report.sourceFiles, locales: Report.locales, messagesPerLocale: Keys.length,
	renderedMessages: Report.renderedMessages, missingReferences: MissingReferences.length, literalUiCandidates: LiteralUiCandidates.length}));
