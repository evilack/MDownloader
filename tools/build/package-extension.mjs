import {cp, mkdir, readFile, writeFile, rm, rename} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WriteExplorerInstaller} from './build-explorer-installer.mjs';
import {WriteCaptionInstaller} from './build-caption-installer.mjs';
import {WriteMacCommonInstaller} from './build-mac-common-installer.mjs';
import {AssertExtensionFilenames} from '../lib/extension-files.mjs';
const Root = fileURLToPath(new URL('../../', import.meta.url));
await AssertExtensionFilenames(Path.join(Root,'extension'));
const Args = process.argv.slice(2);
const Flavor = Args[Args.indexOf('--flavor') + 1];
if (!Args.includes('--flavor') || !['development', 'chrome-store'].includes(Flavor) || Args.some((Arg, Index) => Index !== Args.indexOf('--flavor') && Index !== Args.indexOf('--flavor') + 1 && Arg !== '--block-chrome')) throw new Error('Required: --flavor development|chrome-store [--block-chrome]');
const Output = Path.join(Root, 'artifacts/distributions', Flavor);
const Stage = Path.join(Output, 'staging-' + process.pid);
await mkdir(Output, {recursive: true});
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
	if(Flavor==='chrome-store'){delete Manifest.sandbox;if(Manifest.content_security_policy){delete Manifest.content_security_policy.sandbox;if(!Object.keys(Manifest.content_security_policy).length)delete Manifest.content_security_policy;}}
	await writeFile(ManifestPath, JSON.stringify(Manifest, null, 2) + '\n');
}
if (Flavor === 'chrome-store')
{
	await mkdir(Path.join(Stage, 'features/youtube'), {recursive: true});
	await writeFile(Path.join(Stage, 'features/youtube/entry.js'), `import {LocalizedError} from '../../lib/i18n.js';\nexport const YoutubeAvailable = () => false;\nexport async function DiscoverYoutube() { throw new LocalizedError('youtube_distribution_disabled'); }\nexport async function ResolveYoutubeSelection() { throw new LocalizedError('youtube_distribution_disabled'); }\nexport async function SetYoutubeRequestContext() { throw new LocalizedError('youtube_distribution_disabled'); }\nexport async function FinishYoutube() { throw new LocalizedError('youtube_distribution_disabled'); }\nexport async function SavePartialYoutube() { throw new LocalizedError('youtube_distribution_disabled'); }\nexport async function CancelYoutube() { throw new LocalizedError('youtube_distribution_disabled'); }\nexport async function HandleYoutubeRunner() { throw new LocalizedError('youtube_distribution_disabled'); }\n`);
}
// 출력 경로는 위의 열거형에서만 결정하며, 사용 중 원본 extension은 수정하지 않습니다.
const Destination = Path.join(Output, 'extension');
await rm(Destination, {recursive: true, force: true});
await rename(Stage, Destination);
console.log(JSON.stringify({flavor: Flavor, extension: Destination}));
