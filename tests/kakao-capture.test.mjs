import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import Path from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';

const Capture=await import('../extension/lib/kakao-capture.js').catch(()=>({}));
const BundledPython=Path.resolve(Path.dirname(process.execPath),'../../python/python.exe');
const PythonExecutable=process.env.PYTHON||(existsSync(BundledPython)?BundledPython:'python');
test('extension selects exactly one supported process from the unfiltered process list',()=>{
 assert.equal(typeof Capture.SelectKakaoCaptureProcess,'function');
 assert.equal(Capture.SelectKakaoCaptureProcess([{pid:2,name:'unrelated.exe'},{pid:17,name:'POTPLAYERMINI64.EXE'}]),17);
 for(const Processes of [[],[{pid:1,name:'potplayermini.exe'}],[{pid:1,name:'potplayer64.exe'},{pid:2,name:'potplayermini64.exe'}],[{pid:0,name:'potplayer64.exe'}]])assert.throws(()=>Capture.SelectKakaoCaptureProcess(Processes),/capture_process_selection/);
});
test('extension parses the observed raw authorization header without accepting another scheme or ambiguous values',()=>{
 assert.equal(typeof Capture.ParseKakaoCaptureHeaders,'function');
 assert.equal(Capture.ParseKakaoCaptureHeaders('User-Agent: fixture\r\nAUTHORIZATION:\tKakaoAK captured-test-only\r\nAccept: */*'),'captured-test-only');
 for(const Headers of ['Authorization: Bearer fixture','Authorization: KakaoAK ','X-Authorization: KakaoAK fixture','Authorization: KakaoAK one\nAuthorization: KakaoAK two','Authorization: KakaoAK one two'])assert.throws(()=>Capture.ParseKakaoCaptureHeaders(Headers),/capture_credential_missing/);
});
function Port(){let Message,Disconnected;const Sent=[];return {Sent,onMessage:{addListener:Fn=>Message=Fn},onDisconnect:{addListener:Fn=>Disconnected=Fn},postMessage:M=>Sent.push(M),disconnect(){Disconnected?.();},receive:M=>Message(M)};}
test('controller owns process choice, declarative filter, timeout and credential parsing',async()=>{
 assert.equal(typeof Capture.StartKakaoCapture,'function');
 const Native=Port(),Events=[];const Handle=Capture.StartKakaoCapture({connect:()=>Native,onMessage:M=>Events.push(M)});
 try{
  assert.deepEqual(Native.Sent,[{action:'ping'}]);
  await Native.receive({ok:true,captureProtocol:2,capabilities:['listProcesses','captureHeaders']});assert.deepEqual(Native.Sent.at(-1),{action:'listProcesses'});
  await Native.receive({ok:true,processes:[{pid:99,name:'other.exe'},{pid:42,name:'PotPlayerMini64.exe'}]});
  assert.deepEqual(Native.Sent.at(-1),{action:'capture',pid:42,timeoutMs:120000,filter:{host:'dapi.kakao.com',pathPrefix:'/translation/v2/translate.json',headerName:'authorization'}});
  await Native.receive({ok:true,status:'waiting'});await Native.receive({ok:true,status:'captured',headers:'Authorization: KakaoAK fixture-only'});
  assert.deepEqual(Events,[{status:'waiting'},{status:'captured',key:'fixture-only'}]);
 }finally{Handle.disconnect();}
});
test('controller explicitly requires an updated old helper and never sends a legacy capture verb',async()=>{
 assert.equal(typeof Capture.StartKakaoCapture,'function');
 const Native=Port(),Events=[],Handle=Capture.StartKakaoCapture({connect:()=>Native,onMessage:M=>Events.push(M)});
 try{await Native.receive({status:'error',message:'Invalid request'});assert.deepEqual(Events,[{status:'error',code:'capture_helper_update_required'}]);assert.deepEqual(Native.Sent,[{action:'ping'}]);}finally{Handle.disconnect();}
});
test('native capture has generic operations and no product endpoint, parser, process or timeout policy',async()=>{
 const Source=await readFile(new URL('../native/kakao/host.py',import.meta.url),'utf8');
 assert.doesNotMatch(Source,/potplayer|kakao|translate\.json|authorization|event\.wait\(120\)/i);
 assert.match(Source,/listProcesses/);assert.match(Source,/captureProtocol/);assert.match(Source,/allowed_origins/);assert.match(Source,/timeoutMs/);assert.match(Source,/headerName/);
 const Python=spawnSync(PythonExecutable,['-c','import ast, pathlib; ast.parse(pathlib.Path("native/kakao/host.py").read_text(encoding="utf-8"))'],{windowsHide:true,encoding:'utf8'});assert.equal(Python.status,0,Python.stderr||Python.error?.message);
});
test('isolated native bridge authorizes origin and executes only explicit declarative capture with raw header output',async()=>{
 const Directory=await mkdtemp(Path.join(tmpdir(),'mdownloader-header-bridge-')),Origin='chrome-extension://'+'a'.repeat(32)+'/';
 try{
  await copyFile(new URL('../native/kakao/host.py',import.meta.url),Path.join(Directory,'host.py'));
  await writeFile(Path.join(Directory,'host-manifest.json'),JSON.stringify({allowed_origins:[Origin]}));
  await writeFile(Path.join(Directory,'frida.py'),`
from pathlib import Path
from types import SimpleNamespace
def get_local_device():
    return SimpleNamespace(enumerate_processes=lambda:[SimpleNamespace(pid=7,name='unrelated.exe'),SimpleNamespace(pid=42,name='fixture.exe')])
class Script:
    def on(self,event,callback): self.callback=callback
    def load(self): self.callback({'type':'send','payload':'X-Fixture: token-only\\r\\n'},None)
class Session:
    is_detached=False
    def create_script(self,source):
        Path(__file__).with_name('hook-script.txt').write_text(source,encoding='utf-8')
        return Script()
    def detach(self): self.is_detached=True
def attach(pid):
    assert pid==42
    return Session()
`);
  function Request(Messages,Caller=Origin){
   const Input=Buffer.concat(Messages.map(Message=>{const Bytes=Buffer.from(JSON.stringify(Message)),Header=Buffer.alloc(4);Header.writeUInt32LE(Bytes.length);return Buffer.concat([Header,Bytes]);}));
   const Result=spawnSync(PythonExecutable,[Path.join(Directory,'host.py'),Caller],{input:Input,windowsHide:true,timeout:5000});assert.equal(Result.status,0,Result.stderr.toString());
   const Replies=[];let Offset=0;while(Offset<Result.stdout.length){const Size=Result.stdout.readUInt32LE(Offset);Offset+=4;Replies.push(JSON.parse(Result.stdout.subarray(Offset,Offset+Size)));Offset+=Size;}assert.equal(Offset,Result.stdout.length);return Replies;
  }
  assert.deepEqual(Request([{action:'ping'}],'chrome-extension://'+'b'.repeat(32)+'/'),[{ok:false,status:'error',code:'origin_denied'}]);
  const Spec={action:'capture',pid:42,timeoutMs:1000,filter:{host:'fixture.example',pathPrefix:'/request/";globalThis.injected=true;//',headerName:'x-fixture'}};
  const Replies=Request([{action:'ping'},{action:'listProcesses'},Spec]);
  assert.deepEqual(Replies,[{ok:true,captureProtocol:2,capabilities:['listProcesses','captureHeaders']},{ok:true,processes:[{pid:7,name:'unrelated.exe'},{pid:42,name:'fixture.exe'}]},{ok:true,status:'waiting'},{ok:true,status:'captured',headers:'X-Fixture: token-only\r\n'}]);
  const Script=await readFile(Path.join(Directory,'hook-script.txt'),'utf8'),Context={Process:{findModuleByName:()=>null},Interceptor:{flush(){}},send:()=>assert.fail('fixture script sent unexpectedly')};
  runInNewContext(Script+'\nglobalThis.actualFilter=filter;',Context);assert.equal(Context.injected,undefined);assert.equal(Context.actualFilter.pathPrefix,Spec.filter.pathPrefix);
  for(const Invalid of [{...Spec,pid:0},{...Spec,timeoutMs:300001},{...Spec,command:'arbitrary'},{...Spec,script:'arbitrary'},{...Spec,filter:{...Spec.filter,headerName:'x\r\ninjected'}},{...Spec,filter:{...Spec.filter,host:'bad/host'}}])assert.deepEqual(Request([Invalid]),[{ok:false,status:'error',code:'invalid_capture_spec'}]);
 }finally{await rm(Directory,{recursive:true,force:true});}
});
