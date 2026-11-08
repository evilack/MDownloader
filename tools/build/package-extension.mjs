import {cp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath} from 'node:url';
const Root = fileURLToPath(new URL('../../', import.meta.url));
const Args = process.argv.slice(2);
const Flavor = Args[Args.indexOf('--flavor') + 1];
if (!Args.includes('--flavor') || !['development', 'chrome-store'].includes(Flavor) || Args.some((Arg, Index) => Index !== Args.indexOf('--flavor') && Index !== Args.indexOf('--flavor') + 1 && Arg !== '--block-chrome')) throw new Error('Required: --flavor development|chrome-store [--block-chrome]');
const Output = Path.join(Root, 'artifacts/distributions', Flavor);
const Stage = Path.join(Output, 'staging-' + process.pid);
await mkdir(Output, {recursive: true});
await cp(Path.join(Root, 'extension'), Stage, {recursive: true, filter: Source => Flavor !== 'chrome-store' || !['features/youtube', 'vendor/youtube'].some(Excluded => Source === Path.join(Root, 'extension', Excluded))});
let Policy = await readFile(Path.join(Stage, 'lib/distribution-policy.js'), 'utf8');
Policy = Policy.replace(/export const DistributionPolicy = .*?;/, `export const DistributionPolicy = Object.freeze({flavor: '${Flavor}', youtubeEnabled: ${Flavor !== 'chrome-store'}, blockedBrowserFamilies: Object.freeze(${JSON.stringify(Args.includes('--block-chrome') ? ['chrome'] : [])})});`);
await writeFile(Path.join(Stage, 'lib/distribution-policy.js'), Policy);
if (Flavor === 'chrome-store' || Args.includes('--block-chrome'))
{
	const ManifestPath = Path.join(Stage, 'manifest.json');
	const Manifest = JSON.parse(await readFile(ManifestPath, 'utf8'));
	// block 규칙은 대상 host permission이 없어도 작동해야 합니다. 헤더 수정은 여전히 host 권한을 요구합니다.
	Manifest.permissions = Manifest.permissions.map(Value => Value === 'declarativeNetRequestWithHostAccess' ? 'declarativeNetRequest' : Value);
	await writeFile(ManifestPath, JSON.stringify(Manifest, null, 2) + '\n');
}
if (Flavor === 'chrome-store')
{
	await mkdir(Path.join(Stage, 'features/youtube'), {recursive: true});
	await writeFile(Path.join(Stage, 'features/youtube/entry.js'), `import {LocalizedError} from '../../lib/i18n.js';\nexport const YoutubeAvailable = () => false;\nexport async function DiscoverYoutube() { throw new LocalizedError('youtube_distribution_disabled'); }\nexport async function ResolveYoutubeSelection() { throw new LocalizedError('youtube_distribution_disabled'); }\n`);
}
// 출력 경로는 위의 열거형에서만 결정하며, 사용 중 원본 extension은 수정하지 않습니다.
const Destination = Path.join(Output, 'extension');
await rm(Destination, {recursive: true, force: true});
await cp(Stage, Destination, {recursive: true});
await rm(Stage, {recursive: true});
console.log(JSON.stringify({flavor: Flavor, extension: Destination}));
