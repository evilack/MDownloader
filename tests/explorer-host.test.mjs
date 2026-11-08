import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,rm,copyFile}from'node:fs/promises';import{tmpdir}from'node:os';import Path from'node:path';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';
test('Windows Explorer host validates native framing, origin, folder/file identity and binding without launching OS UI',{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(Path.join(tmpdir(),'mdownloader-explorer-')),folder=Path.join(root,'저장 폴더');await mkdir(folder);t.after(()=>rm(root,{recursive:true,force:true}));
 const name='검사, saved.mp4',bytes=Buffer.from('fixture media'),key='55555555-5555-5555-5555-555555555555',origin='chrome-extension://'+'a'.repeat(32)+'/';await writeFile(Path.join(folder,name),bytes);
 const manifest=Path.join(root,'manifest.json'),bindings=Path.join(root,'bindings.json');await writeFile(manifest,JSON.stringify({allowed_origins:[origin]}));
 const message={action:'reveal',folderKey:key,folderName:'저장 폴더',filename:name,size:bytes.length,sampleHash:createHash('sha256').update(bytes).digest('hex')};
 function run(msg,source=origin,extra=[],input){const payload=Buffer.from(JSON.stringify(msg)),header=Buffer.alloc(4);header.writeUInt32LE(payload.length);const r=spawnSync(Path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',Path.resolve('native/explorer/host.ps1'),source,'-ManifestPath',manifest,'-BindingsPath',bindings,'-TestMode',...extra,'--parent-window=0'],{input:input??Buffer.concat([header,payload]),windowsHide:true,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr?.toString());assert.ok(r.stdout.length>=4,r.stderr?.toString());const size=r.stdout.readUInt32LE();assert.equal(r.stdout.length,size+4);return JSON.parse(r.stdout.subarray(4).toString('utf8'));}
 assert.deepEqual(run({action:'ping'}),{ok:true,protocol:1});
 assert.equal(run({action:'ping'},'chrome-extension://'+'b'.repeat(32)+'/').code,'origin_denied');
 assert.deepEqual(run(message,origin,['-TestFolder',folder]),{ok:true,testMode:true});assert.equal(Object.keys(JSON.parse(await readFile(bindings,'utf8'))).length,1);
 assert.deepEqual(run(message),{ok:true,testMode:true});
 for(const extension of['mkv','flac','opus','weba','m4v','f4v','mov','avi','flv','oga','ogv']){const filename='saved.'+extension;await writeFile(Path.join(folder,filename),bytes);assert.deepEqual(run({...message,filename}),{ok:true,testMode:true});}
 assert.equal(run({...message,filename:'../evil.mp4'}).code,'invalid_filename');assert.equal(run({...message,filename:'evil.html'}).code,'invalid_filename');
 assert.equal(run(message,'chrome-extension://'+'b'.repeat(32)+'/').code,'origin_denied');
 const badHeader=Buffer.alloc(4);badHeader.writeUInt32LE(16385);assert.equal(run(message,origin,[],badHeader).code,'invalid_message');
 await writeFile(Path.join(folder,name),'changed');assert.equal(run(message,origin,['-TestFolder',folder]).code,'file_mismatch');
});

test('production launcher resolves default paths on Windows PowerShell without explicit test overrides',{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(Path.join(tmpdir(),'mdownloader-host-default-'));t.after(()=>rm(root,{recursive:true,force:true}));await copyFile('native/explorer/host.ps1',Path.join(root,'host.ps1'));const origin='chrome-extension://'+'a'.repeat(32)+'/';await writeFile(Path.join(root,'host-manifest.json'),JSON.stringify({allowed_origins:[origin]}));const bytes=Buffer.from(JSON.stringify({action:'registration-probe'})),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-STA','-File',Path.join(root,'host.ps1'),origin,'--parent-window=0'],{input:Buffer.concat([header,bytes]),windowsHide:true});assert.equal(r.status,0,r.stderr?.toString());assert.equal(JSON.parse(r.stdout.subarray(4).toString()).code,'invalid_message');
});
