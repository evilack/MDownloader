/** Real Vimeo AV1 + separate AAC download in an isolated Chrome profile. */
import Assert from 'node:assert/strict';
import {mkdir, cp, readFile, writeFile} from 'node:fs/promises';
import {openAsBlob} from 'node:fs';
import {createHash} from 'node:crypto';
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Input, BlobSource, ALL_FORMATS, EncodedPacketSink} from '../../extension/vendor/mediabunny-1.65.2.mjs';
const Root = fileURLToPath(new URL('../../', import.meta.url));
const Artifact = Path.join(Root, 'artifacts/vimeo-audio/chrome-' + Date.now());
const Downloads = Path.join(Artifact, 'downloads');
await mkdir(Downloads, {recursive: true});
const ExtensionPath = Path.join(Artifact, 'extension');
await cp(Path.join(Root, 'extension'), ExtensionPath, {recursive: true});
const Manifest = JSON.parse(await readFile(Path.join(ExtensionPath, 'manifest.json'), 'utf8'));
const TestHosts = ['https://vimeo.com/*', 'https://player.vimeo.com/*', 'https://*.vimeocdn.com/*'];
Manifest.host_permissions.push(...TestHosts);
await writeFile(Path.join(ExtensionPath, 'manifest.json'), JSON.stringify(Manifest));
const {chromium} = await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE ||
	Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {
	executablePath: process.env.MDOWNLOADER_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
	headless: true, ignoreDefaultArgs: ['--disable-extensions'],
	args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
});
const Report = {source: 'https://vimeo.com/1242476309', isolatedProfile: true, computerUse: false,
	testOnlyHosts: TestHosts, resolution: '426x240'};
