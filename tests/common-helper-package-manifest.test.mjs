import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import Path from 'node:path';
import Os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {CommonHelperReady,MinimumHelperVersion} from '../extension/lib/common-helper-contract.js';

const PowerShell=Path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
const Source=Path.resolve('native/explorer/common-setup.ps1');
function Package(Names,Bytes=Buffer.from('# module')){
 return {version:1,packageVersion:4,files:Object.fromEntries(Names.map(Name=>[Name,{base64:Bytes.toString('base64'),sha256:createHash('sha256').update(Bytes).digest('hex')}]))};
}
async function Run(Script,Packages=[]){
 const Directory=await mkdtemp(Path.join(Os.tmpdir(),'mdownloader-package-test-'));
 try{
  await writeFile(Path.join(Directory,'packages.json'),JSON.stringify(Packages));
  await writeFile(Path.join(Directory,'test.ps1'),`$ErrorActionPreference='Stop'\n. '${Source.replaceAll("'","''")}'\n$Directory=$PSScriptRoot\n$Packages=Get-Content -LiteralPath (Join-Path $Directory 'packages.json') -Raw -Encoding UTF8|ConvertFrom-Json\n${Script}`);
  const Result=spawnSync(PowerShell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',Path.join(Directory,'test.ps1')],{windowsHide:true,timeout:30000,maxBuffer:2*1024*1024});
  assert.equal(Result.status,0,Result.stderr?.toString()||Result.error?.message);return Result.stdout.toString().trim();
 }finally{await rm(Directory,{recursive:true,force:true});}
}
test('unchanged common helper accepts a new nested package module and cleans only declared files',{skip:process.platform!=='win32'},async()=>{
 const Before=createHash('sha256').update(await readFile(Source)).digest('hex');
 const Result=await Run(`
  $Index=0
  foreach($Package in $Packages){
   $Stage=Join-Path $Directory ('stage'+$Index);$Index++
   $Files=Read-CommonCaptionPackage $Package -RequirePackageVersion
   Expand-CommonCaptionPackage $Stage $Directory $Files
   foreach($Name in $Files.Keys){if(-not [IO.File]::Exists((Join-Path $Stage $Name))){throw 'missing_declared_file'}}
   [IO.File]::WriteAllText((Join-Path $Stage 'modules/unknown.txt'),'keep')
   Remove-CommonCaptionPackage $Stage $Directory $Files
   if(-not [IO.File]::Exists((Join-Path $Stage 'modules/unknown.txt'))){throw 'removed_unknown_file'}
   foreach($Name in $Files.Keys){if([IO.File]::Exists((Join-Path $Stage $Name))){throw 'declared_file_remains'}}
  }
  'accepted'`,[Package(['bootstrap.ps1','modules/original.py']),Package(['bootstrap.ps1','modules/original.py','modules/new/deeper/feature.py'])]);
 assert.equal(Result,'accepted');assert.equal(createHash('sha256').update(await readFile(Source)).digest('hex'),Before);
});
test('Windows package reader rejects traversal, device paths, collisions, malformed hashes and bounds',{skip:process.platform!=='win32'},async()=>{
 const Invalid=['../escape.py','/absolute.py','C:/drive.py','nested\\escape.py','a//b.py','a/./b.py','a/../b.py','CON','aux.txt','x/NUL.py','LPT1.log','trailing.','trailing ','a:b.py','a\u0000b'];
 const Packages=Invalid.map(Name=>Package(['bootstrap.ps1',Name]));
 Packages.push(Package(['bootstrap.ps1','modules','modules/a.py']),Package(['bootstrap.ps1','x/a.py','X/b.py']),Package(['bootstrap.ps1',...Array.from({length:128},(_,I)=>`module${I}.py`)]),Package(['bootstrap.ps1','large.py'],Buffer.alloc(524289)),Package(['module.py']));
 const Tampered=Package(['bootstrap.ps1']);Tampered.files['bootstrap.ps1'].sha256='0'.repeat(64);Packages.push(Tampered);
 assert.equal(await Run(`foreach($Package in $Packages){try{[void](Read-CommonCaptionPackage $Package -RequirePackageVersion);throw 'accepted_invalid'}catch{if($_.Exception.Message -ne 'invalid_setup_payload'){throw}}};'rejected'`,Packages),'rejected');
});
test('Windows package reader accepts the documented 128-file and one MiB decoded limits',{skip:process.platform!=='win32'},async()=>{
 const Names=['bootstrap.ps1',...Array.from({length:127},(_,I)=>`modules/module${I}.py`)];
 assert.equal(await Run(`$Files=Read-CommonCaptionPackage $Packages[0] -RequirePackageVersion;if($Files.Count -ne 128){throw 'wrong_file_count'};Save-CommonCaptionPackage $Directory $Packages[0];'accepted'`,[Package(Names,Buffer.alloc(8192))]),'accepted');
});
test('Windows extraction rejects junctions and preserves their target',{skip:process.platform!=='win32'},async()=>{
 assert.equal(await Run(`
  $Stage=Join-Path $Directory 'stage';$Outside=Join-Path $Directory 'outside'
  [void][IO.Directory]::CreateDirectory($Outside)
  [void](New-Item -ItemType Junction -Path $Stage -Target $Outside)
  try{try{Expand-CommonCaptionPackage $Stage $Directory (Read-CommonCaptionPackage $Packages[0]);throw 'accepted_junction'}catch{if($_.Exception.Message -ne 'unsafe_setup_path'){throw}};if([IO.File]::Exists((Join-Path $Outside 'bootstrap.ps1'))){throw 'wrote_outside_stage'}}finally{[IO.Directory]::Delete($Stage)}
  'rejected'`,[Package(['bootstrap.ps1'])]),'rejected');
});
test('readiness requires the generic package capability and helper version nine',()=>{
 assert.equal(MinimumHelperVersion,9);
 const Ready={ok:true,protocol:1,platform:'win',helperVersion:9,helperRevision:1,capabilities:['captionSetup','captionPackageUpdate','genericPackageManifest']};
 assert.equal(CommonHelperReady(Ready),true);assert.equal(CommonHelperReady({...Ready,helperVersion:8}),false);assert.equal(CommonHelperReady({...Ready,capabilities:['captionSetup','captionPackageUpdate']}),false);
});
test('Mac common helper has dynamic declared files, nested parents and bounded package validation',async()=>{
 const Mac=await readFile(Path.resolve('native/common-macos/host.js'),'utf8');
 assert.doesNotMatch(Mac,/var SourceNames=\[/);assert.match(Mac,/function packageNames\(/);assert.match(Mac,/Names\.length>128/);assert.match(Mac,/genericPackageManifest/);assert.match(Mac,/helperVersion:9/);assert.match(Mac,/function cleanupPackage\(/);assert.match(Mac,/createDirectoryAtPathWithIntermediateDirectoriesAttributesError/);
});
test('Mac package path validator accepts new nested modules and rejects case collisions without JXA',async()=>{
 const Mac=await readFile(Path.resolve('native/common-macos/host.js'),'utf8');
 const Validate=runInNewContext(`function fail(Code){throw Error(Code)};${Mac.slice(Mac.indexOf('function packageNames('),Mac.indexOf('function cleanupPackage('))};packageNames`);
 const Good=Package(['bootstrap.sh','modules/new/feature.py']);assert.deepEqual(Array.from(Validate(Good)),Object.keys(Good.files));
 for(const Names of [['bootstrap.sh','A.py','a.py'],['bootstrap.sh','a','a/b.py'],['bootstrap.sh','a/b.py','A/c.py'],['bootstrap.sh','../escape'],['bootstrap.sh','CON.txt'],['bootstrap.sh','x\\y.py'],['bootstrap.sh','/absolute']])assert.throws(()=>Validate(Package(Names)),/invalid_setup_payload/);
});
test('an old Mac worker cleanup cannot use the next job package manifest',async()=>{
 const Mac=await readFile(Path.resolve('native/common-macos/host.js'),'utf8');
 const Cleanup=runInNewContext(`${Mac.slice(Mac.indexOf('function cleanup(Root,Job)'),Mac.indexOf('function currentState('))};cleanup`,{readState:()=>({jobId:'b'.repeat(32)}),safe:()=>assert.fail('stale worker accessed a newer package'),fail:Code=>{throw Error(Code)}});
 Cleanup('/fixture','a'.repeat(32));assert.match(Mac,/Mode==='--cleanup'\)lock\(Root/);
});
