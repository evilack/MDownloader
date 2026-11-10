import test from 'node:test';import assert from 'node:assert/strict';import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';import Path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash,randomUUID} from 'node:crypto';
import {CaptionInstallerFiles} from '../tools/build/build-caption-installer.mjs';
const PowerShell=Path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
async function Fixture(Bootstrap){
 const Root=Path.resolve('artifacts/common-host-test-'+randomUUID(),'MDownloader/ExplorerBridge');await mkdir(Root,{recursive:true});
 for(const Name of ['host.ps1','common-setup.ps1'])await copyFile('native/explorer/'+Name,Path.join(Root,Name));
 const Origin='chrome-extension://'+'a'.repeat(32)+'/';await writeFile(Path.join(Root,'host-manifest.json'),JSON.stringify({allowed_origins:[Origin]}));
 const files={};for(const Name of CaptionInstallerFiles){const B=Buffer.from(Name==='bootstrap.ps1'?Bootstrap:'# fixture');files[Name]={base64:B.toString('base64'),sha256:createHash('sha256').update(B).digest('hex')};}
 await writeFile(Path.join(Root,'caption-installer.json'),JSON.stringify({version:1,packageVersion:4,files}));
 function request(Message,Caller=Origin){const B=Buffer.from(JSON.stringify(Message)),H=Buffer.alloc(4);H.writeUInt32LE(B.length);const R=spawnSync(PowerShell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',Path.join(Root,'host.ps1'),Caller],{input:Buffer.concat([H,B]),windowsHide:true,timeout:10000});assert.equal(R.status,0,R.stderr?.toString());assert.ok(R.stdout.length>=4,R.stderr?.toString());assert.equal(R.stdout.readUInt32LE(),R.stdout.length-4);return JSON.parse(R.stdout.subarray(4).toString());}
 return {Root,Origin,files,request};
}
test('native common host advertises setup and runs bundled setup without an installer download',{skip:process.platform!=='win32'},async()=>{
 const F=await Fixture('param([string]$ExtensionId)\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot "../worker-marker.txt"),$ExtensionId)\nWrite-Output "bootstrap output must stay outside native stdout"');
 const Ping=F.request({action:'ping'});assert.equal(Ping.helperVersion,9);assert.equal(Ping.helperRevision,1);assert.ok(Ping.capabilities.includes('captionSetup'));assert.ok(Ping.capabilities.includes('genericPackageManifest'));
 assert.equal(F.request({action:'installCaptions',path:'C:/evil.cmd'}).code,'invalid_message');
 assert.equal(F.request({action:'installCaptions'},'chrome-extension://'+'b'.repeat(32)+'/').code,'origin_denied');
 const Started=F.request({action:'installCaptions',package:{version:1,packageVersion:4,files:F.files}});assert.equal(Started.ok,true);assert.match(Started.jobId,/^[a-f0-9]{32}$/);
 let State;for(let I=0;I<20;I++){State=F.request({action:'captionSetupStatus',jobId:Started.jobId});if(['complete','failed'].includes(State.status))break;await new Promise(R=>setTimeout(R,200));}
 assert.equal(State.status,'complete',JSON.stringify(State));assert.equal(await readFile(Path.join(F.Root,'worker-marker.txt'),'utf8'),'a'.repeat(32));
 assert.equal(F.request({action:'captionSetupStatus',jobId:'b'.repeat(32)}).code,'invalid_setup_job');
 assert.equal((await readFile(Path.join(F.Root,'caption-setup-state.json'),'utf8')).includes('complete'),true);
});
test('native worker rejects tampered payload before running it',{skip:process.platform!=='win32'},async()=>{
 const F=await Fixture('throw "should never run"');F.files['host.py'].base64='YmFk';await writeFile(Path.join(F.Root,'caption-installer.json'),JSON.stringify({version:1,packageVersion:4,files:F.files}));
 const Started=F.request({action:'installCaptions'});let State;for(let I=0;I<20;I++){State=F.request({action:'captionSetupStatus',jobId:Started.jobId});if(State.status==='failed')break;await new Promise(R=>setTimeout(R,200));}
 assert.equal(State.status,'failed');assert.equal(State.error,'invalid_setup_payload');
});
test('an old timestamp does not release a live setup, and another origin cannot inspect or replace it',{skip:process.platform!=='win32'},async()=>{
 const F=await Fixture('throw "must not start"'),Job='c'.repeat(32),Other='chrome-extension://'+'b'.repeat(32)+'/';await writeFile(Path.join(F.Root,'host-manifest.json'),JSON.stringify({allowed_origins:[F.Origin,Other]}));
 await writeFile(Path.join(F.Root,'caption-setup-state.json'),JSON.stringify({jobId:Job,origin:F.Origin,status:'installing',started:new Date(Date.now()-1601000).toISOString(),processId:process.pid,error:''}));
 assert.equal(F.request({action:'captionSetupStatus',jobId:Job}).status,'installing');assert.equal(F.request({action:'installCaptions'}).jobId,Job);
 assert.equal(F.request({action:'captionSetupStatus',jobId:Job},Other).code,'common_setup_busy');assert.equal(F.request({action:'installCaptions'},Other).code,'common_setup_busy');
});
test('terminating a setup worker also terminates its bootstrap descendants',{skip:process.platform!=='win32'},async()=>{
 const F=await Fixture('param([string]$ExtensionId)\n$Child=Start-Process -FilePath (Join-Path $env:SystemRoot "System32/WindowsPowerShell/v1.0/powershell.exe") -ArgumentList "-NoProfile -NonInteractive -Command Start-Sleep -Seconds 30" -WindowStyle Hidden -PassThru\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot "../child-pid.txt"),[string]$Child.Id)\nStart-Sleep -Seconds 30');
 const Started=F.request({action:'installCaptions'});let Child,State;
 try{
  for(let I=0;I<30;I++){try{Child=Number(await readFile(Path.join(F.Root,'child-pid.txt'),'utf8'));break;}catch{}await new Promise(R=>setTimeout(R,200));}
  assert.ok(Child);State=JSON.parse(await readFile(Path.join(F.Root,'caption-setup-state.json'),'utf8'));assert.equal(State.status,'installing');process.kill(State.processId);
  await new Promise(R=>setTimeout(R,500));const R=spawnSync(PowerShell,['-NoProfile','-Command',`if(Get-Process -Id ${Child} -ErrorAction SilentlyContinue){exit 1}`],{windowsHide:true});assert.equal(R.status,0,'bootstrap descendant survived worker termination');
  assert.equal(F.request({action:'captionSetupStatus',jobId:Started.jobId}).status,'failed');
 }finally{for(const Id of [State?.processId,Child])if(Id)try{process.kill(Id);}catch{}}
});
