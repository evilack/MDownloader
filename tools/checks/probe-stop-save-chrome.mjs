/** Reproduce stop/save against an endlessly trickling local fMP4 response in an isolated Chrome profile.
 * Usage: node tools/checks/probe-stop-save-chrome.mjs <init.mp4> <video.m4s> */
import Assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, cp, readFile, writeFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const Root = fileURLToPath(new URL('../../', import.meta.url));
if (!process.argv[2] || !process.argv[3]) throw Error('Provide an fMP4 initialization and playable video segment.');
const Init = await readFile(Path.resolve(process.argv[2])), Segment = await readFile(Path.resolve(process.argv[3]));
const Artifact = Path.join(Root, 'artifacts/stop-save/chrome-' + Date.now());
await mkdir(Artifact, {recursive: true});
const ExtensionPath = Path.join(Artifact, 'extension');
await cp(Path.join(Root, 'extension'), ExtensionPath, {recursive: true});
const Manifest = JSON.parse(await readFile(Path.join(ExtensionPath, 'manifest.json'), 'utf8'));
Manifest.host_permissions.push('http://127.0.0.1/*');
await writeFile(Path.join(ExtensionPath, 'manifest.json'), JSON.stringify(Manifest));
const Report = {isolatedProfile: true, computerUse: false, requests: [], phases: [],
	fixtures: process.argv.slice(2, 4).map((Name, I) => ({path: Path.resolve(Name), sha256: createHash('sha256').update(I ? Segment : Init).digest('hex')}))};
