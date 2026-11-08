import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RemuxYoutubeTracks} from '../extension/features/youtube/remux.js';
import {BufferTarget,Input,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,EncodedAudioPacketSource,EncodedPacketSink} from '../extension/vendor/mediabunny-1.65.2.mjs';
test('separate SABR file inputs are copied into a playable common audio/video interval',async()=>{
 const blob=new Blob([await readFile(new URL('../website/sample/media/sample-film.mp4',import.meta.url))]);
 const target=new BufferTarget();const result=await RemuxYoutubeTracks(blob,blob,target,new AbortController().signal);
 assert.ok(result.duration>0);assert.ok(result.videoPackets>0);assert.ok(result.audioPackets>0);
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(new Blob([target.buffer]))});
 try{assert.ok(await input.getPrimaryVideoTrack());assert.ok(await input.getPrimaryAudioTrack());assert.ok(await input.computeDuration()>0);}finally{input.dispose();}
});
test('a later audio start preserves the leading video keyframe and audio offset',async()=>{
 const blob=new Blob([await readFile(new URL('../website/sample/media/sample-film.mp4',import.meta.url))]);
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)}),audio=await input.getPrimaryAudioTrack();
 const target=new BufferTarget(),out=new Output({format:new Mp4OutputFormat(),target}),packets=new EncodedAudioPacketSource('aac');out.addAudioTrack(packets);await out.start();
 let first=true;for await(const packet of new EncodedPacketSink(audio).packets()){await packets.add(packet.clone({timestamp:packet.timestamp+0.01}),first?{decoderConfig:await audio.getDecoderConfig()}:undefined);first=false;}packets.close();await out.finalize();input.dispose();
 const result=await RemuxYoutubeTracks(blob,new Blob([target.buffer]),new BufferTarget(),new AbortController().signal);
 assert.ok(result.videoPackets>0);assert.ok(result.audioPackets>0);
});
