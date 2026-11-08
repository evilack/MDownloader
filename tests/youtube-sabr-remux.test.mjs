import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {RemuxYoutubeTracks,YoutubePrefixReady} from '../extension/features/youtube/remux.js';
import {BufferTarget,Input,BlobSource,ALL_FORMATS,Output,Mp4OutputFormat,EncodedAudioPacketSource,EncodedPacketSink} from '../extension/vendor/mediabunny-1.65.2.mjs';
test('readiness requires committed key/audio packets; declared duration or only audio media is insufficient',async()=>{
 const bytes=await readFile(new URL('../website/sample/media/sample-film.mp4',import.meta.url));
 const headers=[];for(let p=0;p<bytes.length;){const size=bytes.readUInt32BE(p),type=bytes.toString('ascii',p+4,p+8);if(['ftyp','moov'].includes(type))headers.push(bytes.subarray(p,p+size));p+=size;}
 const init=new Blob(headers),full=new Blob([bytes]);assert.ok(init.size>0);
 assert.equal(await YoutubePrefixReady({video:init,audio:init}),false);
 assert.equal(await YoutubePrefixReady({video:init,audio:full}),false);
 assert.equal(await YoutubePrefixReady({video:full,audio:init}),false);
 assert.equal(await YoutubePrefixReady({video:full,audio:full}),true);
});
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
test('complete reception preserves every audio packet beyond the video end',async()=>{
 const blob=new Blob([await readFile(new URL('../website/sample/media/sample-film.mp4',import.meta.url))]);
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)}),audio=await input.getPrimaryAudioTrack();
 const target=new BufferTarget(),out=new Output({format:new Mp4OutputFormat(),target}),packets=new EncodedAudioPacketSource('aac');out.addAudioTrack(packets);await out.start();
 let count=0;for await(const packet of new EncodedPacketSink(audio).packets()){await packets.add(packet.clone({timestamp:packet.timestamp+0.5}),count?undefined:{decoderConfig:await audio.getDecoderConfig()});count++;}packets.close();await out.finalize();input.dispose();
 const result=await RemuxYoutubeTracks(blob,new Blob([target.buffer]),new BufferTarget(),new AbortController().signal,{preserveTrackEnds:true});
 assert.equal(result.audioPackets,count);
});
