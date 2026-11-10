import {ReadMp4Metadata} from './partial-file.js';
import {CaptionPolicy} from './concurrent-captions-contract.js';
import {RuntimePolicy} from './runtime-policy.js';
import {CaptionStage} from './local-captions-runner.js';

/** Decoder access is fixed only after actual header inspection. Missing Range
 * support on a tail-moov file waits for the independent main GET to seal, then
 * opens one seekable decoder over that exact complete journal. */
export function DirectCaptionMetadata(Job,Journal,Store,Response){
 return async Signal=>{
  async function Available(End){
   while(Journal.committedLength<End&&!Journal.sealed){Signal.throwIfAborted();await Journal.waitForChange(Journal.revision,{signal:Signal});}
   Signal.throwIfAborted();return Journal.committedLength>=End;
  }
  async function Read(Start,End){
   const Parts=[];
   for(let At=Start;At<End;At+=CaptionPolicy.uploadChunkBytes)Parts.push(await Journal.read(At,Math.min(End,At+CaptionPolicy.uploadChunkBytes),{signal:Signal}));
   const Data=new Uint8Array(End-Start);let Offset=0;for(const Part of Parts){Data.set(Part,Offset);Offset+=Part.length;}return Data;
  }
  function FullAccess(){return {access:{seekable:true,knownSize:Journal.committedLength},readAt:async()=>null};}
  async function Complete(){
   if(!Journal.sealed)await CaptionStage(Job,'processing',{phase:'metadata-waiting'});
   while(!Journal.sealed){Signal.throwIfAborted();await Journal.waitForChange(Journal.revision,{signal:Signal});}
   Signal.throwIfAborted();return FullAccess();
  }
  if(!await Available(8))return null;
  const First=await Read(0,8),Type=B=>String.fromCharCode(...B.subarray(4,8));
  if(!['ftyp','styp','moov','mdat','free','skip','wide'].includes(Type(First)))return Journal.sealed?FullAccess():null;
  let Position=0,Scanned=0;
  for(;;){
   if(!await Available(Position+8))return FullAccess();
   let Header=await Read(Position,Position+8),Size=new DataView(Header.buffer).getUint32(0),Kind=Type(Header);
   Scanned+=8;if(Scanned>RuntimePolicy.Transfer.MaxSnapshotMetadataBytes)throw Error('caption_source_budget');
   if(Size===1){if(!await Available(Position+16))throw Error('caption_source_identity');Header=await Read(Position,Position+16);Size=Number(new DataView(Header.buffer).getBigUint64(8));Scanned+=8;}
   if(!Number.isSafeInteger(Size)||Size!==0&&Size<Header.length)throw Error('caption_source_identity');
   if(Kind==='moov'){
    if(Size===0)return Complete();
    if(!Number.isSafeInteger(Position+Size))throw Error('caption_source_identity');
    if(!await Available(Position+Size))throw Error('caption_source_identity');
    // moov precedes media: normal nonseekable faststart/fMP4 can begin now.
    return Journal.sealed?FullAccess():null;
   }
   if(Kind==='mdat'||Size===0){
    const Total=Number(Response.headers.get('content-length')),Validator=Response.headers.get('etag'),Encoding=Response.headers.get('content-encoding');
    const Eligible=Number.isSafeInteger(Total)&&Total>0&&/^"[^"\r\n]*"$/.test(Validator||'')&&(!Encoding||Encoding.toLowerCase()==='identity');
    if(Eligible){
     try{
      await CaptionStage(Job,'processing',{phase:'metadata-waiting'});
      const Overlays=await ReadMp4Metadata({file:Store.file(),total:Total,url:Response.url,validator:Validator},Signal,{strictIdentity:true,captureHeaders:true});
      Signal.throwIfAborted();
      if(Journal.committedLength>Total||Journal.sealed&&Journal.committedLength!==Total)throw Error('caption_source_identity');
      Store.captionKnownSize=Total;
      return {access:{seekable:true,knownSize:Total},async readAt(Offset,Length,{signal}){
       signal?.throwIfAborted();
       const Overlay=Overlays.filter(O=>O.start<=Offset&&Offset<O.start+O.data.length).sort((A,B)=>B.data.length-A.data.length)[0];
       return Overlay?{data:Overlay.data.subarray(Offset-Overlay.start,Offset-Overlay.start+Length),eof:false}:null;
      }};
     }catch(E){
      Signal.throwIfAborted();
      if(E.key==='job_snapshot_source_changed'||E.message==='job_snapshot_source_changed')throw Error('caption_source_identity');
      // Metadata unavailable is a readiness state; original body still copies.
      if(E.key!=='job_snapshot_metadata'&&E.message!=='job_snapshot_metadata'&&E.key!=='stream_http_timeout'&&E.name!=='TimeoutError'&&!(E instanceof TypeError))throw E;
     }
    }
    return Complete();
   }
   Position+=Size;if(!Number.isSafeInteger(Position))throw Error('caption_source_identity');
  }
 };
}
