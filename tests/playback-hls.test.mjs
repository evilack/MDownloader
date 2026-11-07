import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { PlaybackHls } from '../extension/lib/playback-hls.js';
const Master = 'https://player.test/video.m3u8';
const Variant = 'https://cdn.test/variant.m3u8';
const First = 'https://cdn.test/first.jpeg';
const Second = 'https://cdn.test/second.jpeg';
const Ts = new Uint8Array(376);
Ts[0] = Ts[188] = 0x47;
const Segment = Buffer.from(Ts).toString('base64');
function Request(Url, Body, { status: Status = 200, method: Method = 'GET', encoding: Encoding = '', read: Read = () =>
	{
	} } = {})
{
	return {
		request: { url: Url, method: Method },
		response: { status: Status, content: {} },
		getContent(Callback)
		{
			Read();
			Callback(Body, Encoding);
		},
	};
}

Test('captures only full responses linked to the exact playlist and waits for complete coverage', async () =>
{
	const Saved = new Map();
	const Capture = new PlaybackHls(Master, async (Name, Bytes) => Saved.set(Name, Bytes));
	const Unexpected = () => Assert.fail('Unrelated or denied response was read');
	await Capture.Accept(Request(Master + '?other', '', { read: Unexpected }));
	await Capture.Accept(Request(Master, '', { status: 403, read: Unexpected }));
	await Capture.Accept(Request(Master, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n' + Variant));
	await Capture.Accept(Request(Variant, '#EXTM3U\n#EXTINF:4,\nfirst.jpeg\n#EXTINF:4,\nsecond.jpeg\n#EXT-X-ENDLIST'));
	await Capture.Accept(Request(First, Segment, { encoding: 'base64', status: 206, read: Unexpected }));
	await Capture.Accept(Request(First, Segment, { encoding: 'base64', method: 'POST', read: Unexpected }));
	await Capture.Accept(Request(Second, Segment, { encoding: 'base64' }));
	await Capture.Accept(Request(Second, Segment, { encoding: 'base64', read: Unexpected }));
	Assert.equal(Capture.received, 1);
	Assert.equal(Capture.complete, false);
	Assert.throws(() => Capture.LocalInput(), { key: 'stream_playback_segments_missing' });
	await Capture.Accept(Request(First, Segment, { encoding: 'base64' }));
	Assert.equal(Capture.complete, true);
	Assert.equal(Capture.LocalInput().bytes, Ts.byteLength * 2);
	Assert.deepEqual(Saved.get('segment-0.ts'), Ts);
	Assert.deepEqual(Saved.get('segment-1.ts'), Ts);
});
Test('ignores missing bodies, rejects invalid packets and never reads an encryption key', async () =>
{
	const Capture = new PlaybackHls(Master, async () => Assert.fail('Invalid segment was stored'));
	await Capture.Accept(Request(Master, '#EXTM3U\n#EXTINF:4,\nfirst.jpeg\n#EXT-X-ENDLIST'));
	await Capture.Accept(Request('https://player.test/first.jpeg', '', { encoding: 'base64' }));
	Assert.equal(Capture.received, 0);
	await Assert.rejects(Capture.Accept(Request('https://player.test/first.jpeg', 'AA==', { encoding: 'base64' })),
	{ key: 'stream_playback_ts_incomplete' });
	const Encrypted = new PlaybackHls(Master, async () =>
	{
	});
	await Assert.rejects(Encrypted.Accept(Request(Master,
	'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:4,\nfirst.jpeg\n#EXT-X-ENDLIST')), { key: 'stream_hls_encrypted' });
});
Test('counts a repeated segment for each playlist entry while writing one scratch file', async () =>
{
	const Saved = [];
	const Capture = new PlaybackHls(Master, async (Name, Bytes) => Saved.push({ name: Name, bytes: Bytes }));
	await Capture.Accept(Request(Master, `#EXTM3U\n#EXTINF:4,\n${First}\n#EXTINF:4,\n${First}\n#EXT-X-ENDLIST`));
	await Capture.Accept(Request(First, Segment, { encoding: 'base64' }));
	Assert.equal(Capture.received, 2);
	Assert.deepEqual(Saved, [{ name: 'segment-0.ts', bytes: Ts }]);
	const Result = Capture.LocalInput();
	Assert.equal(Result.bytes, Ts.byteLength);
	Assert.deepEqual(Result.playlist.match(/^segment-\d+\.ts$/gm), ['segment-0.ts', 'segment-0.ts']);
});
