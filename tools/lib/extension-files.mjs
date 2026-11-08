import{readdir}from'node:fs/promises';import Path from'node:path';
/** This project only uses Chrome's _locales reserved directory. No temporary underscore resources belong in its source. */
export async function AssertExtensionFilenames(Root){
 async function Walk(Directory,Prefix=''){
  for(const Entry of await readdir(Directory,{withFileTypes:true})){
   const Relative=Prefix+Entry.name;
   if(Entry.name.startsWith('_')&&!(Prefix===''&&Entry.name==='_locales'&&Entry.isDirectory()))throw Error('Reserved extension filename: '+Relative);
   if(Entry.isDirectory())await Walk(Path.join(Directory,Entry.name),Relative+'/');
  }
 }
 await Walk(Root);
}
