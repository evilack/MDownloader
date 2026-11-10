import {CreateCommittedMediaSource} from './committed-media-source.js';
import {CreateCaptionPcmSource} from './caption-pcm-source.js';
import {CaptionPolicy} from './concurrent-captions-contract.js';
import {CaptionStage,ConcurrentCaptions} from './local-captions-runner.js';
import {CaptionOutputSession} from './caption-output-session.js';
import {RuntimePolicy} from './runtime-policy.js';

export function CreateCaptionJournal(Job,Kind,Signal,MaxBytes=RuntimePolicy.Transfer.MaxStreamScratchBytes){
 if(!Job.localCaptions?.enabled||Job.snapshot)return null;
 const ResourceIdentity={requestId:Job.requestId,kind:Kind},Largest=Number.MAX_SAFE_INTEGER;
 const EntryBytes=new TextEncoder().encode(JSON.stringify({sequence:Largest,offset:Largest,size:Largest,end:Largest})).length;
 const IdentityBytes=new TextEncoder().encode(JSON.stringify(ResourceIdentity)).length;
 return CreateCommittedMediaSource({signal:Signal,resourceIdentity:ResourceIdentity,limits:{maxBytes:MaxBytes,readChunkBytes:CaptionPolicy.uploadChunkBytes,maxEntries:Math.floor((CaptionPolicy.maxLedgerBytes-IdentityBytes)/EntryBytes)}});
}
// Publication only wakes readers. A caption resource error never rejects a
// successful original-file commit or aborts the independently owned transfer.
export function PublishCaptionChunk(Journal,File,Sequence,Offset){
 if(!Journal||Journal.failed)return;
 try{Journal.publish({sequence:Sequence,offset:Offset,file:File});}catch(E){Journal.fail(E);}
}
export function SealCaptionJournal(Journal,Reason){
 if(Journal&&!Journal.failed&&!Journal.sealed)Journal.seal({reason:Reason,finalBytes:Journal.committedLength});
}

/** Register initialization ownership synchronously, before the first header
 * wait. Opening/window setup is asynchronous and never blocks producer copy.
 * The journal OWNER stays admitted for seekable reads until physical close.
 */
export function StartCommittedCaptions(Job,Journal,Workspace,Signal,Metadata){
 if(!Journal)return null;
 const Session=CaptionOutputSession(Job),Controller=new AbortController();
 const InputSignal=AbortSignal.any([Signal,Session.controller.signal,Controller.signal].filter(Boolean));
 let Source,Starting,Closing,Released=false;
 const Owner={async release(){
  if(Released)return;if(Closing)return Closing;
  Closing=(async()=>{
   Controller.abort(new DOMException('Caption input released','AbortError'));
   await Starting?.catch(()=>{});
   await Source?.release();
   Session.captionSources.delete(Source);
   Journal.release();Released=true;
  })();
  try{await Closing;}finally{Closing=null;}
 }};
 Session.captionSources.add(Owner);
 const Transport=ConcurrentCaptions.bind(Job,InputSignal).transport;
 Job.captionCommittedInput=true;
 Starting=(async()=>{
  try{
   const Access=typeof Metadata==='function'?await Metadata(InputSignal):Metadata;
   InputSignal.throwIfAborted();
   Source=CreateCaptionPcmSource({job:Job,stage:CaptionStage,bytes:Journal,metadata:Access,workspace:Workspace,signal:InputSignal});
   const Accepted=await ConcurrentCaptions.windowed(Job,Source,InputSignal,JSON.stringify(Journal.snapshot().resourceIdentity));
   // The pending owner also owns the eventual source, in every startup phase.
   Session.captionSources.delete(Source);
   if(!Accepted)throw Error('caption_concurrent_unavailable');
  }catch(E){
   let Failure=E;
   // Keep the owner/journal/workspace for raw output retry. A failed actual
   // close remains registered and is retried by output-session cleanup.
   try{await Source?.release();}catch(CloseError){Failure=CloseError;}
   // Producer/output Job spreads share this transport and startup promise.
   // Publish the settled outcome before resolving setup, including failures
   // before windowed assigns its own error. Physical close failure wins.
   Job.captionConcurrencyError=Failure;Transport.error=Failure;
   if(!InputSignal.aborted&&Failure.name!=='AbortError')await CaptionStage(Job,'failure',{code:Failure.message,...(Failure.captionDetails?{details:Failure.captionDetails}:{})}).catch(()=>{});
  }
 })();
 Job.captionConcurrentStart=Starting;
 return Owner;
}

/** Exact original files, each closed before publication; no growing file is
 * exposed as a decoder input. Final raw Blob is those same snapshots in order.
 */
export function CreateCommittedFileStore(Directory,Journal){
 const Files=[];let Bytes=0,Closed=false;
 return {
  journal:Journal,workspace:Directory,get bytes(){return Bytes;},
  async write(Data){
   if(Closed)throw Error('caption_source_sealed');
   if(!Data.byteLength)return;
   const Handle=await Directory.getFileHandle('source-'+String(Files.length).padStart(8,'0')+'.chunk',{create:true}),Writer=await Handle.createWritable();
   try{await Writer.write(Data);await Writer.close();}catch(E){await Writer.abort().catch(()=>{});throw E;}
   const File=await Handle.getFile(),Offset=Bytes;Files.push(File);Bytes+=File.size;
   PublishCaptionChunk(Journal,File,Files.length-1,Offset);
  },
  async close(){Closed=true;},
  file:(Type)=>new Blob(Files,{type:Type}),
 };
}
