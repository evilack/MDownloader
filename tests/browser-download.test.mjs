import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { DownloadNamedFile, FinishDownloadNaming, ForgetDownloadFilename } from '../extension/lib/browser-download.js';
Test('suggests names for concurrent owned downloads by browser ID and releases the listener', async T =>
{
	const Owner = 'mdownloader';
	const Url = 'https://example.test/clip.mp4';
	const Starts = [];
	let Listener;
	globalThis.chrome = {
		runtime: { id: Owner },
		downloads: {
			onDeterminingFilename: {
				addListener(Callback)
				{
					Assert.equal(Listener, undefined);
					Listener = Callback;
				},
				removeListener(Callback)
				{
					Assert.equal(Listener, Callback);
					Listener = undefined;
				},
			},
			download(Options)
			{
				return new Promise((Resolve, Reject) => Starts.push({ options: Options, resolve: Resolve, reject: Reject }));
			},
		},
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const First = DownloadNamedFile(Url, 'First page_clip.mp4');
	const Second = DownloadNamedFile(Url, 'Second page_clip.mp4');
	Assert.equal(Starts[0].options.filename, 'First page_clip.mp4');
	Assert.equal(await new Promise(Resolve => Listener({ id: 22, url: Url, byExtensionId: 'other' }, Resolve)), undefined);
	const Early = new Promise(Resolve => Assert.equal(Listener({ id: 22, url: Url, byExtensionId: Owner }, Resolve), true));
	Starts[1].resolve(22);
	Assert.equal(await Second, 22);
	Assert.deepEqual(await Early, { filename: 'Second page_clip.mp4', conflictAction: 'uniquify' });
	FinishDownloadNaming({ id: 22, filename: { current: 'Second page_clip.mp4' } });
	Assert.equal(typeof Listener, 'function');
	Starts[0].resolve(21);
	Assert.equal(await First, 21);
	Assert.deepEqual(await new Promise(Resolve => Listener({ id: 21, url: Url, byExtensionId: Owner }, Resolve)),
	{ filename: 'First page_clip.mp4', conflictAction: 'uniquify' });
	ForgetDownloadFilename(21);
	Assert.equal(Listener, undefined);
	const Failed = DownloadNamedFile(Url, 'Failed page_clip.mp4');
	Starts[2].reject(new Error('Download failed'));
	await Assert.rejects(Failed, /Download failed/);
	Assert.equal(Listener, undefined);
});
