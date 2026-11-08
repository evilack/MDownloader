import {build} from 'esbuild';
import {readFile, writeFile, mkdir, readdir, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Path from 'node:path';
import {fileURLToPath} from 'node:url';
const Root = fileURLToPath(new URL('../../', import.meta.url));
const Output = Path.join(Root, 'extension/vendor/youtube');
await mkdir(Output, {recursive: true});
for (const [Input, Name] of [['tools/build/youtube-client-entry.mjs', 'client-bundle.mjs'], ['tools/build/youtube-evaluator-worker.mjs', 'evaluator-worker.mjs'], ['tools/build/youtube-sabr-entry.mjs', 'sabr-bundle.mjs']])
{
	const Result = await build({absWorkingDir: Root, entryPoints: [Input], outfile: Path.join(Output, Name), bundle: true, platform: 'browser', format: 'esm', target: 'chrome116', legalComments: 'eof', metafile: true, sourcemap: false});
	await mkdir(Path.join(Root, 'artifacts/youtube-implementation'), {recursive: true});
	await writeFile(Path.join(Root, 'artifacts/youtube-implementation', Name + '.meta.json'), JSON.stringify(Result.metafile, null, 2));
}
for (const Name of ['youtubei.js', 'jintr', 'googlevideo', '@bufbuild/protobuf', 'fflate', 'meriyah', 'acorn'])
{
	const Directory = Path.join(Root, 'node_modules', Name);
	for (const File of await readdir(Directory)) if (/^(?:LICENSE|COPYING|NOTICE)/i.test(File)) await copyFile(Path.join(Directory, File), Path.join(Output, Name.replaceAll('/', '-') + '-' + File));
}
// protobuf's npm tarball omits the top-level Apache text; the pinned upstream copy is retained locally.
// Its varint source carries the additional BSD-3-Clause notice verbatim.
const Varint = await readFile(Path.join(Root, 'node_modules/@bufbuild/protobuf/dist/esm/wire/varint.js'), 'utf8');
await writeFile(Path.join(Output, 'bufbuild-protobuf-LICENSE-BSD'), Varint.split('/**', 1)[0].replace(/^\/\/ ?/gm, ''));
await readFile(Path.join(Output, 'bufbuild-protobuf-LICENSE-APACHE'));
const Files = {};
for (const File of await readdir(Output)) if (File !== 'provenance.json') Files[File] = createHash('sha256').update(await readFile(Path.join(Output, File))).digest('hex');
const Lock = JSON.parse(await readFile(Path.join(Root, 'package-lock.json'), 'utf8'));
const Versions = Object.fromEntries(['youtubei.js', 'jintr', 'googlevideo', 'esbuild', '@bufbuild/protobuf', 'fflate', 'meriyah', 'acorn'].map(Name => [Name, Lock.packages['node_modules/' + Name].version]));
await writeFile(Path.join(Output, 'provenance.json'), JSON.stringify({versions: Versions, lockfileSha256: createHash('sha256').update(await readFile(Path.join(Root, 'package-lock.json'))).digest('hex'), files: Files}, null, 2) + '\n');
console.log(JSON.stringify({output: Output, files: Object.keys(Files).length}));
