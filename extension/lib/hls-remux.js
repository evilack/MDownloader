/**
 * 다운로드한 조각을 Mediabunny에 전달해 원본 코덱으로 MP4를 만듭니다. 영상과 오디오 시각의 기준을 맞추며 선택한 출력 대상으로 직접 씁니다.
 */
import { LocalizedError } from './i18n.js';
import { RuntimePolicy } from './runtime-policy.js';
import {
	BlobSource, CustomPathedSource, EncodedAudioPacketSource, EncodedPacketSink,
	EncodedVideoPacketSource, HLS_FORMATS, Input, Mp4OutputFormat, Output, StreamTarget,
} from '../vendor/mediabunny-1.65.2.mjs';
export async function RemuxHls(Playlist, GetSegment, Destination, Signal, AudioPlaylist, AudioShift = 0)
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
	const MediaInput = new Input({
		formats: HLS_FORMATS,
		source: new CustomPathedSource('index.m3u8', async ({ path: Path, isRoot: IsRoot }) =>
		{
			Signal.throwIfAborted();
			const TextValue = Playlists.get(IsRoot ? 'index.m3u8' : Path);
			const MediaFile = TextValue === undefined ? await GetSegment(Path) : new Blob([TextValue]);
			return new BlobSource(MediaFile, { maxCacheSize: RuntimePolicy.Transfer.RemuxReadCacheBytes });
		}),
	});
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