const Server = createServer((Request, Response) =>
{
	const Entry = {path: Request.url}; Report.requests.push(Entry);
	Response.writeHead(200, {'Content-Type': Request.url === '/index.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp4', 'Access-Control-Allow-Origin': '*'});
	if (Request.url === '/index.m3u8') return Response.end('#EXTM3U\n#EXT-X-TARGETDURATION:12\n#EXT-X-MAP:URI="init.mp4"\n' +
		Array.from({length: 8}, (_, I) => '#EXTINF:12,\n' + I + '.m4s\n').join('') + '#EXT-X-ENDLIST\n');
	if (Request.url === '/init.mp4') return Response.end(Init);
	if (Request.url === '/0.m4s') return Response.end(Segment);
	// Keep the idle timeout alive. Stop/save must bound the total drain time.
	Entry.chunks = 1; Response.write(Segment.subarray(0, 1024));
	const Timer = setInterval(() => { Entry.chunks++; Response.write(Segment.subarray(0, 1024)); }, 500);
	Response.on('close', () => { clearInterval(Timer); Entry.closed = true; });
});
await new Promise(Resolve => Server.listen(0, '127.0.0.1', Resolve));
const Url = `http://127.0.0.1:${Server.address().port}/index.m3u8`;
const {chromium} = await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE || Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {
	executablePath: process.env.MDOWNLOADER_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
	headless: true, ignoreDefaultArgs: ['--disable-extensions'],
	args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
});
console.log('Artifact:', Artifact);
try
{
	const Browser = await Context.browser().newBrowserCDPSession();
	await Browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: Path.join(Artifact, 'downloads')});
	const {id} = await Browser.send('Extensions.loadUnpacked', {path: ExtensionPath});
	const Page = await Context.newPage(); await Page.goto(`chrome-extension://${id}/popup.html`);
	const Job = await Page.evaluate(async () =>
	{
		const Id = crypto.randomUUID();
		const Job = {requestId: Id, state: 'active', hls: true, filename: 'stop-save.mp4', created: Date.now(),
			sourcePolicyVersion: 1, youtubeSource: false, localCaptions: {enabled: false}};
		await chrome.storage.local.set({['job:' + Id]: Job, subtitleTranslation: {enabled: false}});
		const {EnsureRunner} = await import('./hls-jobs.js'); await EnsureRunner();
		return Job;
	});
	const Id = Job.requestId;
	// Transfer messages originate in the background worker in normal downloads.
	// Sending one from the popup would also invoke its request router.
	const Worker = Context.serviceWorkers().find(Worker => Worker.url().startsWith(`chrome-extension://${id}/`));
	Report.start = await Worker.evaluate(({Job, Url}) => chrome.runtime.sendMessage({type: 'hlsRun', job: {...Job, url: Url}}), {Job, Url});
	Assert.equal(Report.start.ok, true);
	for (let I = 0; I < 100; I++)
	{
		Report.beforeFinish = await Page.evaluate(async Id => (await chrome.storage.local.get('job:' + Id))['job:' + Id], Id);
		if (Report.beforeFinish?.snapshotAvailable) break;
		if (Report.beforeFinish?.state === 'failed') throw Error(JSON.stringify(Report.beforeFinish));
		await Page.waitForTimeout(100);
	}
	Assert.equal(Report.beforeFinish?.snapshotAvailable, true);
	const Began = Date.now();
	Report.finish = await Page.evaluate(Id => chrome.runtime.sendMessage({type: 'control', requestId: Id, action: 'finish'}), Id);
	Assert.equal(Report.finish.ok, true);
	for (let I = 0; I < 100; I++)
	{
		const State = await Page.evaluate(async Id =>
		{
			const Job = (await chrome.storage.local.get('job:' + Id))['job:' + Id];
			const [Download] = Job.downloadId === undefined ? [] : await chrome.downloads.search({id: Job.downloadId});
			const {PresentJob} = await import('./lib/row-presentation.js');
			const {SummarizeJob} = await import('./lib/browser-job-state.js');
			const Summary = SummarizeJob(Job, Download, {requestIds: [Id]});
			return {...Job, displayedState: Summary.state, presentation: PresentJob(Summary), download: Download && {state: Download.state, filename: Download.filename}};
		}, Id);
		if (!Report.phases.some(P => P.phase === (State.pendingAction || (State.muxing ? 'muxing' : State.state))))
			Report.phases.push({phase: State.pendingAction || (State.muxing ? 'muxing' : State.state), elapsed: Date.now() - Began});
		Report.state = State;
		if (State.muxing || State.downloadId !== undefined)
		{
			Report.muxAfterMs ??= Date.now() - Began;
			Assert.equal(State.pendingAction, undefined, 'mux/save must no longer display Stopping');
		}
		if (State.download?.state === 'complete' || ['failed', 'canceled'].includes(State.state)) break;
		await Page.waitForTimeout(100);
	}
	Assert.equal(Report.state.download?.state, 'complete', JSON.stringify(Report.state));
	Assert.equal(Report.state.displayedState, 'complete');
	Assert.equal(Report.state.presentation.status, 'complete');
	Assert.equal(Report.state.partial, true);
	Assert.ok(Report.muxAfterMs >= 4500 && Report.muxAfterMs < 8000, 'the five-second drain limit must bound trickling requests');
	Assert.equal(Report.state.finished, 1);
	Assert.ok(Report.requests.filter(R => R.path.endsWith('.m4s') && R.path !== '/0.m4s').every(R => R.closed && R.chunks > 2));
	const File = await readFile(Report.state.download.filename);
	Report.output = {path: Report.state.download.filename, bytes: File.length, sha256: createHash('sha256').update(File).digest('hex')};
	const Playback = await Context.newPage(); await Playback.goto(pathToFileURL(Report.output.path).href);
	await Playback.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
	Report.playback = await Playback.evaluate(async () =>
	{
		const V = document.querySelector('video'); V.muted = true; await V.play();
		await new Promise(R => setTimeout(R, 500));
		return {width: V.videoWidth, height: V.videoHeight, duration: V.duration, time: V.currentTime, error: V.error?.code};
	});
	Assert.ok(Report.playback.width > 0 && Report.playback.time > 0);
	Assert.equal(Report.playback.error, undefined);
	Report.passed = true;
}
catch (ErrorValue) { Report.error = String(ErrorValue.stack || ErrorValue); process.exitCode = 1; }
finally
{
	await writeFile(Path.join(Artifact, 'report.json'), JSON.stringify(Report, null, 2));
	await Context.close(); Server.closeAllConnections(); await new Promise(Resolve => Server.close(Resolve));
}
console.log(JSON.stringify({passed: Report.passed, muxAfterMs: Report.muxAfterMs, output: Report.output, playback: Report.playback, error: Report.error}));
