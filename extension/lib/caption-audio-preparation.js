import {CaptionPolicy as Policy,CaptionDigest} from './concurrent-captions-contract.js';

const Fail=()=>{throw Error('caption_window_clock');};
const Bytes64=Bytes=>{let S='';for(let I=0;I<Bytes.length;I+=8192)S+=String.fromCharCode(...Bytes.subarray(I,I+8192));return btoa(S);};
const Int=N=>Number.isSafeInteger(N)&&N>=0;
/** App-owned preparation. Native only decodes, reads and writes explicit files. */
export function CreateCaptionAudioPreparation({run,raw,read,write,file,admission,windowOwners,decoderOwners,sessionOwners}){
 const Owners=new Map(),Reservations=new Map();
 const MaximumFrames=(Policy.chunkSeconds+2*Policy.contextSeconds)*Policy.sampleRate;
 async function ReadAt(R,Path,Offset,Length){
  const Parts=[];let Count=0;
  while(Count<Length){const P=await run(R,'read',{area:'jobs',path:Path,offset:Offset+Count,maxBytes:Math.min(Length-Count,Policy.uploadChunkBytes)}),B=Uint8Array.from(atob(P.data),C=>C.charCodeAt(0));
   if(!B.length||P.offset!==Offset+Count+B.length||B.length>Length-Count)Fail();Parts.push(B);Count+=B.length;}
  return new Uint8Array(await new Blob(Parts).arrayBuffer());
 }
 async function Wav(R,Part,Prefix){
  if(typeof Part.path!=='string'||!Part.path.startsWith(Prefix+'/')||Part.path.slice(Prefix.length+1).includes('/')||Part.path.includes('..')||Part.rate!==Policy.sampleRate||!Int(Part.frames)||!Part.frames)Fail();
  const Stat=await run(R,'stat',{area:'jobs',path:Part.path});if(!Stat.exists||Stat.isDirectory||!Int(Stat.size)||Stat.size>MaximumFrames*2+Policy.uploadChunkBytes)Fail();
  const Header=await ReadAt(R,Part.path,0,12),Tag=B=>String.fromCharCode(...B),V=new DataView(Header.buffer);
  if(Tag(Header.subarray(0,4))!=='RIFF'||Tag(Header.subarray(8,12))!=='WAVE'||V.getUint32(4,true)+8!==Stat.size)Fail();
  let At=12,Format=false,Data,Metadata=0;
  while(At+8<=Stat.size){const H=await ReadAt(R,Part.path,At,8),N=new DataView(H.buffer).getUint32(4,true),Name=Tag(H.subarray(0,4)),Start=At+8;
   if(Start+N>Stat.size)Fail();
   if(Name==='fmt '){if(Format||N<16||N>Policy.uploadChunkBytes)Fail();const B=await ReadAt(R,Part.path,Start,16),D=new DataView(B.buffer);
    if(D.getUint16(0,true)!==1||D.getUint16(2,true)!==1||D.getUint32(4,true)!==Policy.sampleRate||D.getUint32(8,true)!==Policy.sampleRate*2||D.getUint16(12,true)!==2||D.getUint16(14,true)!==16)Fail();Format=true;
   }else if(Name==='data'){if(Data||N!==Part.frames*2)Fail();Data={offset:Start,bytes:N};}
   else{Metadata+=N;if(Metadata>Policy.uploadChunkBytes)Fail();}
   At=Start+N+(N%2);
  }
  if(!Format||!Data||At!==Stat.size)Fail();return {...Part,...Data,size:Stat.size};
 }
 function Get(R,Token){const P=Owners.get(Token);if(!P||P.jobId!==R.id||P.attempt!==R.state.attempt||P.scope!==R.scope)throw Error('caption_preparation_missing');return P;}
 function ReleaseReservation(R){if(!R.session&&!R.sessionSlot&&![...Owners.values()].some(P=>P.jobId===R.id))Reservations.delete(R.id);}
 // Each active finite-window job can need its next/original PCM. All such
 // jobs share ONE additional repair slot, occupied by an actual repair when
 // present. Persistent decoders consume the same pool, not a separate quota.
 function PcmUse({preparedJob,repair=false,decoder=false}={}){
  const Active=new Set(Reservations.keys());if(preparedJob)Active.add(preparedJob.id);
  const Normal=new Map();let Repairs=0;
  for(const P of Owners.values()){if(P.repairOf)Repairs++;else Normal.set(P.jobId,(Normal.get(P.jobId)||0)+1);}
  if(preparedJob){if(repair)Repairs++;else Normal.set(preparedJob.id,(Normal.get(preparedJob.id)||0)+1);}
  let Count=decoderOwners.size+(decoder?1:0)+Repairs;
  for(const N of Normal.values())Count+=N;
  for(const Id of Active)Count+=Math.max(0,1-(Normal.get(Id)||0));
  if(Active.size)Count+=Math.max(0,1-Repairs);
  return Count;
 }
 function AdmitDecoder(R){if(PcmUse({decoder:true})>Policy.maxPcmWindows||!R.session&&sessionOwners.size>=Policy.maxInferenceSessions)throw Error('caption_window_backpressure');}
 async function Release(R,Token,CleanupScope='cleanup.'+crypto.randomUUID()){
  // Callers close/cancel physical work first. A canceled execution scope cannot
  // remove files; this explicit cleanup scope owns only the specified removal.
  for(const P of [...Owners.values()].filter(P=>P.jobId===R.id&&(!Token||P.token===Token))){
   await raw('remove',{area:'jobs',path:P.dir},CleanupScope);
   Owners.delete(P.token);windowOwners.delete(R.id+':prepare:'+P.token);if(R.encodedPreparation===P)R.encodedPreparation=null;
  }
  ReleaseReservation(R);
 }
 return {
  async dispatch(R,M){
   if(M.action==='prepareEncodedBegin'){
    if(R.state.mode!=='windowed'||R.state.inputSealed||R.state.resultRevision||!Int(M.bytes)||M.bytes<1||M.bytes>Policy.maxWindowBytes||!/^[a-f0-9]{64}$/.test(M.sha256||''))throw Error('caption_invalid');
    const Repair=M.repairOf!==undefined;
    if(Repair&&(!/^[a-f0-9]{64}$/.test(M.repairOf)||!Int(M.repairAttempt)||M.repairAttempt<1||M.repairAttempt>Policy.maxRepairAttempts||!['recognized','acked'].includes(R.windows.get(M.repairOf)?.phase)))throw Error('caption_window_conflict');
    const Identity=JSON.stringify([M.bytes,M.sha256,R.state.options,M.repairOf,M.repairAttempt]);
    if(R.encodedPreparation){const P=R.encodedPreparation;if(P.identity!==Identity)throw Error('caption_session_conflict');return {prepareToken:P.token,offset:P.offset,attempt:P.attempt};}
    const Admit=()=>{if(PcmUse({preparedJob:R,repair:Repair})>Policy.maxPcmWindows||windowOwners.size>=Policy.maxQueuedWindows||!R.session&&sessionOwners.size>=Policy.maxInferenceSessions||!Repair&&[...windowOwners.values()].filter(IsRepair=>!IsRepair).length>=Math.max(1,Policy.maxQueuedWindows-Policy.maxInferenceSessions))throw Error('caption_window_backpressure');};
    if(R.windows.size>=Policy.maxWindows)throw Error('caption_window_limit');Admit();
    await admission(R,M.bytes+MaximumFrames*2,true);
    Admit();
    const Token=crypto.randomUUID(),P={jobId:R.id,token:Token,attempt:R.state.attempt,scope:R.scope,dir:file(R,'prepared/'+Token),identity:Identity,repairOf:M.repairOf,repairAttempt:M.repairAttempt,sha256:M.sha256,bytes:M.bytes,offset:0,receipts:[]};
    R.encodedPreparation=P;Owners.set(Token,P);Reservations.set(R.id,R.scope);windowOwners.set(R.id+':prepare:'+Token,Repair);
    await write(P.dir+'/input.m4a',new Uint8Array(),R.scope);return {prepareToken:Token,offset:0,attempt:P.attempt};
   }
   const P=Get(R,M.prepareToken);
   if(M.action==='prepareEncodedRelease'){if(P.windowId)throw Error('caption_state');await Release(R,P.token);return {released:true,attempt:R.state.attempt};}
   if(M.action==='prepareEncodedAppend'){
    if(P.facts||P.decoding||P.decodeStarted)throw Error('caption_state');
    const B=Uint8Array.from(atob(M.data),C=>C.charCodeAt(0));if(!Int(M.offset)||!B.length||B.length>Policy.uploadChunkBytes||M.offset+B.length>P.bytes)throw Error('caption_invalid');
    const Hash=await CaptionDigest(B),Previous=P.receipts.find(X=>X.offset===M.offset);
    if(Previous){if(Previous.hash!==Hash||Previous.bytes!==B.length)throw Error('caption_window_conflict');return {offset:M.offset+B.length,attempt:P.attempt};}
    if(M.offset!==P.offset)throw Error('caption_upload_order');
    const Receipt=await run(R,'write',{area:'jobs',path:P.dir+'/input.m4a',offset:M.offset,data:M.data,truncate:false});if(Receipt.offset!==M.offset+B.length)throw Error('caption_upload_order');P.receipts.push({offset:M.offset,bytes:B.length,hash:Hash});P.offset+=B.length;return {offset:P.offset,attempt:P.attempt};
   }
   if(M.action!=='prepareEncodedSeal')throw Error('caption_invalid');
   if(P.facts)return P.facts;if(P.decoding)return P.decoding;if(P.decodeStarted)throw Error('caption_preparation_uncertain');
   if(P.offset!==P.bytes)throw Error('caption_upload_incomplete');const Encoded=await read(P.dir+'/input.m4a',R.scope,Policy.maxWindowBytes);
   if(Encoded.length!==P.bytes||await CaptionDigest(Encoded)!==P.sha256)throw Error('caption_window_checksum');
   P.decodeStarted=true;
   P.decoding=(async()=>{
    const D=await run(R,'decode',{source:P.dir+'/input.m4a',output:P.dir+'/decoded',rate:Policy.sampleRate,chunkSeconds:Policy.chunkSeconds,alignOrigin:false,maxOutputBytes:MaximumFrames*2,minFreeBytes:Policy.minFreeBytes});
    if(!Array.isArray(D.files)||!D.files.length||D.files.length>Math.ceil(MaximumFrames/(Policy.chunkSeconds*Policy.sampleRate)))Fail();
    const Parts=[];let N=0;for(const F of D.files){const Part=await Wav(R,F,P.dir+'/decoded');if(Parts.some(X=>X.path===Part.path))Fail();Parts.push(Part);N+=Part.frames;if(N>MaximumFrames)Fail();}
    P.parts=Parts;P.frames=N;P.facts={prepareToken:P.token,attempt:P.attempt,inputSha256:P.sha256,decodedFrames:N,rate:Policy.sampleRate,channels:1,sampleFormat:'s16',factsSha256:await CaptionDigest(JSON.stringify({inputSha256:P.sha256,parts:Parts,attempt:P.attempt,settings:R.state.options}))};return P.facts;
   })();try{return await P.decoding;}finally{P.decoding=null;}
  },
  validate(R,Token,Window){const P=Get(R,Token),D=Window.decode;
   if(!P.facts||P.windowId&&P.windowId!==Window.id||P.repairOf!==Window.repairOf||P.repairAttempt!==Window.repairAttempt||Window.codec!=='aac'||Window.descriptorVersion!==2||Window.sha256!==P.sha256||Window.bytes!==P.bytes||D.expectedFrames!==P.frames||Window.preparationFactsSha256!==P.facts.factsSha256||D.trimStartSamples+D.trimEndSamples+(Window.inputEndSample-Window.inputStartSample)!==P.frames)throw Error('caption_window_conflict');return P;
  },
  attach(R,Token,Window){const P=this.validate(R,Token,Window);P.windowId=Window.id;windowOwners.delete(R.id+':prepare:'+Token);R.encodedPreparation=null;return P;},
  async slice(R,Window,Token){
   const P=this.validate(R,Token,Window),Frames=Window.inputEndSample-Window.inputStartSample,Before=Window.decode.trimStartSamples,Path=P.dir+'/selected.wav';
   await admission(R,44+Frames*2,true);
   const Header=new Uint8Array(44),V=new DataView(Header.buffer),Text=(At,S)=>Header.set(new TextEncoder().encode(S),At);
   Text(0,'RIFF');V.setUint32(4,36+Frames*2,true);Text(8,'WAVEfmt ');V.setUint32(16,16,true);V.setUint16(20,1,true);V.setUint16(22,1,true);V.setUint32(24,Policy.sampleRate,true);V.setUint32(28,Policy.sampleRate*2,true);V.setUint16(32,2,true);V.setUint16(34,16,true);Text(36,'data');V.setUint32(40,Frames*2,true);
   await write(Path,Header,R.scope);let Position=0,Copied=0;
   for(const Part of P.parts){const Start=Math.max(Before,Position),End=Math.min(Before+Frames,Position+Part.frames);
    for(let At=Start;At<End;){const Count=Math.min(End-At,Math.floor(Policy.uploadChunkBytes/2)),B=await ReadAt(R,Part.path,Part.offset+(At-Position)*2,Count*2);
     const Reply=await run(R,'write',{area:'jobs',path:Path,offset:44+Copied*2,data:Bytes64(B),truncate:false});Copied+=Count;if(Reply.offset!==44+Copied*2)Fail();At+=Count;}
    Position+=Part.frames;
   }
   if(Copied!==Frames)Fail();await Wav(R,{path:Path,rate:Policy.sampleRate,frames:Frames},P.dir);return Path;
  },
  release:Release,
  releaseReservation:ReleaseReservation,
  admitDecoder:AdmitDecoder,
  size:()=>Owners.size,
 };
}
