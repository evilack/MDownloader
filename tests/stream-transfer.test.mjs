import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { ParseMediaPlaylist } from '../extension/lib/hls.js';
import { DownloadTracks } from '../extension/lib/stream-transfer.js';
const Address = 'https://video.test/live.m3u8';
const Playlist = (Sequence, ...Parts) => '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:' +
Sequence + '\n' + Parts.map(Part => '#EXTINF:1,\n' + Part + '\n').join('');
function Workspace()
{
	const Files = new Map();
	return { files: Files, async getFileHandle(Path)
		{
			return { async createWritable()
				{
					let Content = new Uint8Array();
					return {
						async write(Bytes)
						{
							const Next = new Uint8Array(Content.length + Bytes.length);
							Next.set(Content);
							Next.set(Bytes, Content.length);
							Content = Next;
							Files.set(Path, Content);
						},
						async close()
						{
						},
						async abort()
						{
							Files.delete(Path);
						},
					};
				} };
		} };
}

Test('records new live sequences once and seals a finite playlist on stop', async T =>
{
	const Requests = [];
	const Stop = new AbortController();
	const Ts = new Uint8Array(376);
	Ts[0] = Ts[188] = 0x47;
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Requests.push(new URL(Url).pathname);
		if (Url === Address)
		{
			return new Response(Playlist(10, 'a.ts', 'b.ts'));
		}
		return new Response(new ReadableStream({
			start(Stream)
			{
				// 앞 패킷 일부가 남은 청크 안에 두 번째 패킷의 동기 바이트가 오도록 구성합니다.
				Stream.enqueue(Ts.subarray(0, 100));
				Stream.enqueue(Ts.subarray(100));
				Stream.close();
			},
		}));
	});
	const Target = Workspace();
	const Result = await DownloadTracks([{ url: Address, playlist: ParseMediaPlaylist(Playlist(10, 'a.ts'), Address) }], {
		workspace: Target, controller: new AbortController(), finishSignal: Stop.signal,
		async authorize()
		{
		},
		async progress({ finished: Finished })
		{
			if (Finished === 2)
			{
				Stop.abort();
			}
		},
	});
	Assert.deepEqual(Requests, ['/a.ts', '/live.m3u8', '/b.ts']);
	Assert.equal(Target.files.size, 2);
	Assert.match(Result.video, /segment-0\.ts\n#EXTINF:1,\nsegment-1\.ts\n#EXT-X-ENDLIST\n$/);
	Assert.deepEqual(Result.progress, { live: false, count: 2, received: 752, finished: 2 });
});
Test('reports partial segment bytes without advancing the finished segment count', async T =>
{
	let Now = 0;
	T.mock.method(performance, 'now', () => Now);
	const Packet = new Uint8Array(188);
	Packet[0] = 0x47;
	T.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
		start(Stream)
		{
			Stream.enqueue(Packet);
			Stream.enqueue(Packet);
			Stream.close();
		},
	})));
	const Target = { async getFileHandle()
		{
			return { async createWritable()
				{
					return { async write()
						{
							Now += 800;
						}, async close()
						{
						}, async abort()
						{
						} };
				} };
		} };
	const Progress = [];
	const List = ParseMediaPlaylist(Playlist(0, 'a.ts') + '#EXT-X-ENDLIST\n', Address);
	const Result = await DownloadTracks([{ playlist: List }], {
		workspace: Target, controller: new AbortController(), finishSignal: new AbortController().signal,
		async authorize()
		{
		}, async progress(Snapshot)
		{
			Progress.push(Snapshot);
		},
	});
	Assert.ok(Progress.some(Snapshot => Snapshot.received === 188 && Snapshot.finished === 0));
	Assert.deepEqual(Result.progress, { live: false, count: 1, received: 376, finished: 1 });
});
Test('saves ranged initialization once and resolves each media range separately', async T =>
{
	const RequestedRanges = [];
	const Previews = [];
	T.mock.method(globalThis, 'fetch', async (_url, Options) =>
	{
		const Range = Options.headers.Range;
		RequestedRanges.push(Range);
		return new Response(new Uint8Array(2), { status: 206,
			headers: { 'Content-Range': Range.replace('=', ' ') + '/6' } });
	});
	const Url = new URL('combined.mp4', Address).href;
	const Init = { url: Url, range: { start: 0, end: 1 } };
	const Target = Workspace();
	const Result = await DownloadTracks([{ playlist: { ended: true, segments: [
					{ url: Url, init: Init, range: { start: 2, end: 3 }, sequence: 0, duration: 1 },
					{ url: Url, init: Init, range: { start: 4, end: 5 }, sequence: 1, duration: 1 },
				] } }], {
		workspace: Target, controller: new AbortController(), finishSignal: new AbortController().signal,
		async authorize()
		{
		}, async progress()
		{
		},
		preview(Sample)
		{
			Assert.ok(Target.files.has('init-0.mp4'));
			Assert.ok(Target.files.has('segment-0.m4s'));
			Previews.push(Sample);
		},
	});
	Assert.deepEqual(RequestedRanges.sort(), ['bytes=0-1', 'bytes=2-3', 'bytes=4-5']);
	Assert.deepEqual([...Target.files.keys()].sort(), ['init-0.mp4', 'segment-0.m4s', 'segment-1.m4s']);
	Assert.equal(Result.video.match(/#EXT-X-MAP:/g).length, 1);
	Assert.equal(Result.progress.finished, 2);
	Assert.equal(Previews.length, 1);
	Assert.match(Previews[0], /#EXT-X-MAP:URI="init-0\.mp4"\n#EXTINF:1,\nsegment-0\.m4s\n#EXT-X-ENDLIST/);
});
Test('writes each completed LL-HLS group once by concatenating its actual parts', async T =>
{
	const Requests = [];
	const Stop = new AbortController();
	const Text = Sequence => '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:5\n#EXT-X-MAP:URI="init.mp4"\n' +
	Array.from({ length: Sequence }, (_, I) => '#EXT-X-PART:DURATION=0.5,URI="a' + I + '.mp4"\n' +
	'#EXT-X-PART:DURATION=0.5,URI="b' + I + '.mp4"\n#EXTINF:1,\nwhole.mp4\n').join('');
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Requests.push(new URL(Url).pathname);
		return new Response(Url === Address ? Text(2) : new Uint8Array([1, 2]));
	});
	const Target = Workspace();
	const Result = await DownloadTracks([{ url: Address, playlist: ParseMediaPlaylist(Text(1), Address) }], {
		workspace: Target, controller: new AbortController(), finishSignal: Stop.signal,
		async authorize()
		{
		}, async progress({ finished: Finished })
		{
			if (Finished === 2)
			{
				Stop.abort();
			}
		},
	});
	Assert.deepEqual(Requests, ['/init.mp4', '/a0.mp4', '/b0.mp4', '/live.m3u8', '/a1.mp4', '/b1.mp4']);
	Assert.equal(Result.progress.finished, 2);
	Assert.equal(Target.files.get('segment-0.m4s').byteLength, 4);
});