try
{
	const Browser = await Context.browser().newBrowserCDPSession();
	await Browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: Downloads});
	const {id} = await Browser.send('Extensions.loadUnpacked', {path: ExtensionPath});
	const Extension = await Context.newPage();
	await Extension.goto(`chrome-extension://${id}/options.html`);
	await Extension.evaluate(() => chrome.storage.local.set({language: 'ko', usePageTitle: false, useDownloadDateTime: false,
		notifyDownloadComplete: false, subtitleTranslation: {enabled: false}}));
	await Extension.waitForTimeout(700);
	await Extension.goto(`chrome-extension://${id}/popup.html`);
	await Extension.evaluate(async() => (await import('./hls-discovery.js')).SyncHlsDiscovery());
	const Player = await Context.newPage();
	await Player.goto('https://player.vimeo.com/video/1242476309?h=04bb30474b', {waitUntil: 'domcontentloaded'});
	const MasterUrl = await Player.evaluate(() =>
	{
		const Hls = globalThis.playerConfig.request.files.hls;
		return Hls.cdns[Hls.default_cdn].av1_url;
	});
	const MasterText = await Player.evaluate(async Url => (await fetch(Url, {signal: AbortSignal.timeout(15000)})).text(), MasterUrl);
	const TabId = await Extension.evaluate(async() => (await chrome.tabs.query({url: 'https://player.vimeo.com/video/1242476309*'}))[0].id);
	await Extension.evaluate(async({TabId, MasterUrl, MasterText}) =>
	{
		const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId}, func: () => location.href});
		await (await import('./network.js')).ObserveManifest({tab: {id: TabId}, frameId: 0,
			documentId: Frame.documentId, origin: new URL(Frame.result).origin}, {url: MasterUrl, text: MasterText, page: Frame.result});
	}, {TabId, MasterUrl, MasterText});
	Report.manifestObservation = 'Real HTTP response passed to ObserveManifest after the browser recorded its request';
	const Selected = await Extension.evaluate(async MasterUrl =>
	{
		const {ReadPlaylist} = await import('./lib/hls-http.js');
		const {ParseMaster} = await import('./lib/hls.js');
		return ParseMaster(await ReadPlaylist(MasterUrl), MasterUrl).find(Q => Q.resolution === '426x240');
	}, MasterUrl);
	Assert.ok(Selected.audioUrl);
	// Observe a successful video rendition exactly as normal playback does. The
	// master must remain the source of its companion audio, even on this shortcut.
	Assert.equal(await Player.evaluate(async Url => (await fetch(Url, {signal: AbortSignal.timeout(15000)})).status, Selected.url), 200);
	await Player.waitForTimeout(500);
	const RequestId = await Extension.evaluate(async({TabId, MasterUrl, Selected}) =>
	{
		const {Scan, ResolveCandidate} = await import('./detection.js');
		const ScanResult = await Scan(TabId, 'popup');
		let Candidate;
		for (const Item of ScanResult.candidates || [])
		{
			const Resolved = await ResolveCandidate(TabId, ScanResult.scanId, Item.id, 'popup');
			if (Resolved.url === MasterUrl) Candidate = Resolved;
		}
		if (!Candidate?.observedVariants?.some(V => V.url === Selected.url)) throw Error('Observed rendition shortcut was not exercised');
		globalThis.VimeoLaunch = null;
		chrome.runtime.onMessage.addListener(Message =>
		{
			if (Message.type === 'hlsRun') globalThis.VimeoLaunch = {
				observedVideo: Message.job.url === Selected.url, separateAudio: Message.job.audioUrl === Selected.audioUrl,
				masterBypassed: Message.job.variantUrl === undefined};
		});
		const RequestId = crypto.randomUUID();
		const Response = await chrome.runtime.sendMessage({type: 'enqueue', tabId: TabId, scanId: ScanResult.scanId,
			candidateId: Candidate.id, requestId: RequestId, variantUrl: Selected.url,
			subtitleOptions: {trackIds: [], translation: {enabled: false, targetLanguage: 'ko', sourceLanguage: 'auto', provider: 'google', model: '', effort: ''}}});
		if (!Response?.ok || Response.data?.state !== 'started') throw Error(JSON.stringify(Response));
		return RequestId;
	}, {TabId, MasterUrl, Selected});
	console.log('Started full Vimeo AV1/AAC download through the observed-rendition shortcut');
	let State;
	for (let Attempt = 0; Attempt < 300; Attempt++)
	{
		State = await Extension.evaluate(async Id =>
		{
			const Job = (await chrome.storage.local.get('job:' + Id))['job:' + Id];
			const [Download] = Job?.downloadId === undefined ? [] : await chrome.downloads.search({id: Job.downloadId});
			return {state: Job?.state, error: Job?.error, finished: Job?.finished, count: Job?.count, bytes: Job?.bytesReceived,
				launch: globalThis.VimeoLaunch, download: Download && {state: Download.state, filename: Download.filename}};
		}, RequestId);
		if (Attempt % 15 === 0) console.log(JSON.stringify(State));
		if (State.download?.state === 'complete' || ['failed', 'canceled'].includes(State.state)) break;
		await new Promise(Resolve => setTimeout(Resolve, 1000));
	}
	Assert.equal(State.download?.state, 'complete', JSON.stringify(State));
	Report.launch = State.launch;
	Assert.deepEqual(Report.launch, {observedVideo: true, separateAudio: true, masterBypassed: true});
	const Filename = State.download.filename;
	const Relative = Path.relative(Downloads, Filename);
	Assert.ok(Relative && !Relative.startsWith('..') && !Path.isAbsolute(Relative));
	const Bytes = await readFile(Filename);
	Report.file = {filename: Filename, bytes: Bytes.length, sha256: createHash('sha256').update(Bytes).digest('hex')};
	const Media = new Input({source: new BlobSource(await openAsBlob(Filename)), formats: ALL_FORMATS});
	try
	{
		Report.duration = await Media.computeDuration(); Report.tracks = [];
		for (const Track of await Media.getTracks())
		{
			let Packets = 0; for await (const Packet of new EncodedPacketSink(Track).packets()) Packets++;
			Report.tracks.push({type: Track.type, codec: await Track.getCodec(), packets: Packets});
		}
	}
	finally {Media.dispose();}
	Assert.ok(Report.duration > 1283 && Report.duration < 1284);
	Assert.ok(Report.tracks.some(T => T.type === 'video' && T.codec === 'av1' && T.packets > 30000));
	Assert.ok(Report.tracks.some(T => T.type === 'audio' && T.codec === 'aac' && T.packets > 59000));
	const Playback = await Context.newPage(); await Playback.goto(pathToFileURL(Filename).href);
	await Playback.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
	Report.playback = await Playback.evaluate(async() =>
	{
		const Video = document.querySelector('video'); Video.muted = true; await Video.play();
		await new Promise(R => setTimeout(R, 1000));
		Video.currentTime = Video.duration - 2;
		await new Promise(R => Video.addEventListener('seeked', R, {once: true}));
		await new Promise(R => setTimeout(R, 500));
		return {duration: Video.duration, width: Video.videoWidth, height: Video.videoHeight,
			audioBytes: Video.webkitAudioDecodedByteCount, endPosition: Video.currentTime, error: Video.error?.code};
	});
	Assert.ok(Report.playback.audioBytes > 0); Assert.ok(Report.playback.endPosition > 1280);
	Report.passed = true;
}
catch (ErrorValue) {Report.error = ErrorValue.stack; process.exitCode = 1;}
finally
{
	await writeFile(Path.join(Artifact, 'result.json'), JSON.stringify(Report, null, 2));
	console.log(JSON.stringify({artifact: Artifact, ...Report}, null, 2)); await Context.close();
}
