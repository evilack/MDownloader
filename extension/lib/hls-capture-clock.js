import {CaptionDigest,CaptionSample,CaptionPolicy} from './concurrent-captions-contract.js';

const PtsPeriod=2**33,PtsRate=90000;
export const HlsWrapSeconds=PtsPeriod/PtsRate;
export function HlsConfigIdentity(Config){
 if(!Config)throw Error('stream_remux_decoder_config');
 const Normalize=Value=>{
  if(Value instanceof ArrayBuffer)return Array.from(new Uint8Array(Value));
  if(ArrayBuffer.isView(Value))return Array.from(new Uint8Array(Value.buffer,Value.byteOffset,Value.byteLength));
  if(Array.isArray(Value))return Value.map(Normalize);
  if(Value&&typeof Value==='object')return Object.fromEntries(Object.keys(Value).sort().filter(K=>Value[K]!==undefined).map(K=>[K,Normalize(Value[K])]));
  return Value;
 };
 return JSON.stringify(Normalize(Config));
}
/** Public SDK packed-audio metadata convention, including its initial wrap. */
export async function HlsRawTimestampOffset(Input){
 if((await Input.getFormat()).supportsTimestampedMediaData)return 0;
 const Owner='com.apple.streaming.transportStreamTimestamp',Priv=(await Input.getMetadataTags()).raw?.PRIV;
 for(const Bytes of Array.isArray(Priv)?Priv:[Priv]){
  if(!(Bytes instanceof Uint8Array)||Bytes.length!==Owner.length+9||new TextDecoder().decode(Bytes.subarray(0,Owner.length))!==Owner||Bytes[Owner.length]!==0)continue;
  const View=new DataView(Bytes.buffer,Bytes.byteOffset,Bytes.byteLength),High=View.getUint32(Owner.length+1),Low=View.getUint32(Owner.length+5);
  if(High>1)continue;
  const Value=High*2**32+Low,Reference=Value-60*PtsRate,Offset=Value>=PtsPeriod-60*PtsRate?-PtsPeriod:PtsPeriod;
  const Unwrapped=Offset<0&&Value>=Reference||Offset>0&&Value<Reference?Value+Offset:Value;
  return Unwrapped/PtsRate-await Input.getFirstTimestamp();
 }
 return null;
}
export async function HlsCaptureMapping(Descriptor,{firstTimestamp:Ps,rawOffset:R,referenceOffset:D,referenceEvidence,resolution,config,initHash,metadataDescriptorId=null}){
 const Ls=Descriptor.playlistStart,d=Descriptor.discontinuitySequence;
 if(![Ps,Ls,D].every(Number.isFinite)||!Number.isSafeInteger(resolution)||resolution<=0||R!==null&&!Number.isFinite(R))throw Error('caption_window_clock');
 const Base=R===null?Ls:R+D,k=R===null?0:Math.round((Ls-(Ps+Base))/HlsWrapSeconds),O=Base+k*HlsWrapSeconds;
 const configHash=await CaptionDigest(HlsConfigIdentity(config));
 const Evidence={descriptorId:Descriptor.id,d,Ls,Ps,R,D,k,O,resolution,configHash,initHash,metadataDescriptorId,reference:referenceEvidence};
 return Object.freeze({...Evidence,mappingId:await CaptionDigest(JSON.stringify(Evidence))});
}
export function HlsCaptureTime(Timestamp,Mapping){
 const Value=Math.round((Timestamp+Mapping.O)*Mapping.resolution)/Mapping.resolution;
 if(!Number.isFinite(Value))throw Error('caption_window_clock');return Value;
}
/** A TS segment's final AAC duration is estimated in 90k ticks by the SDK.
 * Normalize one processing sample only at a descriptor transition, bounded by
 * the source audio/PTS precision. Positive gaps and packet timestamps stay exact. */
export function HlsPacketSampleBoundary({timestamp,endTimestamp,origin,mapping,sourceSampleRate,codec,container,previous}){
 const Raw=CaptionSample(timestamp-origin),End=CaptionSample(endTimestamp-origin);let Start=Raw;
 if(previous&&Start<previous.endSample){
  const Resolution=mapping.resolution,Delta=previous.endTime-timestamp;
  const Noise=Number.EPSILON*Math.max(1,Math.abs(timestamp),Math.abs(previous.endTime))*4;
  const Adjacent=previous.endSample-Start===1&&codec==='aac'&&container==='MPEG Transport Stream'&&Resolution===90000&&Number.isSafeInteger(sourceSampleRate)&&sourceSampleRate>CaptionPolicy.sampleRate&&previous.sourceSampleRate===sourceSampleRate&&previous.resolution===Resolution&&previous.configHash===mapping.configHash&&previous.discontinuitySequence===mapping.d&&previous.descriptorId!==mapping.descriptorId;
  const Precision=Math.max(1/Resolution,1/sourceSampleRate);
  if(!Adjacent||!Number.isFinite(Delta)||Delta<0||Delta>Precision+Noise)throw Error('stream_capture_clock_overlap');
  Start=previous.endSample;
 }
 if(Start<0||End<=Start)throw Error('caption_window_clock');
 return {startSample:Start,endSample:End,correctionSamples:Start-Raw};
}
