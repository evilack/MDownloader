/** 현재 저장소의 구문·모듈·문서/웹 링크·manifest·보존 자산을 검사합니다.
 * 과거 감사 폴더에 의존하지 않아 새 체크아웃에서도 실행할 수 있습니다.
 * 검사 결과는 원본 문서 대신 Git에서 제외하는 실행 산출물 폴더에만 씁니다. */
import {readFile as ReadFile, readdir as Readdir, stat as Stat, mkdir as Mkdir, writeFile as WriteFile} from 'node:fs/promises';
import {spawnSync as SpawnSync} from 'node:child_process';
import {createHash as CreateHash} from 'node:crypto';
import {createRequire as CreateRequire} from 'node:module';
import {fileURLToPath as FileURLToPath, pathToFileURL as PathToFileURL} from 'node:url';
import Path from 'node:path';
import {ProjectPath, ArtifactPath} from '../lib/tool-config.mjs';
import {AssertExtensionFilenames} from '../lib/extension-files.mjs';
import {IconCatalog} from '../../extension/lib/icon-catalog.js';
const {parse: Parse} = CreateRequire(import.meta.url)('internal/deps/acorn/acorn/dist/acorn');
const Result = {javascript: 0, json: 0, relativeImports: 0, localReferences: 0, preservedFiles: 0, failures: []};
async function CheckReference(File, Reference)
{
	if (!Reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(Reference))
	{
		return;
	}
	const Relative = decodeURIComponent(Reference.split(/[?#]/, 1)[0]);
	if (!Relative)
	{
		return;
	}
	try
	{
		await Stat(Path.resolve(Path.dirname(ProjectPath(File)), Relative));
		Result.localReferences++;
	}
	catch
	{
		Result.failures.push({file: File, reason: 'Missing local reference: ' + Reference});
	}
}

async function VerifyFile(File)
{
	if (!/\.(?:m?js|json|md|html|css)$/.test(File))
	{
		return;
	}
	const Source = await ReadFile(ProjectPath(File), 'utf8');
	if (/\.(m?js)$/.test(File))
	{
		const Checked = SpawnSync(process.execPath, ['--check', ProjectPath(File)], {encoding: 'utf8'});
		if (Checked.status !== 0)
		{
			Result.failures.push({file: File, reason: Checked.stderr});
			return;
		}
		Result.javascript++;
		const Tree = Parse(Source, {ecmaVersion: 'latest', sourceType: 'module'});
		for (const Node of Tree.body)
		{
			const Specifier = Node.source?.value;
			if (typeof Specifier !== 'string' || !Specifier.startsWith('.'))
			{
				continue;
			}
			try
			{
				await Stat(FileURLToPath(new URL(Specifier, PathToFileURL(ProjectPath(File)))));
				Result.relativeImports++;
			}
			catch
			{
				Result.failures.push({file: File, reason: 'Missing relative import: ' + Specifier});
			}
		}
	}
	if (File.endsWith('.json'))
	{
		JSON.parse(Source);
		Result.json++;
	}
	if (/\.(html|md)$/.test(File))
	{
		for (const Match of Source.matchAll(/(?:href|src|data-animated-src|data-still-src)=["']([^"']+)["']/g))
		{
			await CheckReference(File, Match[1]);
		}
		if (File.endsWith('.md'))
		{
			for (const Match of Source.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g))
			{
				await CheckReference(File, Match[1]);
			}
		}
	}
	if (File.endsWith('.css'))
	{
		for (const Match of Source.matchAll(/url\(["']?([^\s)'";]+)["']?\)/g))
		{
			await CheckReference(File, Match[1]);
		}
	}
}

async function VerifyDirectory(Directory)
{
	for (const Entry of await Readdir(ProjectPath(Directory), {withFileTypes: true}))
	{
		if (['vendor', 'node_modules', 'artifacts'].includes(Entry.name))
		{
			continue;
		}
		const File = Path.join(Directory, Entry.name);
		if (Entry.isDirectory())
		{
			await VerifyDirectory(File);
		}
		else
		{
			await VerifyFile(File);
		}
	}
}

for (const Directory of ['extension', 'website', 'tools', 'tests', 'assets', 'docs'])
{
	await VerifyDirectory(Directory);
}
for (const File of ['README.md', 'THIRD_PARTY_NOTICES.md'])
{
	await VerifyFile(File);
}

const Catalog = JSON.parse(await ReadFile(ProjectPath('assets/catalog.json'), 'utf8'));
const Screenshots = JSON.parse(await ReadFile(ProjectPath('website/assets/screenshots/catalog.json'), 'utf8'));
const Provenance = JSON.parse(await ReadFile(ProjectPath('extension/vendor/youtube/provenance.json'), 'utf8'));
const Artifacts = [...Catalog.runtime, ...Catalog.sharedFiles, ...Object.values(Catalog.groups).flatMap(Group => Group.artifacts), ...Screenshots.screenshots,
	...Object.entries(Provenance.files).map(([Name, Hash]) => ({path: 'extension/vendor/youtube/' + Name, sha256: Hash})),
	{path: 'package-lock.json', sha256: Provenance.lockfileSha256}];
const RuntimeIcons = new Set(Catalog.runtime.map(File => File.path));
for (const Name of await Readdir(ProjectPath('extension/icons')))
{
	if (Name.endsWith('.png') && !RuntimeIcons.has('extension/icons/' + Name))
	{
		Result.failures.push({file: Name, reason: 'Uncatalogued runtime icon'});
	}
}
for (const Reference of [
	...Object.values(IconCatalog.actions), ...Object.values(IconCatalog.app), IconCatalog.brands.youtube,
	IconCatalog.previewFailure.src, ...IconCatalog.previewFailure.srcset.split(',').map(Value => Value.trim().split(' ')[0]),
])
{
	if (!RuntimeIcons.has('extension/' + Reference)) Result.failures.push({file: Reference, reason: 'Icon component references an uncatalogued asset'});
}
for (const File of Artifacts)
{
	try
	{
		const Hash = CreateHash('sha256').update(await ReadFile(ProjectPath(File.path))).digest('hex');
		if (Hash !== File.sha256)
		{
			Result.failures.push({file: File.path, reason: 'Retained asset hash changed'});
		}
		else
		{
			Result.preservedFiles++;
		}
	}
	catch
	{
		Result.failures.push({file: File.path, reason: 'Missing catalog asset'});
	}
}
const Manifest = JSON.parse(await ReadFile(ProjectPath('extension/manifest.json'), 'utf8'));
try{await AssertExtensionFilenames(ProjectPath('extension'));}catch(ErrorValue){Result.failures.push({file:'extension',reason:ErrorValue.message});}
for (const File of [Manifest.background.service_worker, Manifest.action.default_popup, Manifest.side_panel.default_path, Manifest.options_page, Manifest.devtools_page,
	...Object.values(Manifest.icons), ...Object.values(Manifest.action.default_icon)])
{
	try
	{
		await Stat(ProjectPath('extension', File));
	}
	catch
	{
		Result.failures.push({file: File, reason: 'Missing manifest entry'});
	}
}
await Mkdir(ArtifactPath(), {recursive: true});
await WriteFile(ArtifactPath('project-verification.json'), JSON.stringify(Result, null, 2) + '\n');
console.log(JSON.stringify(Result));
if (Result.failures.length)
{
	process.exitCode = 1;
}
