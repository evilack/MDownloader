/**
 * 다운로드한 조각을 Mediabunny에 전달해 원본 코덱으로 MP4를 만듭니다. 영상과 오디오 시각의 기준을 맞추며 선택한 출력 대상으로 직접 씁니다.
 */
import { LocalizedError } from './i18n.js';
import { RuntimePolicy } from './runtime-policy.js';
import {CaptionPolicy} from './concurrent-captions-contract.js';
import {
	ALL_FORMATS,BlobSource, CustomPathedSource, EncodedAudioPacketSource, EncodedPacketSink,
	EncodedVideoPacketSource, HLS_FORMATS, Input, Mp4OutputFormat, Output, StreamTarget,
} from '../vendor/mediabunny-1.65.2.mjs';
/** Independent final reader over exactly the frozen committed descriptor IDs. */
export async function RemuxCapturedHls({capture,destination,signal,audioShift=capture.audioShift}){
 const Controller=new AbortController(),Signal=AbortSignal.any([signal,Controller.signal]);
 let VideoReader,AudioReader,MediaOutput,Copies=[];
 async function Packet(Reader){for(;;){const E=await Reader.next();if(E.kind==='packet')return E;if(E.kind==='eof')return null;}}
 try{
  VideoReader=capture.reader({type:'video',signal:Signal});AudioReader=capture.reader({type:'audio',signal:Signal});
  if(!Number.isFinite(audioShift)||capture.shiftApplied&&audioShift)throw Error('stream_capture_shift');
  const [Video,Audio]=await Promise.all([Packet(VideoReader),Packet(AudioReader)]),Format=new Mp4OutputFormat({fastStart:false});
  if(!Video||!Format.getSupportedVideoCodecs().includes(Video.codec)||Audio&&Audio.codec!=='aac')throw new LocalizedError('stream_remux_codecs');
  const Start=Math.min(Video.captureTimestamp,Audio?Audio.captureTimestamp+audioShift:Infinity);
  const Timing={start:Start,audioStart:null,audioEnd:null,outputEnd:Start,copiedAudioSpans:[],epochMappings:[],trackShift:audioShift,shiftApplied:true};
  const MappingIds=new Set();let EvidenceBytes=0;
  MediaOutput=new Output({format:Format,target:destination instanceof WritableStream?new StreamTarget(destination,{chunked:true,chunkSize:RuntimePolicy.Transfer.RemuxWriteChunkBytes}):destination});
  const VideoPackets=new EncodedVideoPacketSource(Video.codec),AudioPackets=Audio&&new EncodedAudioPacketSource(Audio.codec);MediaOutput.addVideoTrack(VideoPackets);if(AudioPackets)MediaOutput.addAudioTrack(AudioPackets);
  await MediaOutput.start();
  async function Copy(Reader,First,Packets,Shift,IsAudio){
   for(let E=First;E;E=await Packet(Reader)){
    Signal.throwIfAborted();
    if(E.codec!==First.codec||E.configHash!==First.configHash){const ErrorValue=Error('stream_remux_config_change');ErrorValue.diagnostics={track:IsAudio?'audio':'video',descriptorId:E.descriptorId,initialConfigHash:First.configHash,configHash:E.configHash};throw ErrorValue;}
    await Packets.add(E.packet.clone({timestamp:E.captureTimestamp+Shift-Start}),E===First?{decoderConfig:E.config}:undefined);
    const A=E.captureTimestamp+Shift,B=A+E.packet.duration;Timing.outputEnd=Math.max(Timing.outputEnd,B);
    if(!MappingIds.has(E.mappingId)){MappingIds.add(E.mappingId);const Mapping={...E.evidence,epoch:E.epoch,track:IsAudio?'audio':'video'};EvidenceBytes+=JSON.stringify(Mapping).length;if(EvidenceBytes>CaptionPolicy.maxLedgerBytes)throw Error('caption_result_limit');Timing.epochMappings.push(Mapping);}
    if(IsAudio){Timing.audioStart=Timing.audioStart===null?A:Math.min(Timing.audioStart,A);Timing.audioEnd=Timing.audioEnd===null?B:Math.max(Timing.audioEnd,B);
     const Last=Timing.copiedAudioSpans.at(-1);if(Last&&A<=Last.end+Number.EPSILON*Math.max(1,Math.abs(A))*4)Last.end=Math.max(Last.end,B);else Timing.copiedAudioSpans.push({start:A,end:B});if(Timing.copiedAudioSpans.length>CaptionPolicy.maxWindows)throw Error('caption_result_limit');
    }
   }Packets.close();
  }
  Copies=[Copy(VideoReader,Video,VideoPackets,0,false),...(Audio?[Copy(AudioReader,Audio,AudioPackets,audioShift,true)]:[])];
  await Promise.all(Copies);Signal.throwIfAborted();await MediaOutput.finalize();return Timing;
 }catch(E){Controller.abort(E);await MediaOutput?.cancel().catch(()=>{});await Promise.allSettled(Copies);throw E;}
 finally{VideoReader?.release();AudioReader?.release();}
}
/** The caption reader and final mux share exactly the same segmented clock. */
export function CreateHlsMediaInput(Playlist,GetSegment,Signal,AudioPlaylist)
{
	const Playlists = new Map([['index.m3u8', Playlist]]);
	if (AudioPlaylist)
	{
		Playlists.set('video.m3u8', Playlist);
		Playlists.set('audio.m3u8', AudioPlaylist);
		Playlists.set('index.m3u8', '#EXTM3U\n' +
		'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n' +
		'#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO="audio"\nvideo.m3u8\n');
	}
	return new Input({
		formats: HLS_FORMATS,
		source: new CustomPathedSource('index.m3u8', async ({ path: Path, isRoot: IsRoot }) =>
		{
			Signal.throwIfAborted();
			const TextValue = Playlists.get(IsRoot ? 'index.m3u8' : Path);
			const MediaFile = TextValue === undefined ? await GetSegment(Path) : new Blob([TextValue]);
			return new BlobSource(MediaFile, { maxCacheSize: RuntimePolicy.Transfer.RemuxReadCacheBytes });
		}),
	});
}
export async function RemuxHls(Playlist, GetSegment, Destination, Signal, AudioPlaylist, AudioShift = 0)
{
	const MediaInput=CreateHlsMediaInput(Playlist,GetSegment,Signal,AudioPlaylist);
	let MediaOutput;
	let Copies = [];
	try
	{
		const Video = await MediaInput.getPrimaryVideoTrack();
		const LocalAudio = await MediaInput.getPrimaryAudioTrack();
		const Format = new Mp4OutputFormat({ fastStart: false });
		const Codec = await Video?.getCodec();
		if (!Format.getSupportedVideoCodecs().includes(Codec) || (AudioPlaylist && !LocalAudio) || (LocalAudio && await LocalAudio.getCodec() !== 'aac'))
		{
			throw new LocalizedError('stream_remux_codecs');
		}

		MediaOutput = new Output({
			// 완성 MP4를 메모리에 모두 쌓지 않고 선택한 대상으로 직접 기록합니다.
			format: Format,
			target: Destination instanceof WritableStream
			? new StreamTarget(Destination, { chunked: true, chunkSize: RuntimePolicy.Transfer.RemuxWriteChunkBytes }) : Destination,
		});
		const VideoPackets = new EncodedVideoPacketSource(Codec);
		MediaOutput.addVideoTrack(VideoPackets);
		const AudioPackets = LocalAudio && new EncodedAudioPacketSource('aac');
		if (AudioPackets)
		{
			MediaOutput.addAudioTrack(AudioPackets);
		}
		await MediaOutput.start();
		// 영상과 오디오가 공유하는 재생 시각 중 가장 빠른 값을 시작점으로 사용합니다.
		const Start = LocalAudio && AudioShift ? Math.min(await Video.getFirstTimestamp(), await LocalAudio.getFirstTimestamp() + AudioShift)
		: await MediaInput.getFirstTimestamp();
		const Timing={start:Start,audioStart:null,audioEnd:null,outputEnd:Start};
		async function CopyPackets(Track, Packets, Shift = 0)
		{
			const DecoderConfig = await Track.getDecoderConfig();
			if (!DecoderConfig)
			{
				throw new LocalizedError('stream_remux_decoder_config');
			}
			let bFirst = true;
			for await (const Packet of new EncodedPacketSink(Track).packets())
			{
				Signal.throwIfAborted();
				await Packets.add(Packet.clone({ timestamp: Packet.timestamp + Shift - Start }), bFirst ? { decoderConfig: DecoderConfig } : undefined);
				const PacketStart=Packet.timestamp+Shift,PacketEnd=PacketStart+Packet.duration;
				Timing.outputEnd=Math.max(Timing.outputEnd,PacketEnd);
				if(Packets===AudioPackets){Timing.audioStart=Timing.audioStart===null?PacketStart:Math.min(Timing.audioStart,PacketStart);Timing.audioEnd=Timing.audioEnd===null?PacketEnd:Math.max(Timing.audioEnd,PacketEnd);}
				bFirst = false;
			}
			if (bFirst)
			{
				throw new LocalizedError('stream_remux_no_packets');
			}
			Packets.close();
		}

		Copies = [CopyPackets(Video, VideoPackets)];
		if (AudioPackets)
		{
			Copies.push(CopyPackets(LocalAudio, AudioPackets, AudioShift));
		}
		await Promise.all(Copies);
		Signal.throwIfAborted();
		await MediaOutput.finalize();
		return Timing;
	}
	catch (ErrorValue)
	{
		await MediaOutput?.cancel().catch(() =>
		{
		});
		await Promise.allSettled(Copies);
		throw ErrorValue;
	}
	finally
	{
		MediaInput.dispose();
	}
}

