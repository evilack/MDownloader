import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {CollectPlayerPreviews} from '../extension/lib/player-previews.js';
import {HlsQualities} from '../extension/hls-jobs.js';
import {RecordDownloadLog} from '../extension/lib/download-log.js';
Test('one quality lookup shares CDN permission checks and the next lookup observes revocation', async T =>
{
	const Urls = ['https://cdn.test/one.m3u8', 'https://cdn.test/two.m3u8', 'https://other.test/three.m3u8'];
	const Page = 'https://page.test/watch';
	const Scan = {scanId: 'quality-cache', page: Page, documentId: 'doc', candidates: [{id: 0, url: 'https://cdn.test/master.m3u8', format: 'M3U8', supported: true, qualities: Urls.map(Url => ({url: Url}))}]};
	let Checks = 0, bAllowed = true;
	globalThis.chrome = {permissions: {contains: async () =>
			{
				Checks++;
				return bAllowed;
			}},
		storage: {session: {get: async Key => ({[Key]: Key.startsWith('scan:') ? Scan : []})}, local: {get: async () => ({})}},
		scripting: {executeScript: async () => [{documentId: 'doc', result: {page: Page, active: true}}]},
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Input = {tabId: 1, scanId: Scan.scanId, candidateId: 0};
	Assert.ok((await HlsQualities(Input)).every(Quality => Quality.serverPermission === undefined));
	Assert.equal(Checks, 2);
	bAllowed = false;
	Assert.deepEqual((await HlsQualities(Input)).map(Quality => Quality.serverPermission), ['https://cdn.test/*', 'https://cdn.test/*', 'https://other.test/*']);
	Assert.equal(Checks, 4);
});
Test('one preview collection takes one resource timing snapshot per frame', T =>
{
	let Reads = 0;
	const Player = {currentSrc: 'blob:test', paused: true, ended: false, readyState: 2, videoWidth: 100, videoHeight: 50,
		closest: () => null, querySelectorAll: () => [], duration: 30, poster: 'https://cdn.test/poster.jpg', currentTime: 0};
	globalThis.HTMLMediaElement = {HAVE_CURRENT_DATA: 2};
	globalThis.window = {document: {querySelectorAll: () => [Player]}, length: 0,
		performance: {getEntriesByType: () =>
			{
				Reads++;
				return [];
			}, getEntriesByName: () => []},
	};
	T.after(() =>
	{
		delete globalThis.window;
		delete globalThis.HTMLMediaElement;
	});
	CollectPlayerPreviews([0, 1, 2].map(Id => ({id: Id, url: `https://cdn.test/${Id}.m3u8`})), {maxWidth: 100, maxHeight: 50, jpegQuality: 0.5});
	Assert.equal(Reads, 1);
});
Test('disabled result logging performs one initial settings read for many events', async T =>
{
	let Reads = 0;
	globalThis.chrome = {storage: {local: {get: async () =>
				{
					Reads++;
					return {};
				}, set: () => Assert.fail('OFF must not write')}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	for (let Index = 0; Index < 100; Index++)
	{
		await RecordDownloadLog('started', {downloadId: Index});
	}
	Assert.equal(Reads, 1);
});
