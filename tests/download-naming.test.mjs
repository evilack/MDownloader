import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { SafeFilename } from '../extension/lib/download-folder.js';
import { EnqueuePlayback } from '../extension/jobs.js';
Test('reserves space for the local start timestamp without dropping the page title or extension', () =>
{
	const Started = new Date(2026, 10, 7, 9, 8, 6);
	Assert.equal(SafeFilename('clip.mp4', '방송 제목', Started), '방송 제목_clip_2026-11-07_09-08-06.mp4');
	Assert.equal(SafeFilename('index.mp4', '방송 제목', Started), '방송 제목_2026-11-07_09-08-06.mp4');
	Assert.equal(SafeFilename('clip.mp3', '', Started), 'clip_2026-11-07_09-08-06.mp3');
	const Long = SafeFilename('x'.repeat(150) + '.mp4', '방송'.repeat(100), Started);
	Assert.ok(Long.startsWith('방송'));
	Assert.ok(Long.endsWith('_2026-11-07_09-08-06.mp4'));
	Assert.ok(Long.length <= 104);
	Assert.equal(SafeFilename('clip.mp4', '제목'), '제목_clip.mp4');
});
Test('defaults to a frozen timestamp at registration and preserves an explicit opt-out', async T =>
{
	const Data = { usePageTitle: true };
	globalThis.chrome = {
		storage: { local: {
				get: async Keys => Object.fromEntries((Array.isArray(Keys) ? Keys : [Keys]).map(Key => [Key, Data[Key]])),
				set: async Values => Object.assign(Data, Values),
			} },
		runtime: { getURL: Path => 'chrome-extension://test/' + Path, getContexts: async () => [{}], sendMessage: async () => ({ ok: true }) },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const First = '00000000-0000-0000-0000-000000000001';
	const Second = '00000000-0000-0000-0000-000000000002';
	const Enqueue = RequestId => EnqueuePlayback({ requestId: RequestId, playlist: '#EXTM3U\n', count: 1, bytes: 188, pageTitle: '방송 제목' });
	await Enqueue(First);
	const Filename = Data['job:' + First].filename;
	Assert.match(Filename, /^방송 제목_playback_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/);
	Assert.doesNotMatch(Filename, /MDownloader-/);
	await Enqueue(First);
	Assert.equal(Data['job:' + First].filename, Filename);
	Data.useDownloadDateTime = false;
	await Enqueue(Second);
	Assert.equal(Data['job:' + Second].filename, '방송 제목_playback.mp4');
});
