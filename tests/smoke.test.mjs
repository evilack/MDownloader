import { test as Test } from 'node:test';
import Assert from 'node:assert/strict';
import { readFile as ReadFile } from 'node:fs/promises';
import { ClassifyMediaUrl, IsHlsFragmentUrl, MediaResourceKey } from '../extension/lib/media.js';
import { SafeFilename } from '../extension/lib/download-folder.js';
import { GetDownloadMetrics } from '../extension/lib/metrics.js';
import { InitializeLocale } from '../extension/lib/i18n.js';
Test('classifies direct files without losing signed query strings', () =>
{
	const Direct = ClassifyMediaUrl('https://example.test/clip.MP4?key=a%2Bb');
	Assert.equal(Direct.format, 'MP4');
	Assert.equal(Direct.url, 'https://example.test/clip.MP4?key=a%2Bb');
	Assert.equal(ClassifyMediaUrl('https://example.test/master.m3u8').format, 'M3U8');
	Assert.equal(ClassifyMediaUrl('blob:https://example.test/id'), null);
	Assert.equal(ClassifyMediaUrl('javascript:alert(1)'), null);
});
Test('identifies LL-HLS reloads without rewriting signed query encodings', () =>
{
	const Signed = 'https://cdn.test/live.m3u8?token=a%20b%2Bc&signature=%2f%2B';
	Assert.equal(MediaResourceKey(Signed + '&_HLS_msn=5&_HLS_part=2&_HLS_skip=YES'), Signed);
	Assert.equal(MediaResourceKey(Signed), Signed);
	Assert.notEqual(MediaResourceKey(Signed.replace('a%20b', 'other')), Signed);
	const Direct = 'https://cdn.test/clip.mp4?_HLS_msn=5&token=a%20b';
	Assert.equal(MediaResourceKey(Direct), Direct);
});
Test('recognizes parts only inside an observed HLS directory and quality stem', () =>
{
	const Playlist = 'https://cdn.test/live/channel_240p.m3u8?token=keep';
	for (const Name of ['channel_240p_h264_init_key.mp4', 'channel_240p_h264_8325_key_123_part0.mp4', 'channel_240p_part1.mp4'])
	{
		Assert.equal(IsHlsFragmentUrl(Playlist, 'https://cdn.test/live/' + Name), true, Name);
	}
	for (const Url of ['https://other.test/live/channel_240p_part1.mp4', 'https://cdn.test/other/channel_240p_part1.mp4',
		'https://cdn.test/live/other_240p_part1.mp4', 'https://cdn.test/live/channel_240p.mp4',
		'https://cdn.test/live/channel_240p_trailer.mp4'])
	{
		Assert.equal(IsHlsFragmentUrl(Playlist, Url), false, Url);
	}
});
Test('recognizes supported audio and video file extensions and DASH playlists', () =>
{
	for (const Extension of ['mov', 'mkv', 'mp3', 'avi', 'flv', 'm4v', 'f4v', 'm4a', 'wav', 'flac', 'opus', 'ogg', 'ogv', 'oga', 'weba', 'mpd'])
	{
		const Url = `https://example.test/asset.%${Extension.charCodeAt(0).toString(16)}${Extension.slice(1)}?signature=a%2Bb`;
		Assert.deepEqual(ClassifyMediaUrl(Url), { name: `asset.${Extension}`, format: Extension.toUpperCase(), supported: true, url: Url });
	}
});
Test('excludes standalone stream fragments from file candidates', () =>
{
	for (const Name of ['chunk.m4s', 'chunk.ts', 'chunk.aac', 'chunk.cmfv', 'chunk.cmfa', 'init-stream0.m4a', 'chunk-stream1-00001.mp4'])
	{
		Assert.equal(ClassifyMediaUrl(`https://example.test/${Name}`), null, Name);
	}
});
Test('distinguishes live, completed, and unknown-size metrics', async T =>
{
	T.mock.method(globalThis, 'fetch', async Url => new Response(await ReadFile(Url)));
	globalThis.chrome = { storage: { local: { get: async () => ({ language: 'en' }) } } };
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await InitializeLocale();
	const Active = { state: 'in_progress', bytesReceived: 5800000, totalBytes: 10000000 };
	Assert.deepEqual(GetDownloadMetrics(Active, { bytes: 2400000, time: 1000 }, 2000), {
		percent: 58, progress: '58%', speed: '3.4 MB/s',
	});
	Assert.equal(GetDownloadMetrics({ ...Active, totalBytes: -1 }, null, 2000).percent, null);
	const Stream = { state: 'active', hls: true, finished: 2, count: 5, bytesReceived: 5800000 };
	Assert.deepEqual(GetDownloadMetrics(Stream, { bytes: 2400000, time: 1000 }, 2000), {
		percent: 40, progress: '40%', speed: '3.4 MB/s',
	});
	Assert.equal(GetDownloadMetrics({ ...Stream, finished: 5 }, null, 2000).percent, 99);
	Assert.equal(GetDownloadMetrics({ ...Stream, live: true }, null, 2000).percent, null);
	const Beginning = GetDownloadMetrics({...Stream, finished: 1, count: 1951}, null, 2000);
	Assert.ok(Beginning.percent > 0, 'the first completed segment of a long episode must advance progress');
	Assert.equal(Beginning.progress, '0.05%');
	Assert.deepEqual(GetDownloadMetrics({
		...Active, state: 'complete', bytesReceived: 6200000,
		startTime: '2026-11-06T00:00:00Z', endTime: '2026-11-06T00:00:02Z',
	}), { percent: 100, progress: '6.2 MB', speed: 'Avg. 3.1 MB/s' });
});
Test('keeps the original filename and extension when adding a page title', () =>
{
	Assert.equal(SafeFilename('index-cut.mp4', '영상 제목'), '영상_제목_index-cut.mp4');
	Assert.equal(SafeFilename('clip.webm', 'Episode: 10'), 'Episode__10_clip.webm');
	Assert.equal(SafeFilename('clip.mp4', '  ...  '), 'clip.mp4');
	const Long = SafeFilename('clip.mp4', '제목'.repeat(100));
	Assert.ok(Long.endsWith('_clip.mp4'));
	Assert.ok(Long.length <= 104);
	const LongBoth = SafeFilename('c'.repeat(150) + '.mp4', '제목'.repeat(100));
	Assert.match(LongBoth, /^제목.+_c+\.mp4$/);
	Assert.ok(LongBoth.length <= 104);
});
Test('uses the page title in place of index when a title is available', () =>
{
	Assert.equal(SafeFilename('index.mp4', '영상 제목'), '영상_제목.mp4');
	Assert.equal(SafeFilename('INDEX.webm', '영상 제목'), '영상_제목.webm');
	Assert.equal(SafeFilename('index.mp4'), 'index.mp4');
	Assert.equal(SafeFilename('index.mp4', ' ... '), 'index.mp4');
	Assert.equal(SafeFilename('index.mp4', 'CON'), '_CON.mp4');
});