/** Audio preparation shares the source packet clock, while the M4A itself starts at zero. */
export async function RemuxCaptionAudio(Playlist,GetSegment,Destination,Signal,VideoReference,AudioShift=0)
{
 // HLS demuxing normalizes an independent audio playlist to its own origin.
 // A tiny committed video prefix preserves the same common clock as final muxing.
 // The helper discards its video and prepares only mono audio, including leading silence.
 if(VideoReference)return {...await RemuxHls(VideoReference,GetSegment,Destination,Signal,Playlist,AudioShift),aligned:true};
 const InputMedia=new Input({formats:HLS_FORMATS,source:new CustomPathedSource('audio.m3u8',async({path,isRoot})=>new BlobSource(isRoot?new Blob([Playlist]):await GetSegment(path),{maxCacheSize:RuntimePolicy.Transfer.RemuxReadCacheBytes}))});
 return RemuxCaptionAudioInput(InputMedia,Destination,Signal);
}
export function RemuxCaptionAudioFile(File,Destination,Signal)
{
 return RemuxCaptionAudioInput(new Input({formats:ALL_FORMATS,source:new BlobSource(File,{maxCacheSize:RuntimePolicy.Transfer.RemuxReadCacheBytes})}),Destination,Signal);
}
async function RemuxCaptionAudioInput(InputMedia,Destination,Signal)
{
 let OutputMedia;
 try{
  const Track=await InputMedia.getPrimaryAudioTrack();const Codec=await Track?.getCodec();
  if(Codec!=='aac')throw new LocalizedError('stream_remux_codecs');
  OutputMedia=new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(Destination,{chunked:true,chunkSize:RuntimePolicy.Transfer.RemuxWriteChunkBytes})});
  const Source=new EncodedAudioPacketSource(Codec);OutputMedia.addAudioTrack(Source);await OutputMedia.start();
  const Sink=new EncodedPacketSink(Track),FirstPacket=await Sink.getFirstPacket();if(!FirstPacket)throw new LocalizedError('stream_remux_no_packets');
  const Start=FirstPacket.timestamp,Config=await Track.getDecoderConfig();if(!Config)throw new LocalizedError('stream_remux_decoder_config');
  let First=true;
  for await(const Packet of Sink.packets()){
   Signal.throwIfAborted();await Source.add(Packet.clone({timestamp:Packet.timestamp-Start}),First?{decoderConfig:Config}:undefined);First=false;
  }
  if(First)throw new LocalizedError('stream_remux_no_packets');
  Source.close();await OutputMedia.finalize();return {start:Start};
 }catch(E){await OutputMedia?.cancel().catch(()=>{});throw E;}finally{InputMedia.dispose();}
}
