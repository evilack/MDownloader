/** Build-time removal, never obfuscation. Kept source policy/notice modules only deny access.
 * Run with --expose-internals for the same Node Acorn parser used by our verifier.
 * Parse expressions before pruning; never remove arbitrary lines containing a keyword.
 */
import {readFile, writeFile, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import Path from 'node:path';
import {transform} from 'esbuild';
import {DistributionFiles} from '../lib/distribution-archive.mjs';
const {parse} = createRequire(import.meta.url)('internal/deps/acorn/acorn/dist/acorn');
const Root = Path.resolve(process.argv[2]);
const PolicyModules = new Set(['lib/distribution-policy.js', 'lib/youtube-source-policy.js', 'lib/youtube-policy-notice.js', 'lib/distribution-network.js', 'lib/playback-authorization.js', 'lib/browser-download.js']);
const ProviderNames = /^(?:YoutubeAvailable|DiscoverYoutube|ResolveYoutubeSelection|SetYoutubeRequestContext|FinishYoutube|SavePartialYoutube|CancelYoutube|HandleYoutubeRunner|IdentifyYoutubeUrl)$/;
const DisabledProperty = /^(?:youtube|includeYoutubeAutoCaptions)$/;
function Prune(Source, File) {
 const Tree = parse(Source, {ecmaVersion:'latest', sourceType:'module'});
 const Text = Node => Source.slice(Node.start, Node.end);
 const Key = Node => Node?.name ?? Node?.value;
 function Render(Node) {
  if (Node.type === 'ImportDeclaration') {
   if (Node.source.value.includes('/features/youtube/')) return '';
   const Specifiers = Node.specifiers.filter(Item => !ProviderNames.test(Item.imported?.name ?? ''));
   if (Specifiers.length !== Node.specifiers.length) return Specifiers.length ? 'import {' + Specifiers.map(Text).join(',') + '} from ' + Text(Node.source) + ';' : '';
  }
  if (Node.type === 'FunctionDeclaration' && /^(?:ReadYoutubeBroadcast|YoutubeBroadcastInDocument)$/.test(Node.id.name)) return '';
  if (File === 'detection.js' && Node.type === 'VariableDeclaration' && Node.declarations.some(Item => Item.id.name === 'Youtube')) return '';
  if (File === 'detection.js' && Node.type === 'IfStatement' && Node.test.type === 'Identifier' && Node.test.name === 'Youtube') return '';
  if (File === 'media-badges.js' && Node.type === 'IfStatement' && Text(Node.test).includes('Source.youtube')) return '';
  if (Node.type === 'IfStatement' && File === 'detection.js' && Text(Node.test) === 'FrameSize === ThumbnailFrame && Page') return '';
  if (Node.type === 'SwitchCase' && (/^youtube/i.test(Node.test?.value ?? '') || File === 'jobs.js' && Node.test?.value === 'connecting')) return '';
  if (Node.type === 'CallExpression' && Node.callee.type === 'Identifier' && Node.callee.name === 'YoutubeAvailable') return 'false';
  if (Node.type === 'CallExpression' && Node.callee.type === 'Identifier' && Node.callee.name === 'CanUseYoutube' && !PolicyModules.has(File)) return 'false';
  if (Node.type === 'CallExpression' && Node.callee.type === 'Identifier' && Node.callee.name === 'IdentifyYoutubeUrl') return 'null';
  if (Node.type === 'BinaryExpression' && [Node.left,Node.right].some(Item => Item.type === 'Literal' && (Item.value === 'YOUTUBE' || /^youtube(?:RequestContext|Permission)$/.test(Item.value ?? '')))) return ['!==','!='].includes(Node.operator) ? 'true' : 'false';
  if (Node.type === 'MemberExpression' && DisabledProperty.test(Key(Node.property))) return 'false';
  if (Node.type === 'ConditionalExpression' && Node.consequent.type === 'CallExpression' && Node.consequent.arguments?.[0]?.value === 'view_youtube_scheduled_quality') return Render(Node.alternate);
  if (Node.type === 'ExpressionStatement' && /Q\('youtube-caption-settings'\)/.test(Text(Node))) return '';
  if (Node.type === 'IfStatement' && File === 'job-row.js' && /view_youtube_waiting/.test(Text(Node))) return '';
  // Classification remains a security guard, including legacy provider jobs.
  if (Node.type === 'Property' && Key(Node.key) === 'youtubeSource') return Text(Node);
  if (Node.type === 'ObjectExpression') return '{' + Node.properties.filter(Item => !DisabledProperty.test(Key(Item.key)) && !DisabledProperty.test(Key(Item.key?.property)) && Key(Item.key) !== 'youtubeIds').map(Render).join(',') + '}';
  if (Node.type === 'ArrayExpression') return '[' + Node.elements.filter(Item => Item?.type !== 'Literal' || !(Item.value === 'YOUTUBE' || /^(?:youtube|includeYoutube)/i.test(Item.value ?? ''))).map(Item => Item ? Render(Item) : '').join(',') + ']';
  const Children = Object.entries(Node).filter(([Key]) => !['start','end'].includes(Key)).flatMap(([,Value]) => Array.isArray(Value) ? Value : [Value]).filter(Value => Value?.type && Number.isInteger(Value.start)).sort((A,B) => A.start-B.start);
  let Position = Node.start, Result = '';
  for (const Child of Children) {
   if (Child.start < Position) continue; // shorthand property key/value share their range
   Result += Source.slice(Position, Child.start) + Render(Child); Position = Child.end;
  }
  return Result + Source.slice(Position, Node.end);
 }
 return Render(Tree);
}
for (const File of await DistributionFiles(Root)) {
 const Destination = Path.join(Root, File);
 if (File === 'icons/youtube-brand-32.png') { await rm(Destination); continue; }
 if (/^_locales\/[^/]+\/messages\.json$/.test(File)) {
  const Catalog = JSON.parse(await readFile(Destination,'utf8'));
  for (const Key of Object.keys(Catalog)) if (/youtube/i.test(Key) && !['youtube_store_policy_notice','youtube_distribution_disabled'].includes(Key)) delete Catalog[Key];
  await writeFile(Destination, JSON.stringify(Catalog,null,2)+'\n'); continue;
 }
 if (File === 'options.html') {
  let Source = await readFile(Destination,'utf8');
  Source = Source.replace(/<div class="toggle-row" id="youtube-caption-settings"[\s\S]*?<\/div><p id="youtube-caption-settings-status"[\s\S]*?<\/p><p id="youtube-auto-captions-help"[\s\S]*?<\/p>/,'');
  Source = Source.replace('개발판에서는 YouTube 다운로드를 사용할 수 있습니다.','이 배포판에서는 YouTube 다운로드를 지원하지 않습니다.').replace('id="about-build">개발판 · 수동 설치','id="about-build">공통 스토어판');
  await writeFile(Destination,Source); continue;
 }
 if (File === 'lib/youtube-source-policy.js') {
  // URL extraction belongs to the removed provider. Host classification below stays for denial.
  const Source = await readFile(Destination,'utf8'), Tree = parse(Source,{ecmaVersion:'latest',sourceType:'module'});
  const Extraction = Tree.body.find(Node => Node.type === 'ExportNamedDeclaration' && Node.declaration?.id?.name === 'IdentifyYoutubeUrl');
  if (!Extraction) throw Error('Expected provider URL extraction export');
  await writeFile(Destination,Source.slice(0,Extraction.start)+Source.slice(Extraction.end)); continue;
 }
 if (File.endsWith('.css')) {
  const Source = await readFile(Destination,'utf8');
  await writeFile(Destination, Source.replace(/[^{}]*?(?:\.youtube-icon|#youtube-caption-settings)[^{}]*\{[^{}]*\}/g,'')); continue;
 }
 if (!/\.m?js$/.test(File) || File.startsWith('vendor/') || PolicyModules.has(File)) continue;
 let Source = await readFile(Destination,'utf8');
 if (!/youtube/i.test(Source)) continue;
 if (File === 'hls-runner.js') Source = Source.replace(/void \(YoutubeAvailable\(\)[\s\S]*?\.then\(YoutubeIds =>\s*Respond\((\{requestIds:[^;]+?)\)\);/, 'Respond($1);');
 if (File === 'lib/icon-catalog.js') Source = Source.replace(/brands: Object.freeze\(\{youtube: '[^']+'\}\)/,"brands: Object.freeze({})");
 // No settings node exists in the store artifact. Keep the policy explanation in About.
 if (File === 'settings-ui.js') Source = Source.replace(/;Q\('youtube-caption-settings'\)\.hidden=!CanUseYoutube\(\)/,'');
 const Pruned = Prune(Source,File);
 const Result = await transform(Pruned,{loader:'js',format:'esm',target:'chrome116',minifySyntax:true,treeShaking:true,legalComments:'none'});
 await writeFile(Destination,Result.code);
}
