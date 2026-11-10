/** Extension orchestration + installed executor, preserved recording and local model; no install/download. */
import {spawn} from 'node:child_process';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import Path from 'node:path';
import assert from 'node:assert/strict';
import {CreateCaptionExecution} from '../../extension/lib/caption-execution.js';
const Id='eaimflahgdgfehekmdefignmffapamjk',Origin='chrome-extension://'+Id+'/',Job=crypto.randomUUID();
const Installed=Path.join(process.env.LOCALAPPDATA,'MDownloader/Captions');
const Root=Path.resolve('artifacts/recording-captions-'+Date.now());await mkdir(Root,{recursive:true});
await cp(Path.resolve('artifacts/caption-seam-20261111/failed-recording.media'),Path.join(Root,'video.media'));
const Child=spawn(Path.join(Installed,'venv/Scripts/python.exe'),[Path.join(Installed,'host.py'),Origin],{env:{...process.env,MDOWNLOADER_CAPTION_HOME:Installed},windowsHide:true,stdio:['pipe','pipe','pipe']});
let Bytes=Buffer.alloc(0),Sequence=0,Stderr='';const Pending=new Map(),Commands=[],Events=[];
const Timer=setTimeout(()=>{Child.kill();},240000);
Child.stderr.on('data',B=>Stderr+=B.toString());
Child.stdout.on('data',B=>{Bytes=Buffer.concat([Bytes,B]);while(Bytes.length>=4){const N=Bytes.readUInt32LE(0);assert.ok(N<=800000);if(Bytes.length<N+4)break;const M=JSON.parse(Bytes.subarray(4,N+4));Bytes=Bytes.subarray(N+4);if(M.event){Execution.onProgress(M);continue;}const P=Pending.get(M.id);if(!P)continue;Pending.delete(M.id);M.ok?P.resolve(M.data):P.reject(Error(M.error));}});
Child.on('exit',Code=>{for(const P of Pending.values())P.reject(Error('native exited '+Code+' '+Stderr));Pending.clear();});
const Execution=CreateCaptionExecution({emit:E=>Events.push(E),request:M=>new Promise((resolve,reject)=>{const id=++Sequence;Commands.push({action:M.action,operation:M.operation,scope:M.scope,wordTimestamps:M.wordTimestamps});Pending.set(id,{resolve,reject});const B=Buffer.from(JSON.stringify({...M,id})),H=Buffer.alloc(4);H.writeUInt32LE(B.length);Child.stdin.write(Buffer.concat([H,B]));})});
const Request=(action,Fields={})=>Execution.request({action,jobId:Job,attempt:1,...Fields});
try{
 const Probe=await Execution.request({action:'probe',engine:'faster-whisper',model:'medium'});assert.equal(Probe.executionProtocol,2);assert.equal(Probe.modelReady,true);
 await Request('start',{sourcePath:Path.join(Root,'video.media'),options:{engine:'faster-whisper',model:'medium',language:'auto',formats:['srt','vtt'],recognition:{cpuThreads:8,beamSize:5,bestOf:5,vadFilter:true}}});
 const End=Date.now()+210000;let State;
 do{await new Promise(R=>setTimeout(R,100));State=await Request('status');if(State.phase==='failed')throw Error(JSON.stringify(State)+' '+Stderr);}while(State.phase!=='recognized'&&Date.now()<End);
 assert.equal(State.phase,'recognized');const Result=await Request('readResult',{format:'srt',offset:0}),Text=Buffer.from(Result.data,'base64').toString();assert.match(Text,/00:00:/);assert.ok(Text.length>50);
 const Saved=await Request('saveResult',{videoPath:Path.join(Root,'video.media'),formats:['srt','vtt']});await Request('complete');assert.equal((await Request('status')).phase,'complete');
 assert.ok(Commands.every(C=>C.action==='execute'||C.action==='cancelExecution'));assert.ok(Commands.filter(C=>C.operation==='sessionInfer').length>=3);assert.ok(Commands.filter(C=>C.operation==='sessionInfer').every(C=>C.wordTimestamps===true));
 const Evidence={root:Root,protocol:Probe.executionProtocol,packageVersion:Probe.captionPackageVersion,outputs:Saved.outputs,transcriptBytes:Buffer.byteLength(Text),inferenceCalls:Commands.filter(C=>C.operation==='sessionInfer').length,commands:Commands,phases:[...new Set(Events.map(E=>E.phase))]};
 await writeFile(Path.join(Root,'evidence.json'),JSON.stringify(Evidence,null,2));console.log(JSON.stringify({root:Root,outputs:Saved.outputs,protocol:Probe.executionProtocol,commands:Commands.length,phases:Evidence.phases}));
}finally{clearTimeout(Timer);Child.stdin.end();await new Promise(R=>{if(Child.exitCode!==null)return R();Child.once('exit',R);setTimeout(()=>Child.kill(),5000).unref();});}
