/** Real Bilibili progressive lookup/download in a disposable Chrome profile, without Computer Use. */
import Assert from 'node:assert/strict';
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdir, cp, readFile, writeFile, stat} from 'node:fs/promises';
import {openAsBlob} from 'node:fs';
import {createHash} from 'node:crypto';
import {Input, BlobSource, ALL_FORMATS, EncodedPacketSink} from '../../extension/vendor/mediabunny-1.65.2.mjs';
const Root = fileURLToPath(new URL('../../', import.meta.url));
const Artifact = Path.join(Root, 'artifacts/bilibili/chrome-' + Date.now());
const ExtensionPath = Path.join(Artifact, 'extension'), Downloads = Path.join(Artifact, 'downloads');
await mkdir(Downloads, {recursive: true});
await cp(Path.join(Root, 'extension'), ExtensionPath, {recursive: true});
const Manifest = JSON.parse(await readFile(Path.join(ExtensionPath, 'manifest.json'), 'utf8'));
const Hosts = ['https://www.bilibili.com/*'];
Manifest.host_permissions.push(...Hosts);
await writeFile(Path.join(ExtensionPath, 'manifest.json'), JSON.stringify(Manifest));
const {chromium} = await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE ||
	Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {
	executablePath: process.env.MDOWNLOADER_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
	headless: true, ignoreDefaultArgs: ['--disable-extensions'],
	args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
});
const Source = 'https://www.bilibili.com/zh-Hans/video/BV1yS4q6mEan/?trackid=web_pegasus_0.router-web-pegasus-2479516-sm4rx.1794199540265.494&spm_id_from=333.1007.tianma.1-5-5.click';
const Report = {source: Source, computerUse: false, isolatedProfile: true, testOnlyHosts: Hosts, cdnPermissionAdded: false};
try
{
	const Browser = await Context.browser().newBrowserCDPSession();
	Report.browser = (await Browser.send('Browser.getVersion')).product;
	await Browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: Downloads});
	const {id} = await Browser.send('Extensions.loadUnpacked', {path: ExtensionPath});
	const Extension = await Context.newPage();
	await Extension.goto(`chrome-extension://${id}/options.html`);
	await Extension.evaluate(() => chrome.storage.local.set({language: 'ko', useDownloadDateTime: false, usePageTitle: false,
		notifyDownloadComplete: false, subtitleTranslation: {enabled: false}}));
	const Video = await Context.newPage();
	await Video.goto(Source, {waitUntil: 'domcontentloaded', timeout: 45000});
	await Video.waitForFunction(() => document.querySelector('video')?.readyState >= 2, {timeout: 30000});
	await Video.bringToFront();
	const TabId = await Extension.evaluate(async () => (await chrome.tabs.query({url: 'https://www.bilibili.com/*'}))[0].id);
	Report.scan = await Extension.evaluate(async TabId =>
	{
		const {Scan, ResolveCandidate} = await import('./detection.js');
		const Result = await Scan(TabId, 'bili-probe');
		if (Result.candidates?.length !== 1) throw Error('Expected one Bilibili MP4: ' + JSON.stringify(Result));
		const Item = await ResolveCandidate(TabId, Result.scanId, Result.candidates[0].id, 'bili-probe');
		globalThis.BilibiliScan = Result;
		return {count: Result.candidates.length, name: Item.name, format: Item.format,
			sourceIdentity: Item.sourceIdentity, sourceHost: new URL(Item.url).hostname, sourcePath: new URL(Item.url).pathname, live: Item.live};
	}, TabId);
	Assert.equal(Report.scan.format, 'MP4');
	Assert.match(Report.scan.sourceIdentity, /^bilibili:BV1yS4q6mEan:43377626032:/);
	console.log('Resolved one complete Bilibili MP4:', Report.scan.name);
	Report.repeat = await Extension.evaluate(async TabId =>
	{
		const {Scan} = await import('./detection.js');
		const Next = await Scan(TabId, 'bili-probe');
		const Same = Next.candidates?.length === 1 && Next.candidates[0].mediaKey === globalThis.BilibiliScan.candidates[0].mediaKey;
		globalThis.BilibiliScan = Next;
		return Same;
	}, TabId);
	Assert.equal(Report.repeat, true);
	const RequestId = await Extension.evaluate(async TabId =>
	{
		const {Enqueue} = await import('./jobs.js');
		const requestId = crypto.randomUUID();
		const Result = await Enqueue({tabId: TabId, scanId: globalThis.BilibiliScan.scanId,
			candidateId: 0, scope: 'bili-probe', requestId});
		if (Result.state !== 'started') throw Error(JSON.stringify(Result));
		return requestId;
	}, TabId);
	console.log('Started actual MP4 download');
	for (let Attempt = 0; Attempt < 600; Attempt++)
	{
		Report.download = await Extension.evaluate(async RequestId =>
		{
			const Job = (await chrome.storage.local.get('job:' + RequestId))['job:' + RequestId];
			const [Item] = Job?.downloadId !== undefined ? await chrome.downloads.search({id: Job.downloadId}) : [];
			return Item && {state: Item.state, error: Item.error, bytes: Item.bytesReceived, filename: Item.filename};
		}, RequestId);
		if (Report.download && Report.download.state !== 'in_progress') break;
		await new Promise(Resolve => setTimeout(Resolve, 500));
	}
	Assert.equal(Report.download?.state, 'complete', JSON.stringify(Report.download));
	const Relative = Path.relative(Downloads, Report.download.filename);
	Assert.ok(Relative && !Relative.startsWith('..') && !Path.isAbsolute(Relative));
	Assert.ok((await stat(Report.download.filename)).size > 1_000_000);
	const InputFile = new Input({source: new BlobSource(await openAsBlob(Report.download.filename)), formats: ALL_FORMATS});
	try
	{
		const Tracks = await InputFile.getTracks();
		Report.tracks = [];
		for (const Track of Tracks)
		{
			const First = await new EncodedPacketSink(Track).getFirstPacket();
			Report.tracks.push({type: Track.type, codec: Track.codec, duration: await Track.computeDuration(),
				width: Track.displayWidth, height: Track.displayHeight, firstPacketBytes: First?.data.byteLength});
		}
		Assert.ok(Report.tracks.some(Track => Track.type === 'video' && Track.firstPacketBytes > 0));
		Assert.ok(Report.tracks.some(Track => Track.type === 'audio' && Track.firstPacketBytes > 0));
		Assert.ok(Report.tracks.every(Track => Track.duration > 790));
	}
	finally {InputFile.dispose();}
	const Saved = await Context.newPage();
	await Saved.goto(pathToFileURL(Report.download.filename).href);
	await Saved.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
	Report.playback = await Saved.evaluate(async () =>
	{
		const Player = document.querySelector('video');
		Player.muted = true;
		await Player.play();
		await new Promise(Resolve => setTimeout(Resolve, 800));
		Player.currentTime = Player.duration - 2;
		await new Promise(Resolve => Player.addEventListener('seeked', Resolve, {once: true}));
		await new Promise(Resolve => setTimeout(Resolve, 500));
		return {width: Player.videoWidth, height: Player.videoHeight, duration: Player.duration,
			endPosition: Player.currentTime, audioBytes: Player.webkitAudioDecodedByteCount, error: Player.error?.code};
	});
	Assert.equal(Report.playback.height, 720);
	Assert.ok(Report.playback.audioBytes > 0);
	Assert.ok(Report.playback.endPosition > 790);
	Assert.equal(Report.playback.error, undefined);
	Report.sha256 = createHash('sha256').update(await readFile(Report.download.filename)).digest('hex');
	console.log(JSON.stringify({scan: Report.scan, download: Report.download, tracks: Report.tracks, artifact: Artifact}));
}
catch (ErrorValue) {Report.error = String(ErrorValue.stack || ErrorValue); throw ErrorValue;}
finally {await writeFile(Path.join(Artifact, 'report.json'), JSON.stringify(Report, null, 2)); await Context.close();}
