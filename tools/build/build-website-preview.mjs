/** Publish a static demo built from current extension UI; never load extension backends. */
import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Path from 'node:path';
import {fileURLToPath} from 'node:url';
const Root=fileURLToPath(new URL('../../',import.meta.url));
const Output=Path.join(Root,'website/preview');
await mkdir(Path.join(Output,'lib'),{recursive:true});
const Result=await build({entryPoints:[Path.join(Root,'tools/dev/homepage-preview.js')],outfile:Path.join(Output,'lib/app.js'),bundle:true,format:'esm',platform:'browser',target:'chrome116',minify:true,metafile:true,legalComments:'eof'});
const Files=['style.css','media-row.css','download-options.css','local-captions.css',
 ...['refresh.png','options.png','download.png','cancel.png','stop-save.png','folder.png','delete.png','link.png','app-media-48.png','youtube-brand-32.png'].map(Name=>'icons/'+Name),
 ...['en','ko'].map(Locale=>'_locales/'+Locale+'/messages.json')];
for(const File of Files){await mkdir(Path.dirname(Path.join(Output,File)),{recursive:true});await copyFile(Path.join(Root,'extension',File),Path.join(Output,File));}
const Manifest=JSON.parse(await readFile(Path.join(Root,'extension/manifest.json'),'utf8'));
const Sources=[...new Set([...Object.keys(Result.metafile.inputs),...Files.map(File=>'extension/'+File)])].sort();
const Hashes=Object.fromEntries(await Promise.all(Sources.map(async File=>[File.replaceAll('\\','/'),createHash('sha256').update(await readFile(Path.resolve(Root,File))).digest('hex')])));
await writeFile(Path.join(Output,'source-manifest.json'),JSON.stringify({extensionVersion:Manifest.version,sources:Hashes},null,2)+'\n');
console.log(`Website preview: extension ${Manifest.version}, ${Sources.length} source files, ${Object.values(Result.metafile.outputs)[0].bytes} JS bytes`);
