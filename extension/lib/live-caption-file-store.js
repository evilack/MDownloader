import {CaptionPolicy,CaptionDigest} from './concurrent-captions-contract.js';
const Database='mdownloader-live-caption-files',Store='pending-files';
export function LiveCaptionFileName(Job,Scope=Job.captionStatus){
 const Stem=String(Job.filename||'captions').replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100)||'captions';
 return Stem+'.live-'+Job.requestId+'-'+(Scope?.attempt||0)+'-'+(Scope?.controlRevision||0)+'.vtt';
}
async function Use(Mode,Run){
 const Db=await new Promise((Resolve,Reject)=>{const Open=indexedDB.open(Database,1);Open.onupgradeneeded=()=>Open.result.createObjectStore(Store);Open.onsuccess=()=>Resolve(Open.result);Open.onerror=()=>Reject(Open.error);});
 try{return await new Promise((Resolve,Reject)=>{const T=Db.transaction(Store,Mode),R=Run(T.objectStore(Store));T.oncomplete=()=>Resolve(R.result);T.onabort=()=>Reject(T.error);T.onerror=()=>Reject(T.error);});}finally{Db.close();}
}
export async function LiveCaptionFileFingerprint(Handle){
 const File=await Handle.getFile();if(File.size>CaptionPolicy.maxLedgerBytes)throw Error('caption_live_file_limit');
 return {bytes:File.size,modified:File.lastModified,sha256:await CaptionDigest(File)};
}
export async function RememberLiveCaptionFile(Handle,Scope){
 if(Handle?.kind!=='file'||!Number.isSafeInteger(Scope.attempt)||Scope.attempt<1||!Number.isSafeInteger(Scope.controlRevision)||Scope.controlRevision<0||!/^[-a-f\d]{36}$/i.test(Scope.requestId))throw Error('caption_invalid');
 if(await Handle.queryPermission({mode:'readwrite'})!=='granted')throw Error('caption_live_file_permission');
 const Key=crypto.randomUUID(),Fingerprint=await LiveCaptionFileFingerprint(Handle);
 await Use('readwrite',S=>S.add({...Scope,handle:Handle,fingerprint:Fingerprint},Key));return Key;
}
export function ReadLiveCaptionFile(Key){if(!/^[-a-f\d]{36}$/i.test(Key||''))throw Error('caption_invalid');return Use('readonly',S=>S.get(Key));}
export const ForgetLiveCaptionFile=Key=>Use('readwrite',S=>S.delete(Key));
export const ClearPendingLiveCaptionFiles=()=>Use('readwrite',S=>S.clear());
