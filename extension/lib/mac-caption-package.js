// Scripts-only flat component package: XAR contains PackageInfo and gzip/newc Scripts.
const Encode=S=>new TextEncoder().encode(S);
const Join=Parts=>{const Out=new Uint8Array(Parts.reduce((N,P)=>N+P.length,0));let Offset=0;for(const P of Parts){Out.set(P,Offset);Offset+=P.length;}return Out;};
async function Compress(Bytes,Format){return new Uint8Array(await new Response(new Blob([Bytes]).stream().pipeThrough(new CompressionStream(Format))).arrayBuffer());}
function Cpio(Entries){
 const Parts=[];let Index=1;
 for(const [Name,Bytes,Mode] of [...Entries,['TRAILER!!!',new Uint8Array(),0]]){
  const Path=Encode(Name+'\0'),Fields=[Index++,Mode,0,0,1,0,Bytes.length,0,0,0,0,Path.length,0];
  const Header=Encode('070701'+Fields.map(N=>N.toString(16).padStart(8,'0')).join(''));
  Parts.push(Header,Path,new Uint8Array((4-(Header.length+Path.length)%4)%4),Bytes,new Uint8Array((4-Bytes.length%4)%4));
 }
 return Join(Parts);
}
async function CreateMacPackage(Bundle,ExtensionId,Entry,Identifier){
 if(!/^[a-p]{32}$/.test(ExtensionId))throw Error('Invalid extension ID');
 const Entries=[['.',new Uint8Array(),0o40755]];
 for(const [Name,File] of Object.entries(Bundle.files)){
  if(!/^[a-z0-9_][a-z0-9_.-]*$/.test(Name))throw Error('Invalid package filename');
  const Bytes=Uint8Array.from(atob(File.base64),C=>C.charCodeAt(0));
  const Hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Bytes)),B=>B.toString(16).padStart(2,'0')).join('');
  if(Hash!==File.sha256)throw Error('Package checksum mismatch');Entries.push(['./'+Name,Bytes,Name.endsWith('.sh')?0o100755:0o100644]);
 }
 const Postinstall=`#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ "$(id -u)" == 0 ]];then
 user="$(/usr/bin/stat -f '%Su' /dev/console)"
 [[ "$user" != root && "$user" != loginwindow && -n "$user" ]] || exit 1
 exec /usr/bin/sudo -H -u "$user" /bin/bash "$PWD/${Entry}" '${ExtensionId}'
fi
exec /bin/bash "$PWD/${Entry}" '${ExtensionId}'
`;
 Entries.push(['./postinstall',Encode(Postinstall),0o100755]);
 const Scripts=await Compress(Cpio(Entries),'gzip');
 const Info=Encode('<?xml version="1.0" encoding="utf-8"?><pkg-info format-version="2" identifier="'+Identifier+'" version="1.0" install-location="/" auth="root"><payload numberOfFiles="0" installKBytes="0"/><scripts><postinstall file="./postinstall"/></scripts></pkg-info>');
 const Files=[['PackageInfo',Info],['Scripts',Scripts]];let Offset=0;
 const Xml='<?xml version="1.0" encoding="utf-8"?><xar><toc><creation-time>2026-11-09T00:00:00Z</creation-time>'+Files.map(([Name,Bytes],I)=>{const Part=`<file id="${I+1}"><name>${Name}</name><type>file</type><mode>0644</mode><data><length>${Bytes.length}</length><offset>${Offset}</offset><size>${Bytes.length}</size><encoding style="application/octet-stream"/></data></file>`;Offset+=Bytes.length;return Part;}).join('')+'</toc></xar>';
 const Toc=await Compress(Encode(Xml),'deflate'),Header=new Uint8Array(28),View=new DataView(Header.buffer);
 Header.set(Encode('xar!'));View.setUint16(4,28);View.setUint16(6,1);View.setBigUint64(8,BigInt(Toc.length));View.setBigUint64(16,BigInt(Encode(Xml).length));View.setUint32(24,0);
 return Join([Header,Toc,...Files.map(([,Bytes])=>Bytes)]);
}
// Retained for maintainer tooling; Options uses the common helper package below.
export function CreateMacCaptionPackage(Bundle,ExtensionId){return CreateMacPackage(Bundle,ExtensionId,'bootstrap.sh','com.mdownloader.captions.setup');}
export function CreateMacCommonPackage(Bundle,ExtensionId){
 const Names=['host.sh','host.js','worker.sh','install.sh'];
 if(Bundle.version!==1||Object.keys(Bundle.files??{}).length!==Names.length||Names.some(N=>typeof Bundle.files[N]?.base64!=='string'||!/^[a-f0-9]{64}$/.test(Bundle.files[N]?.sha256??'')))throw Error('Invalid common helper package');
 return CreateMacPackage(Bundle,ExtensionId,'install.sh','com.mdownloader.common.setup');
}
