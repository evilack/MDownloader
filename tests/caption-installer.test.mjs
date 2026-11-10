import test from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile,mkdtemp} from 'node:fs/promises';import Path from 'node:path';import {tmpdir} from 'node:os';import {inflateSync,gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {CreateWindowsCaptionInstaller} from '../extension/lib/caption-installer.js';import {CreateMacCaptionPackage} from '../extension/lib/mac-caption-package.js';
import {WriteCaptionInstaller,CaptionInstallerFiles} from '../tools/build/build-caption-installer.mjs';
import {CaptionPackageVersion} from '../extension/data/caption-runtime-metadata.js';
async function bundle(){const Root=await mkdtemp(Path.join(tmpdir(),'mdownloader-caption-installer-')),File=Path.join(Root,'payload.json');await WriteCaptionInstaller(Path.resolve('.'),File);return JSON.parse(await readFile(File,'utf8'));}
test('packaged bootstrap carries every exact source and hash without including models',async()=>{
 const Bundle=await bundle();assert.equal(Bundle.version,1);assert.equal(Bundle.packageVersion,CaptionPackageVersion);assert.equal(Bundle.packageVersion,10);assert.deepEqual(Object.keys(Bundle.files),CaptionInstallerFiles);
 for(const [Name,File] of Object.entries(Bundle.files)){const Bytes=await readFile('native/captions/'+Name);assert.equal(File.base64,Bytes.toString('base64'));assert.equal(File.sha256,createHash('sha256').update(Bytes).digest('hex'));}
 assert.ok(!Object.keys(Bundle.files).some(N=>/model|\.bin$/.test(N)));
});
test('Windows installer binds this extension ID and verifies extracted payload bytes',async()=>{
 const Bundle=await bundle(),Text=CreateWindowsCaptionInstaller(Bundle,'a'.repeat(32));
 const Script=Buffer.from(Text.split('::MDOWNLOADER_CAPTION_PAYLOAD::').at(-1).trim(),'base64').toString('utf8');
 assert.match(Script,/-ExtensionId 'a{32}'/);assert.match(Script,/Get-FileHash/);assert.match(Script,/bootstrap.ps1/);assert.doesNotMatch(Script,/prepare_model|prepareModel/);
 assert.throws(()=>CreateWindowsCaptionInstaller(Bundle,"';bad"));
});
test('macOS package contains executable bootstrap and postinstall in a valid XAR/newc archive',async()=>{
 const Bundle=await bundle(),Bytes=await CreateMacCaptionPackage(Bundle,'a'.repeat(32)),Header=Buffer.from(Bytes),TocSize=Number(Header.readBigUInt64BE(8));
 assert.equal(Header.subarray(0,4).toString(),'xar!');assert.equal(Header.readUInt16BE(4),28);
 const Toc=inflateSync(Header.subarray(28,28+TocSize)).toString();assert.match(Toc,/<name>PackageInfo<\/name>/);assert.match(Toc,/<name>Scripts<\/name>/);
 const Files=[...Toc.matchAll(/<name>([^<]+)<\/name>.*?<length>(\d+)<\/length><offset>(\d+)<\/offset>/g)];
 const Scripts=Files.find(F=>F[1]==='Scripts'),Offset=28+TocSize+Number(Scripts[3]);const Cpio=gunzipSync(Header.subarray(Offset,Offset+Number(Scripts[2])));
 let Pos=0;const Entries=new Map();while(Pos<Cpio.length){assert.equal(Cpio.subarray(Pos,Pos+6).toString(),'070701');const Mode=parseInt(Cpio.subarray(Pos+14,Pos+22).toString(),16),Size=parseInt(Cpio.subarray(Pos+54,Pos+62).toString(),16),NameSize=parseInt(Cpio.subarray(Pos+94,Pos+102).toString(),16);const Name=Cpio.subarray(Pos+110,Pos+110+NameSize-1).toString();Pos=Math.ceil((Pos+110+NameSize)/4)*4;const Content=Cpio.subarray(Pos,Pos+Size);Pos=Math.ceil((Pos+Size)/4)*4;if(Name==='TRAILER!!!')break;Entries.set(Name,{Mode,Content});}
 assert.equal(Entries.get('./postinstall').Mode,0o100755);assert.match(Entries.get('./postinstall').Content.toString(),/a{32}/);assert.equal(Entries.get('./bootstrap.sh').Mode,0o100755);assert.ok(Entries.has('./verify_install.py'));
 await writeFile('artifacts/MDownloader-Captions-Package-Structure-Test.pkg',Bytes);
 Bundle.files['host.py'].base64='YmFk';await assert.rejects(CreateMacCaptionPackage(Bundle,'a'.repeat(32)),/checksum/);
});
