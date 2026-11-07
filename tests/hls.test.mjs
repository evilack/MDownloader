import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { ParseMaster, ParseMediaPlaylist, ParseVod, ReadHlsMediaResources } from '../extension/lib/hls.js';
import { TransferSegments } from '../extension/lib/segment-transfer.js';
Test('accepts in-band VIDEO group labels while rejecting a separately addressed video rendition', () =>
{
	const Source = '#EXTM3U\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="main",NAME="1080p60",DEFAULT=YES\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.4D402A,mp4a.40.2",VIDEO="main"\nhigh.m3u8\n';
	Assert.equal(ParseMaster(Source, 'https://cdn.test/master.m3u8')[0].resolution, '1920x1080');
	Assert.throws(() => ParseMaster(Source.replace('DEFAULT=YES', 'DEFAULT=YES,URI="separate.m3u8"'), 'https://cdn.test/master.m3u8'));
});
Test('offers only usable master variants and resolves signed relative URLs', () =>
{
	const Master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="alt",NAME="English",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
low/index.m3u8?token=a%2Bb
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO="alt"
external.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="hvc1.1.6.L93.B0"
hevc.m3u8`;
	const Base = 'https://cdn.test/hls/master.m3u8';
	Assert.deepEqual(ParseMaster(Master, Base), [
		{ url: 'https://cdn.test/hls/low/index.m3u8?token=a%2Bb', bandwidth: 900000, resolution: '640x360' },
		{ url: 'https://cdn.test/hls/high.m3u8', bandwidth: 2000000, resolution: '1280x720' },
		{ url: 'https://cdn.test/hls/external.m3u8', bandwidth: 3000000, resolution: '', audioUrl: 'https://cdn.test/hls/audio.m3u8' },
	]);
	Assert.throws(() => ParseMaster(Master.replace('high.m3u8', ''), Base));
	Assert.deepEqual(ParseMaster(Master + '\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key"', Base), ParseMaster(Master, Base));
	Assert.throws(() => ParseMaster(Master + '\n#EXT-X-ENDLIST', Base));
});
Test('accepts TS VOD playlists and rejects unsupported encryption, master and live input', () =>
{
	const Playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\npart.ts?key=a%2Bb\n#EXT-X-ENDLIST';
	const Parsed = ParseVod(Playlist, 'https://cdn.test/abc/stream.m3u8');
	Assert.deepEqual(Parsed.urls, ['https://cdn.test/abc/part.ts?key=a%2Bb']);
	Assert.match(Parsed.local, /segment-0\.ts/);
	for (const Tag of ['#EXT-X-KEY:METHOD=UNKNOWN,URI="key"', '#EXT-X-STREAM-INF:BANDWIDTH=100', '#EXT-X-MAP:URI="init"'])
	{
		Assert.throws(() => ParseVod(Playlist.replace('#EXTINF', Tag + '\n#EXTINF'), Parsed.urls[0]));
	}
	Assert.throws(() => ParseVod(Playlist.replace('#EXT-X-ENDLIST', ''), Parsed.urls[0]));
});
Test('chooses the playable default audio rendition before the first fallback', () =>
{
	const Master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="alt",NAME="French",URI="fallback.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="alt",NAME="English",DEFAULT=YES,URI="audio/main.m3u8?t=a%2Bb"
#EXT-X-STREAM-INF:BANDWIDTH=3000000,AUDIO="alt",CODECS="avc1.4d401e,mp4a.40.2"
external.m3u8`;
	const Base = 'https://cdn.test/hls/master.m3u8';
	Assert.equal(ParseMaster(Master, Base)[0].audioUrl, 'https://cdn.test/hls/audio/main.m3u8?t=a%2Bb');
	Assert.equal(ParseMaster(Master.replace('audio/main.m3u8?t=a%2Bb', 'data:,unsafe'), Base)[0].audioUrl,
	'https://cdn.test/hls/fallback.m3u8');
	Assert.throws(() => ParseMaster(Master.replace('AUDIO="alt"', 'AUDIO="missing"'), Base), { key: 'stream_hls_no_variants' });
	Assert.throws(() => ParseMaster(Master, Base, { allowSeparateAudio: false }), { key: 'stream_hls_no_variants' });
	const Muxed = Master.replace(',URI="fallback.m3u8"', '');
	Assert.equal(ParseMaster(Muxed, Base, { allowSeparateAudio: false })[0].audioUrl, undefined);
	Assert.equal(ParseMaster(Muxed.replace(',URI="audio/main.m3u8?t=a%2Bb"', ''), Base)[0].audioUrl, undefined);
});
Test('reads live sequence numbers, map changes, discontinuities and inclusive byte ranges', () =>
{
	const Playlist = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:73
#EXT-X-DISCONTINUITY-SEQUENCE:4
#EXT-X-MAP:URI="stream.mp4?token=a%2Bb",BYTERANGE="20@0"
#EXTINF:5.75,
#EXT-X-BYTERANGE:80@20
stream.mp4?token=a%2Bb
#EXTINF:5,
#EXT-X-BYTERANGE:100
./stream.mp4?token=a%2Bb
#EXT-X-DISCONTINUITY
#EXT-X-MAP:URI="init2.mp4"
#EXTINF:6,
part2.m4s
#EXTINF:6,
part3.m4s
#EXT-X-PART:DURATION=0.3,URI="next.m4s"`;
	const Base = 'https://cdn.test/live/index.m3u8';
	const Url = 'https://cdn.test/live/stream.mp4?token=a%2Bb';
	const Init = { url: Url, range: { start: 0, end: 19 } };
	const NextInit = { url: 'https://cdn.test/live/init2.mp4' };
	Assert.deepEqual(ParseMediaPlaylist(Playlist, Base), {
		segments: [
			{ url: Url, duration: 5.75, sequence: 73, init: Init, range: { start: 20, end: 99 } },
			{ url: Url, duration: 5, sequence: 74, init: Init, range: { start: 100, end: 199 } },
			{ url: 'https://cdn.test/live/part2.m4s', duration: 6, sequence: 75, init: NextInit, discontinuity: true },
			{ url: 'https://cdn.test/live/part3.m4s', duration: 6, sequence: 76, init: NextInit },
		],
		targetDuration: 6,
		ended: false,
	});
});
Test('reads ended media with the default sequence number and no initialization section', () =>
{
	const Playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\npart.ts\n#EXT-X-ENDLIST';
	const Base = 'https://cdn.test/vod/index.m3u8';
	Assert.deepEqual(ParseMediaPlaylist(Playlist, Base), {
		segments: [{ url: 'https://cdn.test/vod/part.ts', duration: 4, sequence: 0 }],
		ended: true,
		targetDuration: 4,
	});
});
Test('rejects ranges with invalid sizes or ambiguous implicit offsets', () =>
{
	const Base = 'https://cdn.test/live/index.m3u8';
	const Prefix = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n';
	for (const Contents of [
		'#EXTINF:4,\n#EXT-X-BYTERANGE:3\nstream.mp4',
		'#EXTINF:4,\n#EXT-X-BYTERANGE:0@0\nstream.mp4',
		'#EXTINF:4,\n#EXT-X-BYTERANGE:3@9007199254740991\nstream.mp4',
		'#EXTINF:4,\n#EXT-X-BYTERANGE:3@0\nstream.mp4\n#EXTINF:4,\n#EXT-X-BYTERANGE:3\ndifferent.mp4',
		'#EXTINF:4,\nstream.mp4\n#EXTINF:4,\n#EXT-X-BYTERANGE:3\nstream.mp4',
		'#EXT-X-MAP:URI="stream.mp4",BYTERANGE="3"\n#EXTINF:4,\nstream.mp4',
	])
	{
		Assert.throws(() => ParseMediaPlaylist(Prefix + Contents, Base), Error =>
		['stream_hls_invalid_byte_range', 'stream_hls_duplicate_byte_range'].includes(Error.key));
	}
});
Test('rejects unsupported encryption, partial-only and delta playlists before they can supply downloads', () =>
{
	const Base = 'https://cdn.test/live/index.m3u8';
	const Prefix = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n';
	for (const Tag of [
		'#EXT-X-KEY:METHOD=UNKNOWN,URI="key"',
		'#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery",URI="skd://license"',
		'#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,URI="key"',
	])
	{
		Assert.throws(() => ParseMediaPlaylist(`${Prefix}${Tag}\n#EXTINF:4,\nsegment.ts`, Base), { key: 'stream_hls_encrypted' });
	}
	Assert.throws(() => ParseMediaPlaylist(`${Prefix}#EXT-X-PART:DURATION=0.3,URI="part.m4s"`, Base), { key: 'stream_hls_partial_only' });
	Assert.throws(() => ParseMediaPlaylist(`${Prefix}#EXT-X-SKIP:SKIPPED-SEGMENTS=3\n#EXTINF:4,\nsegment.ts`, Base), { key: 'stream_hls_unsupported_media' });
});
Test('caps segment fetches at four and retries only the failed segment', async () =>
{
	const Urls = Array.from({ length: 9 }, (_, I) => String(I));
	const Attempts = Array(9).fill(0);
	let Active = 0;
	let Peak = 0;
	const Stored = [];
	const Abort = new AbortController();
	await TransferSegments(Urls, Abort, async (_url, Index) =>
	{
		Attempts[Index]++;
		Peak = Math.max(Peak, ++Active);
		await new Promise(Resolve => setTimeout(Resolve, 5));
		Active--;
		if (Index === 2 && Attempts[Index] === 1)
		{
			throw new TypeError('network');
		}
		Stored[Index] = Index;
	});
	Assert.equal(Peak, 4);
	Assert.deepEqual(Stored, Urls.map(Number));
	Assert.deepEqual(Attempts, [1, 1, 2, 1, 1, 1, 1, 1, 1]);
});
Test('groups completed low-latency parts and leaves unfinished parts for the next refresh', () =>
{
	const Base = 'https://cdn.test/channel/live.m3u8?signature=keep';
	const Text = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:5\n' +
	'#EXT-X-MAP:URI="init.mp4"\n' +
	'#EXT-X-PART:DURATION=1,URI="first.mp4"\n' +
	'#EXT-X-PART:DURATION=1,URI="second.mp4"\n' +
	'#EXTINF:2,\nmedia.mp4\n#EXT-X-PART:DURATION=1,URI="pending.mp4"\n';
	const Parsed = ParseMediaPlaylist(Text, Base);
	Assert.equal(Parsed.segments.length, 1);
	Assert.equal(Parsed.segments[0].sequence, 5);
	Assert.deepEqual(Parsed.segments[0].parts.map(Part => Part.url), [
		'https://cdn.test/channel/first.mp4', 'https://cdn.test/channel/second.mp4',
	]);
	const Resources = ReadHlsMediaResources(Text, Base);
	Assert.ok(Resources.includes('https://cdn.test/channel/first.mp4'));
	Assert.ok(Resources.includes('https://cdn.test/channel/second.mp4'));
});
Test('does not treat proprietary transformed URL metadata as directly downloadable media', () =>
{
	Assert.throws(() => ParseMediaPlaylist('#EXTM3U\n#EXT-X-MOUFLON:PSCH:v2:metadata\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nmedia.mp4',
	'https://cdn.test/live.m3u8'), { key: 'stream_hls_unsupported_media' });
});
Test('accepts AV1 renditions for the MP4 remuxer', () =>
{
	const List = ParseMaster('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="av01.0.05M.08,mp4a.40.2"\nvideo.m3u8', 'https://cdn.test/master.m3u8');
	Assert.equal(List[0].url, 'https://cdn.test/video.m3u8');
});
