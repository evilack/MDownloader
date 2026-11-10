import {ALL_FORMATS,BlobSource,Input,EncodedPacketSink,EncodedVideoPacketSource,EncodedAudioPacketSource,Mp4OutputFormat,Output,StreamTarget} from '../../vendor/mediabunny-1.65.2.mjs';
import {YoutubeError} from './evaluator.js';
/** Receiver endpoints may be advertised format durations. Inspect only committed
 * bytes: init metadata alone must never authorize an irreversible finish. */
export async function YoutubePrefixReady({video: VideoFile, audio: AudioFile})
{
	if (!VideoFile.size || !AudioFile.size) return false;
	const Inputs = [VideoFile, AudioFile].map(File => new Input({formats: ALL_FORMATS, source: new BlobSource(File)}));
	try
	{
		const Video = await Inputs[0].getPrimaryVideoTrack(), Audio = await Inputs[1].getPrimaryAudioTrack();
		if (!Video || !Audio || await Video.getCodec() !== 'avc' || await Audio.getCodec() !== 'aac') return false;
		const VideoSink = new EncodedPacketSink(Video), AudioSink = new EncodedPacketSink(Audio);
		const Start = Math.max(await Video.getFirstTimestamp(), await Audio.getFirstTimestamp());
		const Key = await VideoSink.getKeyPacket(Start) ?? await VideoSink.getFirstKeyPacket();
		const FirstAudio = await AudioSink.getFirstPacket();
		const LastVideo = await VideoSink.getPacket(Number.MAX_SAFE_INTEGER), LastAudio = await AudioSink.getPacket(Number.MAX_SAFE_INTEGER);
		if (!Key || !FirstAudio || !LastVideo || !LastAudio) return false;
		const End = Math.min(LastVideo.timestamp + LastVideo.duration, LastAudio.timestamp + LastAudio.duration);
		return End > Start && Key.timestamp + Key.duration <= End + 0.000001 && FirstAudio.timestamp + FirstAudio.duration <= End + 0.000001;
	}
	catch { return false; }
	finally { for (const InputValue of Inputs) InputValue.dispose(); }
}
/** 독립 fMP4 트랙을 재인코딩 없이 병합합니다. 공통으로 받은 구간 밖의 패킷은 저장하지 않습니다. */
export async function RemuxYoutubeTracks(VideoFile,AudioFile,Destination,Signal,{preserveTrackEnds:PreserveTrackEnds=false}={})
{
	const VideoInput=new Input({formats:ALL_FORMATS,source:new BlobSource(VideoFile)});
	const AudioInput=new Input({formats:ALL_FORMATS,source:new BlobSource(AudioFile)});
	let Result;let Copies=[];
	try
	{
		const Video=await VideoInput.getPrimaryVideoTrack(),Audio=await AudioInput.getPrimaryAudioTrack();
		if(!Video||!Audio||await Video.getCodec()!=='avc'||await Audio.getCodec()!=='aac')throw new YoutubeError('youtube_format_unavailable');
		const CommonStart=Math.max(await Video.getFirstTimestamp(),await Audio.getFirstTimestamp());
		const VideoSink=new EncodedPacketSink(Video);
		const Key=await VideoSink.getKeyPacket(CommonStart)??await VideoSink.getFirstKeyPacket();
		if(!Key)throw new YoutubeError('youtube_sabr_receive_failed');
		// 겹치는 구간 직전의 키프레임은 디코딩에 필요합니다. 오디오의 실제 시각 차이는 유지합니다.
		const Start=Key.timestamp;
		const End=(PreserveTrackEnds?Math.max:Math.min)(await Video.computeDuration(),await Audio.computeDuration());
		if(!(End>Start))throw new YoutubeError('youtube_sabr_receive_failed');
		Result=new Output({format:new Mp4OutputFormat({fastStart:false}),target:Destination instanceof WritableStream?new StreamTarget(Destination,{chunked:true,chunkSize:1024*1024}):Destination});
		const VideoOut=new EncodedVideoPacketSource('avc'),AudioOut=new EncodedAudioPacketSource('aac');
		Result.addVideoTrack(VideoOut);Result.addAudioTrack(AudioOut);await Result.start();
		async function Copy(Track,Sink)
		{
			const Decoder=await Track.getDecoderConfig();let Count=0,First=null,Last=null;const Spans=[];
			for await(const Packet of new EncodedPacketSink(Track).packets())
			{
				Signal.throwIfAborted();
				if(Packet.timestamp+Packet.duration>End+0.000001)continue;
				if(Packet.timestamp<Start)continue;
				await Sink.add(Packet.clone({timestamp:Packet.timestamp-Start}),Count?undefined:{decoderConfig:Decoder});Count++;
				const EndTime=Packet.timestamp+Packet.duration,Previous=Spans.at(-1);
				if(Previous&&Packet.timestamp<=Previous.end)Previous.end=Math.max(Previous.end,EndTime);else Spans.push({start:Packet.timestamp,end:EndTime});
				First=First===null?Packet.timestamp:Math.min(First,Packet.timestamp);Last=Last===null?Packet.timestamp+Packet.duration:Math.max(Last,Packet.timestamp+Packet.duration);
			}
			if(!Count)throw new YoutubeError('youtube_sabr_receive_failed');
			Sink.close();return {count:Count,start:First,end:Last,spans:Spans};
		}
		Copies=[Copy(Video,VideoOut),Copy(Audio,AudioOut)];
		const [VideoPackets,AudioPackets]=await Promise.all(Copies);await Result.finalize();
		const OutputEnd=Math.max(VideoPackets.end,AudioPackets.end);
		return {start:Start,duration:OutputEnd-Start,outputEnd:OutputEnd,audioStart:AudioPackets.start,audioEnd:AudioPackets.end,copiedAudioSpans:AudioPackets.spans,trackShift:0,shiftApplied:true,videoPackets:VideoPackets.count,audioPackets:AudioPackets.count};
	}
	catch(ErrorValue){await Result?.cancel().catch(()=>{});await Promise.allSettled(Copies);throw ErrorValue;}
	finally{VideoInput.dispose();AudioInput.dispose();}
}
