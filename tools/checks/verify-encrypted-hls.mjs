/** 외부 HLS의 암호화 전송과 MP4 재포장을 실제 모듈로 검증합니다. 키·주소 원문은 보고서에 저장하지 않습니다. */
import {mkdir as Mkdir, open as Open, rm as Remove, writeFile as WriteFile} from 'node:fs/promises';
import {openAsBlob as OpenAsBlob} from 'node:fs';
import Path from 'node:path';
import {ArtifactPath} from '../lib/tool-config.mjs';
import {ParseMediaPlaylist} from '../../extension/lib/hls.js';
import {ReadPlaylist} from '../../extension/lib/hls-http.js';
import {DownloadTracks} from '../../extension/lib/stream-transfer.js';
import {RemuxHls} from '../../extension/lib/hls-remux.js';
import {ALL_FORMATS, BlobSource, EncodedPacketSink, Input} from '../../extension/vendor/mediabunny-1.65.2.mjs';
const Address = process.argv[2];
const Url = new URL(Address);
if (!['http:', 'https:'].includes(Url.protocol) || Url.username || Url.password)
{
	throw new Error('Provide an HTTP(S) media playlist URL.');
}
const bFull = process.argv.includes('--full');
const Signal = new AbortController().signal;
const Playlist = ParseMediaPlaylist(await ReadPlaylist(Address, Signal), Address);
if (!Playlist.ended)
{
	throw new Error('This check requires a finite VOD playlist.');
}
const Directory = ArtifactPath('encrypted-hls-' + crypto.randomUUID().slice(0, 8));
await Mkdir(Directory, {recursive: true});
const Scratch = Path.join(Directory, 'segments');
await Mkdir(Scratch);
const Workspace = {async getFileHandle(Name)
	{
		const Filename = Path.join(Scratch, Name);
		return {async createWritable()
			{
				const Handle = await Open(Filename, 'w');
				return {write: Bytes => Handle.writeFile(Bytes), close: () => Handle.close(), async abort()
					{
						await Handle.close();
						await Remove(Filename, {force: true});
					}};
			}};
	}};
let NextReport = 0;
const Started = performance.now();
const Result = await DownloadTracks([{url: Address, playlist: {...Playlist, segments: bFull ? Playlist.segments : Playlist.segments.slice(0, 3)}}], {
	workspace: Workspace, controller: new AbortController(), finishSignal: Signal, authorize: async () =>
	{
	},
	progress: async State =>
	{
		if (performance.now() >= NextReport)
		{
			NextReport = performance.now() + 15000;
			console.log(JSON.stringify({finished: State.finished, count: State.count, bytes: State.received}));
		}
	},
});
const OutputPath = Path.join(Directory, 'output.mp4');
const File = await Open(OutputPath, 'w');
try
{
	await RemuxHls(Result.video, Name => OpenAsBlob(Path.join(Scratch, Name)), new WritableStream({async write(Chunk)
		{
			let Offset = 0;
			while (Offset < Chunk.data.byteLength)
			{
				const {bytesWritten: Written} = await File.write(Chunk.data, Offset, Chunk.data.byteLength - Offset, Chunk.position + Offset);
				if (!Written)
				{
					throw new Error('Output write made no progress.');
				}
				Offset += Written;
			}
		}}), Signal);
}
finally
{
	await File.close();
}
const Media = new Input({source: new BlobSource(await OpenAsBlob(OutputPath), {maxCacheSize: 1024 * 1024}), formats: ALL_FORMATS});
try
{
	const Tracks = await Media.getTracks();
	const TrackInfo = [];
	for (const Track of Tracks)
	{
		let Packets = 0;
		for await (const Packet of new EncodedPacketSink(Track).packets())
		{
			Packets++;
		}
		TrackInfo.push({type: Track.type, codec: await Track.getCodec(), packets: Packets});
	}
	const Report = {full: bFull, sourceSegments: Playlist.segments.length, finished: Result.progress.finished,
		bytes: Result.progress.received, duration: await Media.computeDuration(), tracks: TrackInfo,
		elapsedSeconds: Math.round((performance.now() - Started) / 1000)};
	if (!TrackInfo.some(Track => Track.type === 'video' && Track.packets > 0) || !Report.duration)
	{
		throw new Error('The remuxed file has no usable video packets.');
	}
	await WriteFile(Path.join(Directory, 'report.json'), JSON.stringify(Report, null, 2) + '\n');
	// 이 실행이 새로 만든 하위 디렉터리인지 확인한 뒤 중복 임시 조각만 제거합니다.
	const ResolvedScratch = Path.resolve(Scratch);
	if (Path.dirname(ResolvedScratch) !== Path.resolve(Directory) || Path.basename(ResolvedScratch) !== 'segments')
	{
		throw new Error('Unexpected scratch directory.');
	}
	await Remove(ResolvedScratch, {recursive: true});
	console.log(JSON.stringify({...Report, directory: Directory}));
}
finally
{
	Media.dispose();
}
