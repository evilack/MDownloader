import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,rm,copyFile}from'node:fs/promises';import{tmpdir}from'node:os';import Path from'node:path';import{spawn,spawnSync}from'node:child_process';import{createHash,randomUUID}from'node:crypto';import{once}from'node:events';
test('Windows Explorer host validates native framing, origin, folder/file identity and binding without launching OS UI',{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(Path.join(tmpdir(),'mdownloader-explorer-')),folder=Path.join(root,'저장 폴더');await mkdir(folder);t.after(()=>rm(root,{recursive:true,force:true}));
 const name='검사, saved.mp4',bytes=Buffer.from('fixture media'),key='55555555-5555-5555-5555-555555555555',origin='chrome-extension://'+'a'.repeat(32)+'/';await writeFile(Path.join(folder,name),bytes);
 const manifest=Path.join(root,'manifest.json'),bindings=Path.join(root,'bindings.json');await writeFile(manifest,JSON.stringify({allowed_origins:[origin]}));
 const message={action:'reveal',folderKey:key,folderName:'저장 폴더',filename:name,size:bytes.length,sampleHash:createHash('sha256').update(bytes).digest('hex')};
 function run(msg,source=origin,extra=[],input){const payload=Buffer.from(JSON.stringify(msg)),header=Buffer.alloc(4);header.writeUInt32LE(payload.length);const r=spawnSync(Path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',Path.resolve('native/explorer/host.ps1'),source,'-ManifestPath',manifest,'-BindingsPath',bindings,'-TestMode',...extra,'--parent-window=0'],{input:input??Buffer.concat([header,payload]),windowsHide:true,maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr?.toString());assert.ok(r.stdout.length>=4,r.stderr?.toString());const size=r.stdout.readUInt32LE();assert.equal(r.stdout.length,size+4);return JSON.parse(r.stdout.subarray(4).toString('utf8'));}
 const Ping=run({action:'ping'});assert.equal(Ping.ok,true);assert.equal(Ping.protocol,1);assert.equal(Ping.helperVersion,9);assert.equal(Ping.helperRevision,2);assert.ok(Ping.capabilities.includes('explorer'));assert.ok(Ping.capabilities.includes('explorerMarkerReveal'));assert.ok(Ping.capabilities.includes('genericPackageManifest'));
 assert.equal(run({action:'ping'},'chrome-extension://'+'b'.repeat(32)+'/').code,'origin_denied');
 assert.deepEqual(run(message,origin,['-TestFolder',folder]),{ok:true,testMode:true});assert.equal(Object.keys(JSON.parse(await readFile(bindings,'utf8'))).length,1);
 assert.deepEqual(run(message),{ok:true,testMode:true});
 for(const extension of['mkv','flac','opus','weba','m4v','f4v','mov','avi','flv','oga','ogv']){const filename='saved.'+extension;await writeFile(Path.join(folder,filename),bytes);assert.deepEqual(run({...message,filename}),{ok:true,testMode:true});}
 assert.equal(run({...message,filename:'../evil.mp4'}).code,'invalid_filename');assert.equal(run({...message,filename:'evil.html'},origin,['-TestFolder',folder]).code,'file_missing');
 await writeFile(Path.join(folder,'saved.future-format'),bytes);assert.deepEqual(run({...message,filename:'saved.future-format'}),{ok:true,testMode:true});
 assert.equal(run(message,'chrome-extension://'+'b'.repeat(32)+'/').code,'origin_denied');
 const badHeader=Buffer.alloc(4);badHeader.writeUInt32LE(2097153);assert.equal(run(message,origin,[],badHeader).code,'invalid_message');assert.equal(run({...message,padding:'x'.repeat(16384)}).code,'invalid_message');
 await writeFile(Path.join(folder,name),'changed');assert.equal(run(message,origin,['-TestFolder',folder]).code,'file_mismatch');
});

test('production launcher resolves default paths on Windows PowerShell without explicit test overrides',{skip:process.platform!=='win32'},async t=>{
 const root=await mkdtemp(Path.join(tmpdir(),'mdownloader-host-default-'));t.after(()=>rm(root,{recursive:true,force:true}));await copyFile('native/explorer/host.ps1',Path.join(root,'host.ps1'));const origin='chrome-extension://'+'a'.repeat(32)+'/';await writeFile(Path.join(root,'host-manifest.json'),JSON.stringify({allowed_origins:[origin]}));const bytes=Buffer.from(JSON.stringify({action:'registration-probe'})),header=Buffer.alloc(4);header.writeUInt32LE(bytes.length);const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-STA','-File',Path.join(root,'host.ps1'),origin,'--parent-window=0'],{input:Buffer.concat([header,bytes]),windowsHide:true});assert.equal(r.status,0,r.stderr?.toString());assert.equal(JSON.parse(r.stdout.subarray(4).toString()).code,'invalid_message');
});

test('first reveal identifies the browser-selected folder even when a legacy link points to an identical copy', {skip:process.platform!=='win32',timeout:25000}, async t=>{
 const root=await mkdtemp(Path.join(tmpdir(),'mdownloader-reveal-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const actual=Path.join(root,'actual','Tele'),copy=Path.join(root,'copy','Tele');
 await mkdir(actual,{recursive:true});await mkdir(copy,{recursive:true});
 const filename='검사, saved.mp4',bytes=Buffer.from('fixture media');
 await writeFile(Path.join(actual,filename),bytes);await writeFile(Path.join(copy,filename),bytes);
 const origin='chrome-extension://'+'a'.repeat(32)+'/',folderKey=randomUUID(),key=origin+'|'+folderKey;
 const manifest=Path.join(root,'manifest.json'),bindings=Path.join(root,'bindings.json');
 await writeFile(manifest,JSON.stringify({allowed_origins:[origin]}));await writeFile(bindings,JSON.stringify({[key]:copy}));
 const target={folderKey,folderName:'Tele',filename,size:bytes.length,sampleHash:createHash('sha256').update(bytes).digest('hex')};
 async function request(message,onWatching){
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',Path.resolve('native/explorer/host.ps1'),origin,'-ManifestPath',manifest,'-BindingsPath',bindings,'-TestMode'],{windowsHide:true});
  const exited=once(child,'close');t.after(()=>child.kill());
  const payload=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(payload.length);
  child.stdin.end(Buffer.concat([header,payload]));
  let pending=Buffer.alloc(0),result;
  for await(const chunk of child.stdout){
   pending=Buffer.concat([pending,chunk]);
   while(pending.length>=4&&pending.length>=pending.readUInt32LE()+4){
    const length=pending.readUInt32LE();const reply=JSON.parse(pending.subarray(4,length+4));pending=pending.subarray(length+4);
    if(reply.stage==='watching')await onWatching();else result=reply;
   }
  }
  assert.deepEqual(await exited,[0,null]);assert.equal(pending.length,0);return result;
 }
 assert.deepEqual(await request({...target,action:'revealBound'}),{ok:false,code:'binding_required'});
 const marker='.mdownloader-reveal-'+randomUUID()+'.tmp';
 assert.deepEqual(await request({...target,action:'revealFromMarker',marker},()=>writeFile(Path.join(actual,marker),'',{flag:'wx'})),{ok:true,testMode:true});
 const stored=JSON.parse(await readFile(bindings,'utf8'));
 assert.equal(stored[key],copy);assert.equal(stored[key+'|verified'],actual);
 assert.deepEqual(await request({...target,action:'revealBound'}),{ok:true,testMode:true});
 assert.deepEqual(await request({...target,action:'revealFromMarker',marker:'../'+marker}),{ok:false,code:'invalid_message'});
});
