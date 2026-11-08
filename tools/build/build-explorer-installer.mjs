import{readFile,writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';import Path from'node:path';import{fileURLToPath}from'node:url';
export async function WriteExplorerInstaller(Root,Destination=Path.join(Root,'extension/data/explorer-installer.json')){
 const files={};for(const name of['host.ps1','dialog.ps1','install.ps1']){const bytes=await readFile(Path.join(Root,'native/explorer',name));files[name]={base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};}
 await mkdir(Path.dirname(Destination),{recursive:true});await writeFile(Destination,JSON.stringify({version:1,files},null,2)+'\n');
}
if(process.argv[1]&&Path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await WriteExplorerInstaller(fileURLToPath(new URL('../../',import.meta.url)));
