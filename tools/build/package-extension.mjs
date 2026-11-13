import {cp, mkdir, readFile, writeFile, rm, rename, open} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WriteExplorerInstaller} from './build-explorer-installer.mjs';
import {WriteCaptionInstaller} from './build-caption-installer.mjs';
import {WriteMacCommonInstaller} from './build-mac-common-installer.mjs';
import {AssertExtensionFilenames} from '../lib/extension-files.mjs';
import {spawnSync} from 'node:child_process';
import {WriteDistributionArchive} from '../lib/distribution-archive.mjs';
const Root = fileURLToPath(new URL('../../', import.meta.url));
await AssertExtensionFilenames(Path.join(Root,'extension'));
const Args = process.argv.slice(2);
const Flavor = Args[Args.indexOf('--flavor') + 1];
if (!Args.includes('--flavor') || !['development', 'chrome-store'].includes(Flavor) || Args.some((Arg, Index) => Index !== Args.indexOf('--flavor') && Index !== Args.indexOf('--flavor') + 1 && Arg !== '--block-chrome') || Args.includes('--block-chrome') && Flavor !== 'development') throw new Error('Required: --flavor development|chrome-store [--block-chrome (development only)]');
const Output = Path.join(Root, 'artifacts/distributions', Flavor);
const Stage = Path.join(Output, 'staging-' + process.pid);
await mkdir(Output, {recursive: true});
const LockPath = Path.join(Output,'.build.lock');
let Lock;
for (let Attempt = 0; !Lock; Attempt++) {
	try { Lock = await open(LockPath,'wx'); }
	catch (ErrorValue) {
		if (ErrorValue.code !== 'EEXIST') throw ErrorValue;
		if (Attempt >= 300) throw Error('Build already running or stale lock: ' + LockPath);
		await new Promise(Resolve => setTimeout(Resolve,100));
	}
}
let ZipStage;
try {
await Lock.writeFile(String(process.pid));
await cp(Path.join(Root, 'extension'), Stage, {recursive: true, filter: Source => Source !== Path.join(Root, 'extension', '.local') && (Flavor !== 'chrome-store' || !['features/youtube', 'vendor/youtube'].some(Excluded => Source === Path.join(Root, 'extension', Excluded)))});
await cp(Path.join(Root, 'native', 'kakao'), Path.join(Stage, 'native', 'kakao'), {recursive:true,
	filter: Source => !['host.cmd', 'host-manifest.json', '__pycache__'].includes(Path.basename(Source))});
let Policy = await readFile(Path.join(Stage, 'lib/distribution-policy.js'), 'utf8');
await WriteExplorerInstaller(Root,Path.join(Stage,'data/explorer-installer.json'));
await WriteCaptionInstaller(Root,Path.join(Stage,'data/caption-installer.json'));
await WriteMacCommonInstaller(Root,Path.join(Stage,'data/mac-common-installer.json'));
Policy = Policy.replace(/export const DistributionPolicy = .*?;/, `export const DistributionPolicy = Object.freeze({flavor: '${Flavor}', youtubeEnabled: ${Flavor !== 'chrome-store'}, blockedBrowserFamilies: Object.freeze(${JSON.stringify(Args.includes('--block-chrome') ? ['chrome'] : [])})});`);
await writeFile(Path.join(Stage, 'lib/distribution-policy.js'), Policy);
if (Flavor === 'chrome-store' || Args.includes('--block-chrome'))
{
	const ManifestPath = Path.join(Stage, 'manifest.json');
	const Manifest = JSON.parse(await readFile(ManifestPath, 'utf8'));
	// block 규칙은 대상 host permission이 없어도 작동해야 합니다. 헤더 수정은 여전히 host 권한을 요구합니다.
	Manifest.permissions = Manifest.permissions.map(Value => Value === 'declarativeNetRequestWithHostAccess' ? 'declarativeNetRequest' : Value);
	// 스토어판은 사이트 접근 권한 없이도 사이드 패널에서 현재 탭의 정책 안내를 표시합니다.
	if (Flavor === 'chrome-store' && !Manifest.permissions.includes('tabs')) Manifest.permissions.push('tabs');
	if (Flavor === 'chrome-store')
	{
		Manifest.name = '__MSG_chrome_store_name__';
		const StoreNames = {
			en: `${Manifest.short_name} – Media, MP4, HLS (M3U8) & Live Stream Downloader`,
			ko: `${Manifest.short_name} – Media, MP4, HLS (M3U8) 및 라이브 스트림 다운로드`,
			ar: `${Manifest.short_name} – تنزيل الوسائط وMP4 وHLS (M3U8) والبث المباشر`,
			es: `${Manifest.short_name} – Descarga vídeos, MP4, HLS (M3U8) y directos`,
			fr: `${Manifest.short_name} – Téléchargez vidéos, MP4, HLS (M3U8) et directs`,
			hi: `${Manifest.short_name} – मीडिया, MP4, HLS (M3U8) और लाइव स्ट्रीम डाउनलोड`,
			ja: `${Manifest.short_name} – メディア・MP4・HLS (M3U8)・ライブ配信のダウンロード`,
			pt_BR: `${Manifest.short_name} – Baixe vídeos, MP4, HLS (M3U8) e transmissões ao vivo`,
			ru: `${Manifest.short_name} – Загрузка видео, MP4, HLS (M3U8) и прямых эфиров`,
			zh_CN: `${Manifest.short_name} – 媒体、MP4、HLS (M3U8) 和直播流下载`
		};
		for (const [Locale, Name] of Object.entries(StoreNames))
		{
			if (Name.length > 75) throw Error(`Chrome Web Store name exceeds 75 characters: ${Locale}`);
			const CatalogPath = Path.join(Stage, '_locales', Locale, 'messages.json');
			const Catalog = JSON.parse(await readFile(CatalogPath, 'utf8'));
			Catalog.chrome_store_name = {message: Name};
			await writeFile(CatalogPath, JSON.stringify(Catalog, null, 2) + '\n');
		}
		delete Manifest.sandbox;
		if (Manifest.content_security_policy)
		{
			delete Manifest.content_security_policy.sandbox;
			if (!Object.keys(Manifest.content_security_policy).length) delete Manifest.content_security_policy;
		}
	}
	await writeFile(ManifestPath, JSON.stringify(Manifest, null, 2) + '\n');
}
if (Flavor === 'chrome-store')
{
	const Strip = spawnSync(process.execPath, ['--expose-internals', Path.join(Root,'tools/build/strip-chrome-provider.mjs'), Stage], {cwd:Root,encoding:'utf8'});
	if (Strip.status !== 0) throw Error(Strip.stderr || String(Strip.error));
}
const Verify = spawnSync(process.execPath, ['--expose-internals', Path.join(Root,'tools/checks/verify-distribution.mjs'), '--flavor', Flavor, '--root', Stage], {cwd:Root,encoding:'utf8'});
if (Verify.status !== 0) throw Error(Verify.stderr || Verify.stdout || String(Verify.error));
const Manifest = JSON.parse(await readFile(Path.join(Stage,'manifest.json'),'utf8'));
const ZipName = `MDownloader-${Flavor}-${Manifest.version}${Args.includes('--block-chrome') ? '-restricted' : ''}.zip`;
ZipStage = Path.join(Output, ZipName + '.tmp');
const Archive = await WriteDistributionArchive(Stage, ZipStage);
// 출력 경로는 위의 열거형에서만 결정하며, 사용 중 원본 extension은 수정하지 않습니다.
const Destination = Path.join(Output, 'extension');
await rm(Destination, {recursive: true, force: true});
await rename(Stage, Destination);
const Zip = Path.join(Output, ZipName);
await rename(ZipStage, Zip);
const Metadata = {flavor:Flavor,version:Manifest.version,extension:Destination,zip:Zip,...Archive};
await writeFile(Path.join(Output,'build.json'),JSON.stringify(Metadata,null,2)+'\n');
console.log(JSON.stringify(Metadata));
} finally {
	try {
		const Cleanup = await Promise.allSettled([rm(Stage,{recursive:true,force:true}), ...(ZipStage ? [rm(ZipStage,{force:true})] : [])]);
		const Errors = Cleanup.filter(Result => Result.status === 'rejected').map(Result => Result.reason);
		if (Errors.length) throw new AggregateError(Errors,'Distribution cleanup failed');
	} finally {
		try { await Lock.close(); }
		finally { await rm(LockPath,{force:true}); }
	}
}
