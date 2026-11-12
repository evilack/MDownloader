import {readFile, readdir, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import Path from 'node:path';
import {build} from 'esbuild';
import {AssertExtensionFilenames} from '../lib/extension-files.mjs';
const {parse} = createRequire(import.meta.url)('internal/deps/acorn/acorn/dist/acorn');
const Args = process.argv.slice(2), Flavor = Args[Args.indexOf('--flavor') + 1];
if (!Args.includes('--flavor') || !['development', 'chrome-store', 'edge-store'].includes(Flavor)) throw new Error('Explicit --flavor required');
const Root = Path.resolve(Args.includes('--root') ? Args[Args.indexOf('--root')+1] : fileURLToPath(new URL(`../../artifacts/distributions/${Flavor}/extension/`, import.meta.url))) + Path.sep;
const Files = [];
async function Walk(Directory) {
 for (const Item of await readdir(Directory, {withFileTypes: true})) {
  const Name = Path.join(Directory, Item.name);
  if (Item.isDirectory()) await Walk(Name); else Files.push(Path.relative(Root, Name).replaceAll('\\', '/'));
 }
}
await Walk(Root);
await AssertExtensionFilenames(Root);
async function Reference(From, Value) {
 if (/^(?:[a-z]+:|#)/i.test(Value)) throw new Error('Nonlocal executable reference: ' + From);
 const Target = Path.resolve(Root, Path.dirname(From), Value.split(/[?#]/)[0]);
 if (!Target.startsWith(Root) || !(await stat(Target)).isFile()) throw new Error('Missing/outside reference: ' + From);
}
let Imports = 0;
for (const File of Files) {
 if (Flavor === 'chrome-store' && (/^(?:vendor|features)\/youtube\//.test(File) || /(?:evaluator|youtube.*bundle|youtube-brand)/i.test(File))) throw new Error('YouTube executable/asset in store: ' + File);
 if (!/\.(?:js|mjs|html)$/.test(File)) continue;
 const Source = await readFile(Path.join(Root, File), 'utf8');
 if (Flavor === 'chrome-store' && /features\/youtube|DiscoverYoutube|ResolveYoutubeSelection|HandleYoutubeRunner|ReadYoutubeBroadcast|YoutubeBroadcastInDocument|ytInitialPlayerResponse|i\.ytimg\.com|youtubeQualities|includeYoutubeAutoCaptions|youtube-icon/.test(Source)) throw Error('Provider integration in Chrome store: ' + File);
 if (File.endsWith('.html')) {
  for (const Match of Source.matchAll(/<script[^>]+src=["']([^"']+)/g)) await Reference(File, Match[1]);
  continue;
 }
 const Tree = parse(Source, {ecmaVersion: 'latest', sourceType: 'module'});
 const Queue = [Tree];
 while (Queue.length) {
  const Node = Queue.pop();
  if (Flavor === 'chrome-store' && Node.type === 'Identifier' && /youtube/i.test(Node.name) && !['CanUseYoutube','YoutubeSourceBlocked','IsYoutubeSource','YoutubeDomains','YoutubeHost','ObserveYoutubePolicyNotice','youtubeSource','youtube','youtubeEnabled'].includes(Node.name)) throw Error('Unexpected provider symbol in Chrome: ' + File + ': ' + Node.name);
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(Node.type) && Node.source) {
   if (typeof Node.source.value !== 'string') throw new Error('Nonliteral import: ' + File);
   await Reference(File, Node.source.value); Imports++;
  }
  for (const Value of Object.values(Node)) {
   if (Value && typeof Value === 'object') { if (Array.isArray(Value)) Queue.push(...Value.filter(Item => Item?.type)); else if (Value.type) Queue.push(Value); }
  }
 }
}
const Manifest = JSON.parse(await readFile(Path.join(Root, 'manifest.json'), 'utf8'));
for (const Value of [Manifest.background.service_worker, Manifest.action.default_popup, Manifest.options_page, Manifest.side_panel.default_path, Manifest.devtools_page, ...Object.values(Manifest.icons), ...Object.values(Manifest.action.default_icon)]) await Reference('manifest.json', Value);
for(const Value of Manifest.sandbox?.pages??[])await Reference('manifest.json',Value);
if(Flavor==='chrome-store'&&(Manifest.sandbox||Manifest.content_security_policy?.sandbox))throw Error('YouTube sandbox policy in store');
const Policy = await import((await import('node:url')).pathToFileURL(Path.join(Root,'lib/distribution-policy.js')));
if (Policy.DistributionPolicy.flavor !== Flavor || Flavor === 'chrome-store' && Policy.CanUseYoutube(undefined, 'edge')) throw new Error('Wrong policy');
if (Flavor !== 'chrome-store' && !Policy.CanUseYoutube(undefined, 'edge')) throw Error('Full provider disabled');
// Linking checks named exports as well as paths; output is discarded, never replaces shipped modules.
await build({entryPoints:Files.filter(File => /\.m?js$/.test(File)).map(File => Path.join(Root,File)), bundle:true,write:false,outdir:Path.join(Root,'verify-only'),platform:'browser',format:'esm',target:'chrome116',logLevel:'silent'});
if (Flavor === 'chrome-store') {
 for (const Locale of await readdir(Path.join(Root,'_locales'))) {
  const Catalog = JSON.parse(await readFile(Path.join(Root,'_locales',Locale,'messages.json'),'utf8'));
  if (!Catalog.youtube_store_policy_notice?.message || !Catalog.youtube_distribution_disabled?.message) throw Error('Missing policy notice: ' + Locale);
  if (Object.keys(Catalog).some(Key => /youtube/i.test(Key) && !['youtube_store_policy_notice','youtube_distribution_disabled'].includes(Key))) throw Error('Provider locale in Chrome: ' + Locale);
 }
 for (const Page of ['popup','sidepanel']) {
  if (!(await readFile(Path.join(Root,Page+'.html'),'utf8')).includes('data-youtube-policy-notice') || !(await readFile(Path.join(Root,Page+'.js'),'utf8')).includes('ObserveYoutubePolicyNotice')) throw Error('Missing site policy notice: ' + Page);
 }
 if (/youtube-caption-settings|include-youtube-auto-captions/.test(await readFile(Path.join(Root,'options.html'),'utf8'))) throw Error('Provider settings in Chrome');
}
console.log(JSON.stringify({flavor: Flavor, files: Files.length, imports: Imports, verified: true}));
