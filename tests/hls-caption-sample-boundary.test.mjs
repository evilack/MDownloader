import test from 'node:test';
import assert from 'node:assert/strict';
import {HlsPacketSampleBoundary} from '../extension/lib/hls-capture-clock.js';

const origin=-0.04644444444444444,resolution=90000,hash='same-aac-config';
const previous={endSample:65388,endTime:4.040277777777778,resolution,sourceSampleRate:44100,descriptorId:'previous',configHash:hash,discontinuitySequence:0};
const input={timestamp:4.040266666666667,endTimestamp:4.086711111111111,origin,sourceSampleRate:44100,codec:'aac',container:'MPEG Transport Stream',mapping:{resolution,descriptorId:'next',configHash:hash,d:0},previous};
test('one TS clock tick across a PCM rounding threshold cannot create a false overlap',()=>{
 const value=HlsPacketSampleBoundary(input);assert.equal(value.startSample,65388);assert.equal(value.correctionSamples,1);assert.ok(value.endSample>value.startSample);
});
test('AAC packet duration rounding stays within one actual source audio sample',()=>{
 const sourceSampleRate=22050,last={...previous,endTime:4.0403,sourceSampleRate};
 const value=HlsPacketSampleBoundary({...input,sourceSampleRate,previous:last});assert.equal(value.startSample,65388);assert.equal(value.correctionSamples,1);
 for(const changed of [{sourceSampleRate:16000,previous:{...last,sourceSampleRate:16000}},{sourceSampleRate:44100,previous:last},{timestamp:input.timestamp-4/resolution}])assert.throws(()=>HlsPacketSampleBoundary({...input,sourceSampleRate,previous:last,...changed}),/stream_capture_clock_overlap/);
});
test('a positive one-tick gap remains a gap instead of inventing audio coverage',()=>{
 const last={...previous,endSample:65387,endTime:4.040266666666667};
 const value=HlsPacketSampleBoundary({...input,timestamp:4.040277777777778,previous:last});assert.equal(value.startSample,65388);assert.equal(value.correctionSamples,0);
});
test('real overlap, different codec/discontinuity and coarse clocks are never smoothed',()=>{
 for(const change of [{timestamp:input.timestamp-2/resolution},{previous:{...previous,endSample:65389}},{codec:'mp3'},{container:'mp4'},{mapping:{...input.mapping,descriptorId:'previous'}},{mapping:{...input.mapping,configHash:'different'}},{mapping:{...input.mapping,d:1}},{mapping:{...input.mapping,resolution:96000}},{mapping:{...input.mapping,resolution:1000},previous:{...previous,resolution:1000}}])assert.throws(()=>HlsPacketSampleBoundary({...input,...change}),/stream_capture_clock_overlap/);
});
test('a boundary correction cannot make an empty or negative audio interval',()=>{
 assert.throws(()=>HlsPacketSampleBoundary({...input,endTimestamp:input.timestamp+1/resolution}),/caption_window_clock/);
});
test('a real positive gap is retained for epoch separation',()=>{
 const value=HlsPacketSampleBoundary({...input,timestamp:input.timestamp+0.01});assert.ok(value.startSample>previous.endSample);assert.equal(value.correctionSamples,0);
});
