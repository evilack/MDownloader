import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { SafeFilename } from '../extension/lib/download-folder.js';
import { Enqueue, EnqueuePlayback } from '../extension/jobs.js';
import {PartialFilename, PartialOutputFilename} from '../extension/lib/partial-naming.js';
Test('prefixes the page hostname and replaces spaces and stem dots while retaining the extension', () =>
{
	const Page = 'https://www.xvideos2.com/video.example/title?token=ignored#fragment';
	Assert.equal(SafeFilename('기존 파일명.버전1.mp4', '', undefined, '.mp4', Page), 'xvideos2_com_기존_파일명_버전1.mp4');
	Assert.equal(SafeFilename('clip.mp4', '방송 제목.v2', undefined, '.mp4', Page), 'xvideos2_com_방송_제목_v2_clip.mp4');
	Assert.equal(SafeFilename('clip.mp4', '', undefined, '.mp4', 'https://media.example.co.kr:8443/watch'), 'media_example_co_kr_clip.mp4');
	Assert.equal(SafeFilename('clip.mp4', '', undefined, '.mp4', 'not a URL'), 'clip.mp4');
	Assert.equal(SafeFilename('clip.mp4', '', undefined, '.mp4', 'file:///tmp/video'), 'clip.mp4');
	Assert.equal(SafeFilename('clip name.v1.mp4'), 'clip_name_v1.mp4');
	Assert.equal(SafeFilename('CON.mp4'), '_CON.mp4');
	Assert.equal(SafeFilename('bad\\/:*?"<>|\u0001 name.mp4'), 'bad___________name.mp4');
});
Test('uses the owning page domain rather than the media CDN for direct and HLS jobs', async T =>
{
	const Page = 'https://www.xvideos2.com/video.example/title', Doc = 'naming-doc';
	const Local = {usePageTitle: false, useDownloadDateTime: false};
	const Session = {'scan:22': {scanId: 'scan', documentId: Doc, page: Page, candidates: [
		{id: 0, supported: true, name: 'original name.v1.mp4', format: 'MP4', url: 'https://cdn.test/file.mp4'},
		{id: 1, supported: true, name: 'hls.v2.m3u8', format: 'M3U8', url: 'https://cdn.test/master.m3u8'},
	]}};
	const Storage = Data => ({get: async Keys => Object.fromEntries((Keys === null ? Object.keys(Data) : Array.isArray(Keys) ? Keys : [Keys]).map(Key => [Key, Data[Key]])),
		set: async Values => Object.assign(Data, Values)});
	globalThis.chrome = {storage: {local: Storage(Local), session: Storage(Session)}, permissions: {contains: async() => true},
		runtime: {getURL: Path => 'chrome-extension://test/' + Path, getContexts: async() => [{}], sendMessage: async() => ({ok: true})},
		scripting: {executeScript: async() => [{documentId: Doc, result: {page: Page, active: true, pageTitle: 'Ignored title'}}]},
		downloads: {onDeterminingFilename: {addListener() {}, removeListener() {}}, download: async() => 1}};
	T.after(() => delete globalThis.chrome);
	for (const Id of [0, 1]) await Enqueue({tabId: 22, scanId: 'scan', candidateId: Id, requestId: `00000000-0000-0000-0000-00000000000${Id + 3}`});
	Assert.equal(Local['job:00000000-0000-0000-0000-000000000003'].filename, 'xvideos2_com_original_name_v1.mp4');
	Assert.equal(Local['job:00000000-0000-0000-0000-000000000004'].filename, 'xvideos2_com_hls_v2.mp4');
});
Test('retains the site prefix and fixed timestamp when a recording format or partial save changes the suffix', () =>
{
	const Started = new Date(2026, 10, 8, 15, 4, 6);
	const Domain = 'a'.repeat(60) + '.' + 'b'.repeat(60) + '.test';
	const Prefix = 'a'.repeat(60) + '_' + 'b'.repeat(60) + '_test_';
	const Filename = SafeFilename(undefined, '방송 제목', Started, '.mp4', 'https://' + Domain);
	Assert.ok(Filename.startsWith(Prefix));
	Assert.ok(Filename.endsWith('_2026-11-08_15-04-06.mp4'));
	Assert.equal(PartialOutputFilename(Filename, '.webm'), Filename.slice(0, -4) + '.webm');
	const Partial = PartialFilename(Filename, Started);
	Assert.ok(Partial.startsWith(Prefix));
	Assert.ok(Partial.endsWith('_partial_2026-11-08_15-04-06.mp4'));
	Assert.ok(Partial.length <= 255);
});
Test('reserves space for the local start timestamp without dropping the page title or extension', () =>
{
	const Started = new Date(2026, 10, 7, 9, 8, 6);
	Assert.equal(SafeFilename('clip.mp4', '방송 제목', Started), '방송_제목_clip_2026-11-07_09-08-06.mp4');
	Assert.equal(SafeFilename('index.mp4', '방송 제목', Started), '방송_제목_2026-11-07_09-08-06.mp4');
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
	const Register = RequestId => EnqueuePlayback({ requestId: RequestId, playlist: '#EXTM3U\n', count: 1, bytes: 188, pageTitle: '방송 제목', pageUrl: 'https://www.xvideos2.com/watch' });
	await Register(First);
	const Filename = Data['job:' + First].filename;
	Assert.match(Filename, /^xvideos2_com_방송_제목_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/);
	Assert.doesNotMatch(Filename, /MDownloader|playback/);
	await Register(First);
	Assert.equal(Data['job:' + First].filename, Filename);
	Data.useDownloadDateTime = false;
	await Register(Second);
	Assert.equal(Data['job:' + Second].filename, 'xvideos2_com_방송_제목.mp4');
});

Test('sources without original filenames use only the available title and start time', () =>
{
	const Started = new Date(2026, 10, 8, 15, 4, 6);
	Assert.equal(SafeFilename(undefined, '방송 제목', Started), '방송_제목_2026-11-08_15-04-06.mp4');
	Assert.equal(SafeFilename(null, '방송 제목', Started, '.webm'), '방송_제목_2026-11-08_15-04-06.webm');
	Assert.equal(SafeFilename(undefined, '', Started), '2026-11-08_15-04-06.mp4');
	Assert.equal(SafeFilename(undefined, '방송 제목'), '방송_제목.mp4');
});
