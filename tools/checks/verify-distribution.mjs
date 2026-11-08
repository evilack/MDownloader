import {readFile, readdir, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import Path from 'node:path';
import {AssertExtensionFilenames} from '../lib/extension-files.mjs';
const {parse} = createRequire(import.meta.url)('internal/deps/acorn/acorn/dist/acorn');
const Args = process.argv.slice(2), Flavor = Args[Args.indexOf('--flavor') + 1];
if (!Args.includes('--flavor') || !['development', 'chrome-store'].includes(Flavor)) throw new Error('Explicit --flavor required');
const Root = fileURLToPath(new URL(`../../artifacts/distributions/${Flavor}/extension/`, import.meta.url));
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
 if (Flavor === 'chrome-store' && (/^vendor\/youtube\//.test(File) || /^features\/youtube\//.test(File) && File !== 'features/youtube/entry.js' || /(?:evaluator|youtube.*bundle)/i.test(File))) throw new Error('YouTube executable in store: ' + File);
 if (!/\.(?:js|mjs|html)$/.test(File)) continue;
 const Source = await readFile(Path.join(Root, File), 'utf8');
 if (File.endsWith('.html')) {
  for (const Match of Source.matchAll(/<script[^>]+src=["']([^"']+)/g)) await Reference(File, Match[1]);
  continue;
 }
 const Tree = parse(Source, {ecmaVersion: 'latest', sourceType: 'module'});
 const Queue = [Tree];
 while (Queue.length) {
  const Node = Queue.pop();
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
for (const Value of [Manifest.background.service_worker, Manifest.action.default_popup, Manifest.options_page, Manifest.side_panel.default_path, Manifest.devtools_page, ...Object.values(Manifest.icons)]) await Reference('manifest.json', Value);
for(const Value of Manifest.sandbox?.pages??[])await Reference('manifest.json',Value);
if(Flavor==='chrome-store'&&(Manifest.sandbox||Manifest.content_security_policy?.sandbox))throw Error('YouTube sandbox policy in store');
const Policy = await import(new URL('../../artifacts/distributions/' + Flavor + '/extension/lib/distribution-policy.js', import.meta.url));
if (Policy.DistributionPolicy.flavor !== Flavor || Flavor === 'chrome-store' && Policy.CanUseYoutube(undefined, 'edge')) throw new Error('Wrong policy');
console.log(JSON.stringify({flavor: Flavor, files: Files.length, imports: Imports, verified: true}));
