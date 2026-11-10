import {CaptionPolicy,CaptionDigest} from './concurrent-captions-contract.js';
import {RequirePickedFolder} from './picked-download-folder.js';
import {CaptionOutputSession} from './caption-output-session.js';
import {ReadLiveCaptionFile,ForgetLiveCaptionFile,LiveCaptionFileFingerprint,LiveCaptionFileName} from './live-caption-file-store.js';

const Owners=new Set(),Gate='mdownloader-live-caption-file-owners';
const SameScope=(A,B)=>A?.attempt===B?.attempt&&A?.controlRevision===B?.controlRevision;
function Time(Ms){const Seconds=Math.floor(Ms/1000);return [Math.floor(Seconds/3600),Math.floor(Seconds/60)%60,Seconds%60].map(N=>String(N).padStart(2,'0')).join(':')+'.'+String(Ms%1000).padStart(3,'0');}
export function LiveCaptionVtt(State){
 const Lines=['WEBVTT','','NOTE Live recognition; source-audio timestamps; provisional text may change.',''];
 for(const [Index,C]of State.cues.entries()){
  if(!Number.isSafeInteger(C.startSample)||!Number.isSafeInteger(C.endSample)||C.startSample<0||C.endSample<=C.startSample||typeof C.text!=='string')throw Error('caption_live_file_invalid');
  const Text=C.text.replace(/[\r\n\x00]+/g,' ').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if(!Text.trim())continue;const Start=Math.floor(C.startSample/CaptionPolicy.sampleRate*1000),End=Math.max(Start+1,Math.ceil(C.endSample/CaptionPolicy.sampleRate*1000));
  Lines.push(String(Index+1),Time(Start)+' --> '+Time(End),Text,'');
 }
 const File=new Blob([Lines.join('\n')+'\n'],{type:'text/vtt;charset=utf-8'});if(File.size>CaptionPolicy.maxLedgerBytes)throw Error('caption_live_file_limit');return File;
}
function CreateWriter(View,Check,Report){
 View.signal.throwIfAborted();
 const Job=View.job,Signal=View.signal;let Latest,Pending,Running,Closing,Attaching,Target,Stopped=false,Failed=false,Paused=false,ActiveWriter,Written=0;
 const Owner={handle:null};Owners.add(Owner);
 async function Current(){Signal.throwIfAborted();if(Stopped)throw new DOMException('Canceled','AbortError');const V=await Check();Signal.throwIfAborted();if(Stopped)throw new DOMException('Canceled','AbortError');if(!SameScope(V,View))throw Error('caption_stale_attempt');return V;}
 async function Claim(Handle){
  for(const Other of Owners)if(Other!==Owner&&Other.handle&&await Other.handle.isSameEntry(Handle))throw Error('caption_live_file_busy');Owner.handle=Handle;
 }
 async function Automatic(){
  const Folder=await RequirePickedFolder(Job.pickedDownloadFolder),Name=LiveCaptionFileName(Job,View).replace(/\.vtt$/,'-'+crypto.randomUUID()+'.vtt');
  return navigator.locks.request(Gate,{signal:Signal},async()=>{
   await Current();try{await Folder.getFileHandle(Name);throw Error('caption_live_file_exists');}catch(E){if(E.name!=='NotFoundError')throw E;}
   const Handle=await Folder.getFileHandle(Name,{create:true}),Fingerprint=await LiveCaptionFileFingerprint(Handle);
   if(Fingerprint.bytes!==0)throw Error('caption_live_file_conflict');await Claim(Handle);return {handle:Handle,folder:Folder,name:Name,fingerprint:Fingerprint};
  });
 }
 async function Verify(){
  await Current();if(await Target.handle.queryPermission({mode:'readwrite'})!=='granted')throw Error('caption_live_file_permission');
  if(Target.folder&&!await Target.handle.isSameEntry(await Target.folder.getFileHandle(Target.name)))throw Error('caption_live_file_conflict');
  const F=await LiveCaptionFileFingerprint(Target.handle);if(F.bytes!==Target.fingerprint.bytes||F.sha256!==Target.fingerprint.sha256||F.modified!==Target.fingerprint.modified)throw Error('caption_live_file_conflict');
 }
 async function Drain(){
  try{while(Pending&&!Stopped&&!Failed&&!Paused){
   const V=Pending;Pending=null;await Current();
   if(!Target){if(!Job.pickedDownloadFolder){await Report({phase:'awaiting-selection'});return;}Target=await Automatic();}
   const File=LiveCaptionVtt(V.state);await Verify();await Report({phase:'writing',filename:Target.name,revision:V.revision});
   const Writable=await Target.handle.createWritable({keepExistingData:false});ActiveWriter=Writable;
   try{await Writable.write(File);await Current();await Writable.close();ActiveWriter=null;}catch(E){await Writable.abort().catch(()=>{});ActiveWriter=null;throw E;}
   // A close receipt precedes publication. External changes are checked again
   // before the next revision; these checks are not an OS compare-and-swap.
   Target.fingerprint=await LiveCaptionFileFingerprint(Target.handle);
   if(Target.fingerprint.bytes!==File.size||Target.fingerprint.sha256!==await CaptionDigest(File))throw Error('caption_live_file_conflict');
   await Current();Written=V.revision;await Report({phase:'saved',filename:Target.name,revision:Written,bytes:File.size});
  }}catch(E){if(!Stopped&&!Signal.aborted){Failed=true;await Report({phase:'failed',error:/^caption_/.test(E.message)?E.message:'caption_live_file_write_failed'}).catch(()=>{});}}
 }
 function Schedule(){if(!Running&&!Stopped&&!Failed&&!Paused){Running=Drain().finally(()=>{Running=null;if(Pending&&!Stopped&&!Failed&&!Paused)Schedule();});}return Running;}
 const Writer={
  update(V){if(!SameScope(V,View)||Stopped||V.revision<=(Latest?.revision??-1))return;Latest=V;if(V.revision>Written||!Target){Pending=V;Schedule();}},
  attach(Record){
   const Previous=Attaching,Task=(async()=>{
    await Previous?.catch(()=>{});await Current();if(!SameScope(Record,View)||Record.requestId!==Job.requestId)throw Error('caption_stale_attempt');
    Paused=true;try{if(Running)await Running;await navigator.locks.request(Gate,{signal:Signal},async()=>{await Current();await Claim(Record.handle);Target={handle:Record.handle,name:Record.handle.name,fingerprint:Record.fingerprint};});
     Failed=false;Written=0;Pending=Latest||View;
    }finally{Paused=false;if(Pending&&!Stopped&&!Failed)Schedule();}
    await Schedule();if(Failed)throw Error('caption_live_file_write_failed');
   })();Attaching=Task;return Task.finally(()=>{if(Attaching===Task)Attaching=null;});
  },
  async flush(){for(;;){if(Attaching){await Attaching.catch(()=>{});continue;}if(Running){await Running;continue;}if(Pending&&!Stopped&&!Failed){await Schedule();continue;}return;}},
  release(){if(Closing)return Closing;Stopped=true;Pending=null;Closing=(async()=>{await ActiveWriter?.abort().catch(()=>{});await Promise.allSettled([Running,Attaching]);Owners.delete(Owner);Signal.removeEventListener('abort',Abort);})();return Closing;},
 };
 const Abort=()=>{void Writer.release();};Signal.addEventListener('abort',Abort,{once:true});return Writer;
}
/** Offscreen-owned file writers. No durable source/session recovery is stored. */
export function CreateLiveCaptionFiles({view:View,check:Check,report:Report}){
 const Writers=new Map(),Selecting=new Map();
 async function WriterFor(V){
  const Id=V.job.requestId,Previous=Selecting.get(Id);
  const Task=(async()=>{await Previous?.catch(()=>{});V.signal.throwIfAborted();const Scope=await Check(V);if(!SameScope(Scope,V))throw Error('caption_stale_attempt');
   let E=Writers.get(Id);if(E&&!SameScope(E,V)){await E.writer.release();V.signal.throwIfAborted();if(!SameScope(await Check(V),V))throw Error('caption_stale_attempt');Writers.delete(Id);E=null;}
   if(!E){const Writer=CreateWriter(V,()=>Check(V),Fields=>Report(V,Fields)),Release=Writer.release,Session=CaptionOutputSession(V.job);
    Writer.release=async()=>{await Release();if(Writers.get(Id)?.writer===Writer)Writers.delete(Id);Session.captionSources.delete(Writer);};
    E={attempt:V.attempt,controlRevision:V.controlRevision,writer:Writer};Writers.set(Id,E);Session.captionSources.add(Writer);
   }return E.writer;
  })();Selecting.set(Id,Task);try{return await Task;}finally{if(Selecting.get(Id)===Task)Selecting.delete(Id);}
 }
 async function Publish(V){const W=await WriterFor(V);W.update(V);if(V.finished)await W.flush();}
 chrome.runtime.onMessage.addListener((M,Sender,Respond)=>{
  if(M?.type!=='captionLiveFileSelected'||Sender.id!==chrome.runtime.id||Sender.tab||Sender.url!==chrome.runtime.getURL('background.js'))return;
  void(async()=>{
   const V=View(M.requestId);if(!V||!SameScope(V,M))throw Error('caption_stale_attempt');
   const R=await ReadLiveCaptionFile(M.fileKey);if(!R)throw Error('caption_live_file_missing');
   if(!SameScope(R,V)||R.requestId!==M.requestId||R.handle?.kind!=='file')throw Error('caption_stale_attempt');
   const W=await WriterFor(V);await W.attach(R);await ForgetLiveCaptionFile(M.fileKey);return {ok:true};
  })().then(Respond,E=>Respond({ok:false,error:/^caption_/.test(E.message)?E.message:'caption_live_file_write_failed'}));return true;
 });
 return {publish:Publish};
}
