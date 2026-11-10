/** Actual local native protocol + service + both engines. No host registration or real downloads. */
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import Path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CreateCaptionNativeClient} from '../../extension/lib/local-captions-native.js';
import {CreateCaptionService} from '../../extension/lib/local-captions-service.js';
const Root=Path.resolve('artifacts/caption-engine-smoke'),Python=Path.resolve('artifacts/captions-venv/Scripts/python.exe');
const Config={whisperCli:Path.resolve('artifacts/whisper-cpp-b5454/Release/whisper-cli.exe')};
await mkdir(Root,{recursive:true});await writeFile(Path.join(Root,'config.json'),JSON.stringify(Config));
const Convert=spawnSync(Python,['-c',"import imageio_ffmpeg,subprocess,sys; subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=10','-i',sys.argv[1],'-map','0:v:0','-map','1:a:0','-c:v','libx264','-c:a','aac','-shortest',sys.argv[2]],check=True)",Path.join(Root,'speech.wav'),Path.join(Root,'video.mp4')],{encoding:'utf8'});
assert.equal(Convert.status,0,Convert.stderr);
const Child=spawn(Python,['native/captions/host.py'],{env:{...process.env,MDOWNLOADER_CAPTION_HOME:Root},stdio:['pipe','pipe','pipe'],windowsHide:true});
let BufferValue=Buffer.alloc(0),Stderr='';Child.stderr.on('data',B=>{Stderr+=B.toString();process.stderr.write(B);});
const Event=()=>{const Listeners=new Set();return {addListener:F=>Listeners.add(F),emit:M=>{for(const F of Listeners)F(M);}};};
const Port={onMessage:Event(),onDisconnect:Event(),postMessage(M){const B=Buffer.from(JSON.stringify(M)),H=Buffer.alloc(4);H.writeUInt32LE(B.length);Child.stdin.write(Buffer.concat([H,B]));}};
Child.stdout.on('data',Data=>{BufferValue=Buffer.concat([BufferValue,Data]);while(BufferValue.length>=4){const Size=BufferValue.readUInt32LE();assert.ok(Size<800000,'bounded native response');if(BufferValue.length<Size+4)break;const M=JSON.parse(BufferValue.subarray(4,Size+4));BufferValue=BufferValue.subarray(Size+4);Port.onMessage.emit(M);}});
Child.on('exit',()=>Port.onDisconnect.emit());
const Id='a'.repeat(32),Jobs=new Map(),Events=[];let Service;
const Api={runtime:{id:Id,connectNative:()=>Port,getURL:P=>'chrome-extension://'+Id+'/'+P,getPlatformInfo:async()=>({os:'win'}),sendMessage:async()=>{}},downloads:{search:async({id})=>[{id,byExtensionId:Id,state:'complete',exists:true,filename:Path.join(Root,'video.mp4')}]}};
const Native=CreateCaptionNativeClient(Api,Event=>{Events.push(Event);if(Service)void Service.onNativeEvent(Event);});
Service=CreateCaptionService(Api,{native:Native,readJob:async K=>Jobs.get(K),updateJob:async(K,F)=>{const J=F(Jobs.get(K));Jobs.set(K,J);return J;},listJobs:async()=>[...Jobs.values()],
 requireFolder:async()=>({getFileHandle:async()=>({getFile:async()=>new Blob([await readFile(Path.join(Root,'video.mp4'))])})}),
 writeFolder:async(_Folder,Name,Body,Signal)=>{
  let Destination,Output=Name;for(let I=0;;I++){Output=I?Name.replace(/\.(srt|vtt)$/,` (${I}).$1`):Name;try{Destination=await open(Path.join(Root,Output),'wx');break;}catch(E){if(E.code!=='EEXIST')throw E;}}
  await Body.pipeTo(new WritableStream({async write(Chunk){await Destination.write(Chunk);},async close(){await Destination.close();},async abort(){await Destination.close();}}),{signal:Signal});return Output;
 }});
const Evidence=[];
try{
 for(const [Index,Engine]of ['faster-whisper','whisper.cpp','faster-whisper'].entries()){
  const Key=randomUUID();
  Jobs.set('job:'+Key,{requestId:Key,state:'complete',...(Index===2?{pickedDownloadFolder:'fixture'}:{downloadId:Index+1}),filename:Index===2?'picked-video.mp4':'video.mp4',localCaptions:{enabled:true,engine:Engine,model:'tiny',language:'en',formats:['srt','vtt']},captionStatus:{phase:'waiting'}});
  await Service.start(Key);
  const Deadline=Date.now()+120000;
  while(!['complete','failed'].includes(Jobs.get('job:'+Key)?.captionStatus?.phase)&&Date.now()<Deadline)await new Promise(R=>setTimeout(R,100));
  const Job=Jobs.get('job:'+Key);assert.equal(Job.captionStatus.phase,'complete',JSON.stringify(Job.captionStatus)+' '+Stderr);assert.equal(Job.state,'complete');
  for(const Name of Job.captionStatus.outputs){const Text=await readFile(Path.join(Root,Name),'utf8');assert.match(Text,/automatic|local/i);assert.match(Text,/00:00:/);}
  Evidence.push({engine:Engine,saveMode:Index===2?'picked-folder':'browser',state:Job.captionStatus.phase,outputs:Job.captionStatus.outputs});
 }
 await writeFile(Path.join(Root,'service-protocol-evidence.json'),JSON.stringify({evidence:Evidence,phases:[...new Set(Events.map(E=>E.phase).filter(Boolean))]},null,2));
 console.log(JSON.stringify(Evidence));
}finally{Child.stdin.end();}
