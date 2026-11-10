import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import Path from 'node:path';import {fileURLToPath} from 'node:url';
export async function WriteMacCommonInstaller(Root,Destination=Path.join(Root,'extension/data/mac-common-installer.json')){
 const files={};
 for(const Name of ['host.sh','host.js','worker.sh','install.sh']){
  const Bytes=await readFile(Path.join(Root,'native/common-macos',Name));
  files[Name]={base64:Bytes.toString('base64'),sha256:createHash('sha256').update(Bytes).digest('hex')};
 }
 await mkdir(Path.dirname(Destination),{recursive:true});await writeFile(Destination,JSON.stringify({version:1,files})+'\n');
}
if(process.argv[1]&&Path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const Root=fileURLToPath(new URL('../../',import.meta.url));await WriteMacCommonInstaller(Root);
}
