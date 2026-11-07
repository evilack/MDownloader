import Assert from 'node:assert/strict';
import { FinishDownloadNaming } from '../extension/lib/browser-download.js';
import { test as Test } from 'node:test';
import { NormalizeDownloadFolder } from '../extension/lib/download-folder.js';
import { UpdateHls } from '../extension/jobs.js';
Test('accepts an empty setting and normalizes nested relative download folders', () =>
{
	Assert.equal(NormalizeDownloadFolder('  '), '');
	Assert.equal(NormalizeDownloadFolder(' MDownloader\\영상 모음\\ '), 'MDownloader/영상 모음');
	Assert.equal(NormalizeDownloadFolder('동영상/2026.11'), '동영상/2026.11');
});
Test('rejects absolute paths, parent references and invalid folder names', () =>
{
	for (const Path of ['C:\\Videos', '\\\\server\\share', '/Videos', '/', '../Videos', 'Videos/..',
		'Videos/.', 'Videos//2026', 'Videos/NUL.txt', 'Videos/COM1', 'Videos/invalid?', 'Videos/dot.'])
	{
		Assert.equal(NormalizeDownloadFolder(Path), null, Path);
	}
	Assert.equal(NormalizeDownloadFolder(undefined), null);
});
Test('finishes a stream in its saved folder and supports jobs created before the folder setting', async T =>
{
	const Job = { filename: 'clip.mp4', hls: true, state: 'active' };
	const Records = {
		downloadFolder: 'new-location',
		'job:configured': { ...Job, downloadFolder: 'original-location/영상' },
		'job:legacy': { ...Job },
	};
	const Downloaded = [];
	globalThis.chrome = {
		storage: { local: {
				async get(Key)
				{
					return { [Key]: Records[Key] };
				},
				async set(Values)
				{
					Object.assign(Records, Values);
				},
			} },
		runtime: { getURL: () => 'chrome-extension://test/' },
		downloads: {
			onDeterminingFilename: { addListener()
				{
				}, removeListener()
				{
				} },
			async download({ filename: Filename })
			{
				return Downloaded.push(Filename);
			},
		},
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	for (const RequestId of ['configured', 'legacy'])
	{
		const Id = await UpdateHls({ requestId: RequestId, action: 'save', objectUrl: 'blob:chrome-extension://test/clip' });
		FinishDownloadNaming({ id: Id, filename: { current: Downloaded.at(-1) } });
	}
	Assert.deepEqual(Downloaded, ['original-location/영상/clip.mp4', 'clip.mp4']);
});
