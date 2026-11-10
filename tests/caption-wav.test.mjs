import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateCaptionWavHeader,ValidateCaptionPcmWav} from '../extension/lib/caption-wav.js';

const HeaderHex='524946462a00000057415645666d74201000000001000100803e0000007d0000020010006461746106000000';
const Wav=()=>Uint8Array.from([...Buffer.from(HeaderHex,'hex'),1,2,3,4,5,6]);

test('caption PCM header preserves the exact mono s16le wire format',()=>{
 assert.equal(Buffer.from(CreateCaptionWavHeader(3,16000)).toString('hex'),HeaderHex);
 ValidateCaptionPcmWav(Wav(),16000);
 ValidateCaptionPcmWav(CreateCaptionWavHeader(0,16000),16000);
 const Backing=new Uint8Array(64);Backing.set(Wav(),7);
 ValidateCaptionPcmWav(Backing.subarray(7,57),16000);
});

test('caption PCM validation rejects malformed headers, truncated bodies and a different sample rate',()=>{
 for(const Offset of [0,4,8,12,16,20,22,24,28,32,34,36,40]){
  const Bytes=Wav();Bytes[Offset]^=1;
  assert.throws(()=>ValidateCaptionPcmWav(Bytes,16000),{message:'caption_window_clock'},'field at '+Offset);
 }
 for(const Bytes of [new Uint8Array(),Wav().subarray(0,43),Wav().subarray(0,49)]){
  assert.throws(()=>ValidateCaptionPcmWav(Bytes,16000),{message:'caption_window_clock'});
 }
 assert.throws(()=>ValidateCaptionPcmWav(Wav(),48000),{message:'caption_window_clock'});
});
