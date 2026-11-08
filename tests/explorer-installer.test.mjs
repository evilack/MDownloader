import test from 'node:test';import assert from 'node:assert/strict';
import{CreateExplorerInstaller,DownloadExplorerInstaller}from'../extension/lib/explorer-installer.js';
import{BeforePickDownloadFolder}from'../extension/options-explorer-setup.js';
import{mkdtemp,readFile,writeFile,rm,readdir}from'node:fs/promises';import{tmpdir}from'node:os';import Path from'node:path';import{spawnSync}from'node:child_process';
test('Windows setup embeds the actual calling extension identity and local helper payload',()=>{
 const id='a'.repeat(32),bundle={files:{'host.ps1':{base64:Buffer.from('host fixture').toString('base64')},'dialog.ps1':{base64:Buffer.from('dialog fixture').toString('base64')},'install.ps1':{base64:Buffer.from('install fixture').toString('base64')}}};
 const cmd=CreateExplorerInstaller(bundle,id);assert.match(cmd,/^@echo off\r\n/);assert.match(cmd,/MDOWNLOADER_SETUP_FILE=%~f0/);assert.match(cmd,/exit \/b/);
 const encoded=cmd.split('\r\n::MDOWNLOADER_WINDOWS_SETUP_PAYLOAD::\r\n')[1].trim();const script=Buffer.from(encoded,'base64').toString('utf8');assert.ok(script.includes(id));assert.ok(script.includes('-ExtensionId'));
 assert.throws(()=>CreateExplorerInstaller(bundle,'bad id'));assert.throws(()=>CreateExplorerInstaller({files:{'evil.ps1':{base64:'eA=='}}},id));
});
test('an installer still in progress at the deadline is never reported as downloaded',async t=>{
 let clock=0,removed=0;const id='a'.repeat(32),files={};for(const n of['host.ps1','dialog.ps1','install.ps1'])files[n]={base64:'eA=='};
 globalThis.chrome={runtime:{id,getURL:p=>'https://extension.test/'+p},downloads:{download:async()=>123,onDeterminingFilename:{addListener(){},removeListener(){removed++;}},search:async()=>[{id:123,state:'in_progress'}]}};
 t.after(()=>delete globalThis.chrome);t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({files})));t.mock.method(Date,'now',()=>clock++*16000);
 await assert.rejects(DownloadExplorerInstaller(),{key:'explorer_setup_download_timeout'});assert.ok(removed>0);
});
test('Mac folder selection never checks or installs a Windows helper',async t=>{
 globalThis.chrome={runtime:{getPlatformInfo:async()=>({os:'mac'})},permissions:{contains:()=>assert.fail('Windows helper permission requested on Mac')}};t.after(()=>delete globalThis.chrome);
 assert.equal(await BeforePickDownloadFolder(),true);
});
test('the generated CMD actually runs its embedded installer with the ID and cleans staging files',{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(Path.join(tmpdir(),'mdownloader-setup-'));t.after(()=>rm(root,{recursive:true,force:true}));const marker=Path.join(root,'installed.txt'),id='b'.repeat(32);
 const files={};for(const name of['host.ps1','dialog.ps1','install.ps1'])files[name]={base64:Buffer.from(name==='install.ps1'?`param([string[]]$ExtensionId)\n[IO.File]::WriteAllText('${marker.replaceAll("'","''")}',$ExtensionId[0])`:'# fixture').toString('base64')};
 const cmd=Path.join(root,'setup.cmd');await writeFile(cmd,CreateExplorerInstaller({files},id));const result=spawnSync('cmd.exe',['/d','/c',cmd],{input:'\n',encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(await readFile(marker,'utf8'),id);assert.equal((await readdir(root)).some(f=>f.startsWith('mdownloader-setup-')),false);
});
test('legacy removal CMD runs only the confirmed removal entry with its callback identity',{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(Path.join(tmpdir(),'mdownloader-remove-cmd-'));t.after(()=>rm(root,{recursive:true,force:true}));const marker=Path.join(root,'removed.json'),id='d'.repeat(32),token='e'.repeat(32),files={};
 for(const name of['host.ps1','dialog.ps1','install.ps1','lifecycle.ps1','uninstall.ps1'])files[name]={base64:Buffer.from(name==='uninstall.ps1'?`param([switch]$Confirmed,[string]$CallbackToken,[string]$RequestedOrigin)\n[IO.File]::WriteAllText('${marker.replaceAll("'","''")}',(@{confirmed=[bool]$Confirmed;token=$CallbackToken;origin=$RequestedOrigin}|ConvertTo-Json -Compress))`:name==='install.ps1'?`throw 'installer must not run during removal'`:'# fixture').toString('base64')};
 const cmd=Path.join(root,'remove.cmd');await writeFile(cmd,CreateExplorerInstaller({files},id,token));const r=spawnSync('cmd.exe',['/d','/c',cmd],{input:'\n',encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(JSON.parse(await readFile(marker,'utf8')),{confirmed:true,token,origin:'chrome-extension://'+id+'/'});assert.equal((await readdir(root)).some(f=>f.startsWith('mdownloader-setup-')),false);
});
