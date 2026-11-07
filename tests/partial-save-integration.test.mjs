import {WriteMediaArtifact} from './helpers/media-artifacts.mjs';
import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile as ReadFile} from 'node:fs/promises';
import {DownloadTracks, LocalPlaylist} from '../extension/lib/stream-transfer.js';
import {ParseMediaPlaylist} from '../extension/lib/hls.js';
import {RemuxHls} from '../extension/lib/hls-remux.js';
import {StreamPreview} from '../extension/lib/stream-preview.js';
import {RemuxFilePrefix} from '../extension/lib/partial-remux.js';
import {ALL_FORMATS, Input, BufferSource, BlobSource, Output, BufferTarget, Mp4OutputFormat, EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource} from '../extension/vendor/mediabunny-1.65.2.mjs';
for (const bEncrypted of [false, true])
{
	for (const bStop of [false, true])
	{
		Test((bEncrypted ? 'AES-128 encrypted' : 'clear') + ' real fMP4 partial export retains audio/video and then ' + (bStop ? 'stops and saves' : 'finishes'), async T =>
		{
			const Source = new Input({source: new BufferSource(await ReadFile(new URL('../website/sample/media/sample-film.mp4', import.meta.url))), formats: ALL_FORMATS});
			const Target = new BufferTarget();
			const output = new Output({format: new Mp4OutputFormat({fastStart: 'fragmented', minimumFragmentDuration: 2}), target: Target});
			const Tracks = [await Source.getPrimaryVideoTrack(), await Source.getPrimaryAudioTrack()];
			const Streams = await Promise.all(Tracks.map(async Track =>
			{
				const Stream = Track.type === 'video' ? new EncodedVideoPacketSource(await Track.getCodec()): new EncodedAudioPacketSource(await Track.getCodec());
				if (Track.type === 'video')
				{
					output.addVideoTrack(Stream);
				}
				else
				{
					output.addAudioTrack(Stream);
				}
				return Stream;
			}));
			await output.start();
			await Promise.all(Tracks.map(async(Track, I) =>
			{
				let bFirst = true;
				for await(const Packet of new EncodedPacketSink(Track).packets())
				{
					await Streams[I].add(Packet, bFirst ? {decoderConfig: await Track.getDecoderConfig()}: undefined);
					bFirst = false;
				}Streams[I].close();
			}));
			await output.finalize();
			Source.dispose();
			const Bytes = new Uint8Array(Target.buffer), View = new DataView(Bytes.buffer), Groups = [];
			let InitEnd = 0;
			const DirectChunks = [];
			await RemuxFilePrefix({file: new Blob([Bytes.slice(0, 120000)]), total: Bytes.length}, 'MP4', new WritableStream({write(Chunk)
				{
					DirectChunks.push(Chunk);
				}}), new AbortController().signal);
			const Direct = new Uint8Array(Math.max(...DirectChunks.map(C => C.position + C.data.length)));
			for (const C of DirectChunks)
			{
				Direct.set(C.data, C.position);
			}
			const DirectInput = new Input({source: new BufferSource(Direct), formats: ALL_FORMATS});
			Assert.ok(await DirectInput.computeDuration() > 1);
			Assert.ok(await DirectInput.computeDuration() < 10);
			Assert.equal((await DirectInput.getTracks()).length, 2);
			DirectInput.dispose();
			for (let P = 0; P + 8 <= Bytes.length; )
			{
				const Size = View.getUint32(P), Type = String.fromCharCode(...Bytes.slice(P + 4, P + 8));
				if (Type === 'moov')
				{
					InitEnd = P + Size;
				}
				if (Type === 'moof')
				{
					Groups.push({start: P, end: 0});
				}
				if (Type === 'mdat')
				{
					Groups.at(-1).end = P + Size;
				}
				P += Size;
			}
			const Media = new Map([['init.mp4', Bytes.slice(0, InitEnd)], ...Groups.map((G, I) => ['part' + I + '.m4s', Bytes.slice(G.start, G.end)])]);
			const Address = 'https://fixture.test/index.m3u8';
			const EncryptionTag = bEncrypted ? '#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x7\n' : '';
			const Playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n' + EncryptionTag + '#EXT-X-MAP:URI="init.mp4"\n' + Groups.map((_, I) => '#EXTINF:4,\npart' + I + '.m4s\n').join('') + '#EXT-X-ENDLIST\n';
			if (bEncrypted)
			{
				const Raw = crypto.getRandomValues(new Uint8Array(16));
				const Key = await crypto.subtle.importKey('raw', Raw, 'AES-CBC', false, ['encrypt']);
				const Iv = new Uint8Array(16);
				Iv[15] = 7;
				for (const [Name, Plain] of Media)
				{
					Media.set(Name, new Uint8Array(await crypto.subtle.encrypt({name: 'AES-CBC', iv: Iv}, Key, Plain)));
				}
				Media.set('key', Raw);
			}
			const Later = Promise.withResolvers();
			T.mock.method(globalThis, 'fetch', async Url =>
			{
				const Name = new URL(Url).pathname.slice(1);
				if (Name === 'index.m3u8')
				{
					return new Response(Playlist);
				}
				if (Name.startsWith('part') && Name !== 'part0.m4s')
				{
					await Later.promise;
				}
				return new Response(Media.get(Name));
			});
			const Files = new Map();
			const Workspace = {getFileHandle: async Path => ({getFile: async() => Files.get(Path), createWritable: async() =>
					{
						const Chunks = [];
						return{write: async B => Chunks.push(new Uint8Array(B)), close: async() => Files.set(Path, new Blob(Chunks)), abort: async() => Files.delete(Path)};
					}})};
			const Controller = new AbortController(), Finish = new AbortController();
			let Read, Snapshot, Partial;
			const Result = await DownloadTracks([{url: Address, playlist: ParseMediaPlaylist(Playlist, Address)}], {workspace: Workspace, controller: Controller, finishSignal: Finish.signal, observedContext: bStop, authorize: async() =>
				{
				}, snapshot: Value =>
				{
					Read = Value;
				}, progress: async() =>
				{
					if (Snapshot || !Read())
					{
						return;
					}
					Snapshot = Read();
					const Dest = new BufferTarget();
					await RemuxHls(LocalPlaylist(Snapshot.video), Path => Files.get(Path), Dest, Controller.signal);
					Partial = Dest.buffer;
					Assert.equal(Controller.signal.aborted, false);
					Assert.equal(Finish.signal.aborted, false);
					if (bStop)
					{
						Finish.abort();
					}
					Later.resolve();
				}});
			Assert.equal(Snapshot.video.length, 1);
			Assert.equal(Read().video.length, Result.progress.finished);
			if (bStop)
			{
				Assert.equal(Result.partial, true);
				Assert.ok(Result.progress.finished < Groups.length);
				Assert.equal(Controller.signal.aborted, false);
			}
			else
			{
				Assert.equal(Result.progress.finished, Groups.length);
			}
			const Final = new BufferTarget();
			await RemuxHls(Result.video, Path => Files.get(Path), Final, Controller.signal);
			async function Inspect(Buffer)
			{
				const input = new Input({source: new BlobSource(new Blob([Buffer])), formats: ALL_FORMATS});
				try
				{
					return{duration: await input.computeDuration(), tracks: await input.getTracks()};
				}
				finally
				{
					input.dispose();
				}
			}
			const PartialInfo = await Inspect(Partial), FinalInfo = await Inspect(Final.buffer);
			const FullInfo = await Inspect(Target.buffer);
			Assert.equal(PartialInfo.tracks.length, 2);
			Assert.ok(PartialInfo.duration > 1);
			Assert.ok(bStop ? FinalInfo.duration >= PartialInfo.duration : FinalInfo.duration > PartialInfo.duration);
			Assert.ok(bStop ? FinalInfo.duration < FullInfo.duration : FinalInfo.duration > 9);
			const PreviousChrome = globalThis.chrome;
			globalThis.chrome = {permissions: {contains: async () => true}};
			T.after(() =>
			{
				if (PreviousChrome === undefined)
				{
					delete globalThis.chrome;
				}
				else
				{
					globalThis.chrome = PreviousChrome;
				}
			});
			const Preview = await StreamPreview({url: Address, format: 'HLS'}, Controller.signal);
			const PreviewInfo = await Inspect(await Preview.arrayBuffer());
			Assert.equal(PreviewInfo.tracks.length, 2);
			Assert.ok(PreviewInfo.duration > 1);
			await WriteMediaArtifact('stream-partial.mp4', new Uint8Array(Partial));
			await WriteMediaArtifact(bStop ? 'stream-stopped-' + (bEncrypted ? 'encrypted' : 'clear') + '.mp4' : 'stream-final.mp4', new Uint8Array(Final.buffer));
			await WriteMediaArtifact('direct-fmp4-partial.mp4', Direct);
		});
	}
}
