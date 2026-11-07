import {RuntimePolicy} from './runtime-policy.js';
import {LocalizedError} from './i18n.js';
import {ReadMp4Metadata} from './partial-file.js';
import {ALL_FORMATS, Input, CustomSource, EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource,
	Output, StreamTarget, Mp4OutputFormat, WebMOutputFormat, MkvOutputFormat, MovOutputFormat, Mp3OutputFormat,
	WavOutputFormat, FlacOutputFormat, OggOutputFormat, AdtsOutputFormat, MpegTsOutputFormat} from '../vendor/mediabunny-1.65.2.mjs';
const Formats = new Map([['MP4', Mp4OutputFormat], ['M4V', Mp4OutputFormat], ['M4A', Mp4OutputFormat], ['MOV', MovOutputFormat],
	['MKV', MkvOutputFormat], ['WEBM', WebMOutputFormat], ['WEBA', WebMOutputFormat], ['MP3', Mp3OutputFormat],
	['WAV', WavOutputFormat], ['FLAC', FlacOutputFormat], ['OGG', OggOutputFormat], ['OGA', OggOutputFormat], ['OPUS', OggOutputFormat], ['AAC', AdtsOutputFormat], ['TS', MpegTsOutputFormat]]);
function IsFragmented(Box)
{
	const HeaderBytes = 8;
	const View = new DataView(Box.buffer, Box.byteOffset, Box.byteLength);
	for (let Offset = View.getUint32(0) === 1 ? HeaderBytes * 2 : HeaderBytes; Offset + HeaderBytes <= Box.length; )
	{
		const Size = View.getUint32(Offset);
		if (String.fromCharCode(...Box.subarray(Offset + 4, Offset + HeaderBytes)) === 'mvex')
		{
			return true;
		}
		if (Size < HeaderBytes || Offset + Size > Box.length)
		{
			break;
		}
		Offset += Size;
	}
	return false;
}

/** 수신 범위 밖의 미디어 패킷은 읽지 않습니다. MP4의 끝에 있는 moov만 예외적으로
 * 보충하고, 완성된 패킷을 기존 코덱으로 새 컨테이너에 기록해 정상 종료합니다.
 */
export async function RemuxFilePrefix(Prefix, SourceFormat, Destination, Signal)
{
	const IsMp4 = ['MP4', 'M4V', 'M4A', 'MOV'].includes(SourceFormat);
	const Metadata = IsMp4 ? await ReadMp4Metadata(Prefix, Signal) : [];
	const NeedsFullSize = IsMp4 && !Metadata.some(Range => IsFragmented(Range.data));
	const IsPartial = Prefix.partial ?? Prefix.file.size < Prefix.total;
	const Inputs = [];
	function OpenInput()
	{
		const Missing = new Error('snapshot boundary');
		const Source = new CustomSource({getSize: () => NeedsFullSize ? Prefix.total : Prefix.file.size,
			maxCacheSize: RuntimePolicy.Transfer.RemuxReadCacheBytes, prefetchProfile: 'none',
			async read(Start, End)
			{
				Signal.throwIfAborted();
				if (End <= Prefix.file.size)
				{
					return new Uint8Array(await Prefix.file.slice(Start, End).arrayBuffer());
				}
				const Header = Metadata.find(Range => Start >= Range.start && End <= Range.start + Range.data.byteLength);
				if (Header)
				{
					return Header.data.slice(Start - Header.start, End - Header.start);
				}
				throw Missing;
			}});
		const Entry = {media: new Input({source: Source, formats: ALL_FORMATS}), missing: Missing};
		Inputs.push(Entry);
		return Entry;
	}
	const Primary = OpenInput();
	let Result;
	let Copies = [];
	try
	{
		const Video = await Primary.media.getPrimaryVideoTrack();
		let Audio = await Primary.media.getPrimaryAudioTrack();
		const AudioInput = Video && Audio ? OpenInput() : Primary;
		if (Video && Audio)
		{
			Audio = await AudioInput.media.getPrimaryAudioTrack();
		}
		const Tracks = [Video, Audio].filter(Boolean);
		const Owners = [Video && Primary, Audio && AudioInput].filter(Boolean);
		if (!Tracks.length)
		{
			throw new LocalizedError('job_snapshot_metadata');
		}
		const Codecs = await Promise.all(Tracks.map(Track => Track.getCodec()));
		const Candidates = [...new Set([Formats.get(SourceFormat), Mp4OutputFormat, WebMOutputFormat, MkvOutputFormat].filter(Boolean))];
		const Format = Candidates.map(Type => new Type()).find(Value => Codecs.every(Codec => Value.getSupportedCodecs().includes(Codec)));
		if (!Format)
		{
			throw new LocalizedError('job_snapshot_codecs');
		}
		const Configs = await Promise.all(Tracks.map(Track => Track.getDecoderConfig()));
		const Sinks = Tracks.map(Track => new EncodedPacketSink(Track));
		const First = await Promise.all(Sinks.map(Sink => Sink.getFirstPacket()));
		if (First.some(Packet => !Packet))
		{
			throw new LocalizedError('job_snapshot_unavailable');
		}
		const Start = Math.min(...First.map(Packet => Packet.timestamp));
		Result = new Output({format: Format, target: new StreamTarget(Destination, {chunked: true, chunkSize: RuntimePolicy.Transfer.RemuxWriteChunkBytes})});
		const Outputs = Tracks.map((Track, Index) =>
		{
			const OutputTrack = Track.type === 'video' ? new EncodedVideoPacketSource(Codecs[Index]) : new EncodedAudioPacketSource(Codecs[Index]);
			if (Track.type === 'video')
			{
				Result.addVideoTrack(OutputTrack);
			}
			else
			{
				Result.addAudioTrack(OutputTrack);
			}
			return OutputTrack;
		});
		await Result.start();
		// 각 트랙에 독립 입력을 사용해 영상의 경계 도달이 오디오 읽기를 중단하지
		// 않게 합니다. 두 트랙을 함께 전달하여 출력의 과도한 대기 버퍼도 피합니다.
		Copies = Tracks.map(async (_, Index) =>
		{
			let Packet = First[Index], IsFirst = true;
			while (Packet)
			{
				Signal.throwIfAborted();
				await Outputs[Index].add(Packet.clone({timestamp: Packet.timestamp - Start}), IsFirst ? {decoderConfig: Configs[Index]} : undefined);
				IsFirst = false;
				try
				{
					Packet = await Sinks[Index].getNextPacket(Packet);
				}
				catch (ErrorValue)
				{
					Signal.throwIfAborted();
					// 일부 컨테이너는 잘린 마지막 패킷을 EOF 오류로 알립니다. 이미 읽은
					// 완성 패킷까지만 저장하고, 완성 원본의 오류는 그대로 전달합니다.
					if (ErrorValue !== Owners[Index].missing && !IsPartial)
					{
						throw ErrorValue;
					}
					break;
				}
			}
			Outputs[Index].close();
		});
		await Promise.all(Copies);
		await Result.finalize();
		return {extension: Format.fileExtension, mimeType: Format.mimeType};
	}
	catch (ErrorValue)
	{
		await Result?.cancel().catch(() =>
		{
		});
		await Promise.allSettled(Copies);
		if (Inputs.some(Entry => ErrorValue === Entry.missing))
		{
			throw new LocalizedError('job_snapshot_metadata');
		}
		throw ErrorValue;
	}
	finally
	{
		for (const Entry of Inputs)
		{
			Entry.media.dispose();
		}
	}
}
