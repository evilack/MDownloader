/** Execute the generated CMD with only destination/registration overridden for an isolated test. */
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';import Path from 'node:path';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
import {CreateWindowsCaptionInstaller} from '../../extension/lib/caption-installer.js';import {WriteCaptionInstaller} from '../build/build-caption-installer.mjs';
if(process.platform!=='win32')throw Error('Windows probe only');
const Root=Path.resolve('artifacts/caption-installer-wrapper-'+Date.now()),Destination=Path.join(Root,'installed');await mkdir(Root,{recursive:true});await WriteCaptionInstaller(Path.resolve('.'),Path.join(Root,'payload.json'));
const Text=CreateWindowsCaptionInstaller(JSON.parse(await readFile(Path.join(Root,'payload.json'),'utf8')),'a'.repeat(32));
const Marker='::MDOWNLOADER_CAPTION_PAYLOAD::',Index=Text.lastIndexOf(Marker)+Marker.length;
const Script=Buffer.from(Text.slice(Index).trim(),'base64').toString('utf8');
const Command="-ExtensionId '"+'a'.repeat(32)+"'";assert.equal(Script.split(Command).length,2);
const IsolatedScript=Script.replace(Command,Command+" -Destination '"+Destination.replaceAll("'","''")+"' -NoRegister");
const Cmd=Path.join(Root,'MDownloader-Captions-Isolated-Test.cmd');await writeFile(Cmd,Text.slice(0,Index)+'\r\n'+Buffer.from(IsolatedScript).toString('base64')+'\r\n');
const Result=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/c',Cmd],{encoding:'utf8',timeout:180000,windowsHide:true});await writeFile(Path.join(Root,'execution.log'),Result.stdout+'\n'+Result.stderr);
assert.equal(Result.status,0,Result.stdout+'\n'+Result.stderr);const HasModels=await stat(Path.join(Destination,'models')).then(()=>true).catch(()=>false);assert.equal(HasModels,false);
const Manifest=JSON.parse(await readFile(Path.join(Destination,'com.mdownloader.captions.json'),'utf8'));assert.deepEqual(Manifest.allowed_origins,['chrome-extension://'+'a'.repeat(32)+'/']);
const Evidence={root:Root,wrapperExecuted:true,registered:false,modelsPresent:HasModels,enginesVerified:Result.stdout.includes('"verified": true')};assert.equal(Evidence.enginesVerified,true);
await writeFile(Path.join(Root,'result.json'),JSON.stringify(Evidence,null,2));console.log(JSON.stringify(Evidence));
