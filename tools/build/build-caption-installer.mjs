import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Path from 'node:path';import {fileURLToPath} from 'node:url';
import {ValidateCaptionProcessingPolicy,CaptionPackageLimits} from '../../extension/lib/caption-processing-policy.js';
export async function ListCaptionInstallerFiles(Root){
 const Names=[];
 async function Visit(Directory,Prefix=''){
  for(const Entry of await readdir(Directory,{withFileTypes:true})){
   if(Entry.name.startsWith('.')||Entry.name==='__pycache__'||Entry.name.startsWith('test_'))continue;
   const Name=Prefix+Entry.name;
   if(Entry.isDirectory())await Visit(Path.join(Directory,Entry.name),Name+'/');
   else if(Entry.isFile()&&(/\.(py|ps1|sh|json)$/.test(Name)||Name==='requirements.txt'))Names.push(Name);
  }
 }
 await Visit(Path.join(Root,'native/captions'));return Names.sort();
}
export const CaptionInstallerFiles=await ListCaptionInstallerFiles(fileURLToPath(new URL('../../',import.meta.url)));
export async function CreateCaptionInstallerBundle(Root){
 const files={};let SourceBytes=0;
 for(const Name of await ListCaptionInstallerFiles(Root)){
  const Bytes=await readFile(Path.join(Root,'native/captions',Name)),Encoded=Bytes.toString('base64');SourceBytes+=Bytes.length;
  if(Encoded.length>CaptionPackageLimits.fileBase64Chars||SourceBytes>CaptionPackageLimits.sourceBytes||Object.keys(files).length>=128)throw Error('Caption source package exceeds common helper limits');
  files[Name]={base64:Encoded,sha256:createHash('sha256').update(Bytes).digest('hex')};
 }
 const Metadata=JSON.parse(Buffer.from(files['bootstrap.json'].base64,'base64').toString('utf8'));
 if(!Number.isSafeInteger(Metadata.packageVersion)||Metadata.packageVersion<1||!Metadata.models||Object.keys(Metadata.models).some(Id=>!/^[a-z0-9-]+$/.test(Id)))throw Error('Invalid caption package metadata');
 ValidateCaptionProcessingPolicy(Metadata.processing);
 const Bundle={version:1,packageVersion:Metadata.packageVersion,files};
 if(Buffer.byteLength(JSON.stringify(Bundle),'utf8')>CaptionPackageLimits.bundleBytes)throw Error('Caption source package exceeds common helper limits');
 return Bundle;
}
export async function WriteCaptionInstaller(Root,Destination=Path.join(Root,'extension/data/caption-installer.json')){
 const Bundle=await CreateCaptionInstallerBundle(Root);await mkdir(Path.dirname(Destination),{recursive:true});await writeFile(Destination,JSON.stringify(Bundle)+'\n');
 if(Path.basename(Path.dirname(Destination))==='data'){
  const Metadata=JSON.parse(Buffer.from(Bundle.files['bootstrap.json'].base64,'base64').toString('utf8'));
  await writeFile(Path.join(Path.dirname(Destination),'caption-runtime-metadata.js'),'// Generated from native/captions/bootstrap.json and CaptionInstallerFiles.\nexport const CaptionPackageVersion='+Bundle.packageVersion+';\nexport const CaptionProcessingPolicy=Object.freeze('+JSON.stringify(Metadata.processing)+');\nexport const CaptionPackageFiles=Object.freeze('+JSON.stringify(CaptionInstallerFiles)+');\nexport const CaptionModelCatalog=Object.freeze(Object.fromEntries(Object.entries('+JSON.stringify(Metadata.models)+').map(([Id,Model])=>[Id,Object.freeze(Model)])));\n');
 }
}
if(process.argv[1]&&Path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await WriteCaptionInstaller(fileURLToPath(new URL('../../',import.meta.url)));
