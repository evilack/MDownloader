/** Real Naver Clip detection and direct download in a disposable profile; never attaches to the user's browser. */
import Assert from 'node:assert/strict';
import {mkdir, writeFile, readFile, cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const Root = fileURLToPath(new URL('../../', import.meta.url));
const Artifact = Path.join(Root, 'artifacts/naver-clip/chrome-' + Date.now());
const Downloads = Path.join(Artifact, 'downloads');
await mkdir(Downloads, {recursive: true});
const TestExtension = Path.join(Artifact, 'extension');
await cp(Path.join(Root, 'extension'), TestExtension, {recursive: true});
const Manifest = JSON.parse(await readFile(Path.join(TestExtension, 'manifest.json'), 'utf8'));
const Hosts = ['https://m.naver.com/*', 'https://clip.naver.com/*'];
Manifest.host_permissions.push(...Hosts);
await writeFile(Path.join(TestExtension, 'manifest.json'), JSON.stringify(Manifest, null, 2));
const {chromium} = await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE ||
	Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {
	executablePath: process.env.MDOWNLOADER_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
	headless: true, ignoreDefaultArgs: ['--disable-extensions'],
	args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
});
const Seed = '8FE4B3731735D2AB0B33346FF3FB11FE605A';
const Address = `https://m.naver.com/shorts/?seedMediaId=${Seed}&serviceType=CLIP`;
const Report = {computerUse: false, isolatedProfile: true, testOnlyPageHosts: Hosts, cdnPermissionAdded: false, source: Address};
function Progress(Stage) {console.log(Stage);}
try
{
	const Browser = await Context.browser().newBrowserCDPSession();
	Report.browser = (await Browser.send('Browser.getVersion')).product;
	await Browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: Downloads, eventsEnabled: true});
	const {id} = await Browser.send('Extensions.loadUnpacked', {path: TestExtension});
	const Extension = await Context.newPage();
	await Extension.goto(`chrome-extension://${id}/options.html`);
	await Extension.evaluate(async Hosts =>
	{
		if (!await chrome.permissions.contains({origins: Hosts})) throw Error('Test page permissions missing');
		await chrome.storage.local.set({language: 'ko', useDownloadDateTime: false, usePageTitle: false,
			notifyDownloadComplete: false, subtitleTranslation: {enabled: false}});
	}, Hosts);
	Progress('Loaded isolated extension with page-only test access');
	const Clip = await Context.newPage();
	await Clip.goto(Address, {waitUntil: 'domcontentloaded'});
	await Clip.waitForFunction(() => document.querySelector('video')?.readyState >= 2, {timeout: 30000});
	await Clip.bringToFront();
	const TabId = await Extension.evaluate(async () => (await chrome.tabs.query({url: 'https://m.naver.com/shorts/*'}))[0].id);
	async function Scan()
	{
		return Extension.evaluate(async TabId =>
		{
			const {Scan, ResolveCandidate} = await import('./detection.js');
			const Result = await Scan(TabId, 'naver-probe');
			globalThis.NaverProbeScan = Result;
			const Items = await Promise.all((Result.candidates || []).map(async Item =>
			{
				const Resolved = await ResolveCandidate(TabId, Result.scanId, Item.id, 'naver-probe');
				return {...Item, width: Resolved.width, height: Resolved.height, url: Resolved.url.split('?')[0]};
			}));
			return {restricted: Result.restricted, count: Items.length, items: Items};
		}, TabId);
	}
	Report.initial = await Scan();
	Progress('Initial scan: ' + Report.initial.count + ' candidates');
	Assert.equal(Report.initial.count, 3, JSON.stringify(Report.initial));
	Assert.deepEqual(Report.initial.items.map(Item => `${Item.width}x${Item.height}`), ['720x1280', '480x854', '360x640']);
	Assert.ok(Report.initial.items.every(Item => Item.url.includes('/' + Seed + '/') && Item.format === 'MP4' && !Item.serverPermission));
	Report.repeat = await Scan();
	Assert.deepEqual(Report.repeat.items.map(Item => Item.mediaKey), Report.initial.items.map(Item => Item.mediaKey));
	Report.previews = await Extension.evaluate(async TabId =>
	{
		const {CandidatePreviews, PreviewCandidate, ResolveCandidate, ReadCandidateThumbnail} = await import('./detection.js');
		const Input = {tabId: TabId, scanId: globalThis.NaverProbeScan.scanId, scope: 'naver-probe'};
		const Tiles = await CandidatePreviews({...Input, candidateIds: [0, 1, 2]});
		const Hovers = [], Jobs = [];
		for (const CandidateId of [0, 1, 2])
		{
			Hovers.push((await PreviewCandidate({...Input, candidateId: CandidateId})).resolution);
			const Candidate = await ResolveCandidate(TabId, Input.scanId, CandidateId, Input.scope);
			Jobs.push((await ReadCandidateThumbnail(TabId, Candidate)).resolution);
		}
		globalThis.NaverPreviewTiles = Tiles;
		return {tiles: Tiles.map(Item => Item.resolution), hover: Hovers, jobs: Jobs};
	}, TabId);
	const ExpectedDimensions = [{width: 720, height: 1280}, {width: 480, height: 854}, {width: 360, height: 640}];
	for (const Resolutions of Object.values(Report.previews)) Assert.deepEqual(Resolutions, ExpectedDimensions);
	Report.previewUI = await Extension.evaluate(async () =>
	{
		const {PreviewTile} = await import('./media-thumbnails.js');
		const Style = document.createElement('link');
		Style.rel = 'stylesheet'; Style.href = chrome.runtime.getURL('style.css'); document.head.append(Style);
		const Container = document.createElement('main');
		Container.style.cssText = 'display:flex;gap:32px;padding:40px;';
		for (const Source of globalThis.NaverPreviewTiles)
		{
			const Tile = PreviewTile({attach() {}}, async () => Source);
			Container.append(Tile.control);
			await Tile.show(Source);
		}
		document.body.replaceChildren(Container);
		return [...Container.querySelectorAll('.candidate-preview-resolution')].map(Node => ({text: Node.textContent, hidden: Node.hidden}));
	});
	Assert.deepEqual(Report.previewUI, ['720×1280', '480×854', '360×640'].map(Text => ({text: Text, hidden: false})));
	await Extension.bringToFront();
	await Extension.screenshot({path: Path.join(Artifact, 'preview-resolutions.png')});
	await Clip.bringToFront();
	Progress('Verified thumbnail, hover and job resolution metadata and visible tile labels');
	if (!process.argv.includes('--preview-only'))
	{
	const RequestId = await Extension.evaluate(async TabId =>
	{
		const {Enqueue} = await import('./jobs.js');
		const requestId = crypto.randomUUID();
		const Result = await Enqueue({tabId: TabId, scanId: globalThis.NaverProbeScan.scanId,
			candidateId: globalThis.NaverProbeScan.candidates[0].id, requestId, scope: 'naver-probe'});
		if (Result.state !== 'started') throw Error('Direct job did not start');
		return requestId;
	}, TabId);
	Progress('Started actual direct download');
	let Saved;
	for (let Attempt = 0; Attempt < 120; Attempt++)
	{
		Saved = await Extension.evaluate(async RequestId =>
		{
			const Job = (await chrome.storage.local.get('job:' + RequestId))['job:' + RequestId];
			const [Item] = Job?.downloadId !== undefined ? await chrome.downloads.search({id: Job.downloadId}) : [];
			return Item && {state: Item.state, error: Item.error, bytes: Item.bytesReceived, filename: Item.filename};
		}, RequestId);
		if (Saved && Saved.state !== 'in_progress') break;
		await new Promise(Resolve => setTimeout(Resolve, 500));
	}
	Assert.equal(Saved?.state, 'complete', JSON.stringify(Saved));
	const Relative = Path.relative(Downloads, Saved.filename);
	Assert.ok(Relative && !Relative.startsWith('..') && !Path.isAbsolute(Relative), 'download must stay in the isolated artifact directory');
	const Bytes = await readFile(Saved.filename);
	Report.download = {...Saved, bytes: Bytes.length, sha256: createHash('sha256').update(Bytes).digest('hex')};
	Progress('Saved ' + Bytes.length + ' bytes');
	Assert.ok(Bytes.length > 1000000);
	Assert.equal(Bytes.subarray(4, 8).toString(), 'ftyp');
	const Media = await Context.newPage();
	await Media.goto(pathToFileURL(Saved.filename).href);
	await Media.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
	Report.savedMedia = await Media.evaluate(async () =>
	{
		const Video = document.querySelector('video');
		Video.muted = true;
		await Video.play();
		await new Promise(Resolve => setTimeout(Resolve, 700));
		Video.currentTime = Video.duration - 2;
		await new Promise(Resolve => Video.addEventListener('seeked', Resolve, {once: true}));
		return {width: Video.videoWidth, height: Video.videoHeight, duration: Video.duration,
			endPosition: Video.currentTime, audioBytes: Video.webkitAudioDecodedByteCount, error: Video.error?.code};
	});
	Assert.equal(Report.savedMedia.width, 720);
	Assert.equal(Report.savedMedia.height, 1280);
	Assert.ok(Report.savedMedia.duration > 78 && Report.savedMedia.endPosition > 76 && Report.savedMedia.audioBytes > 0);
	await Media.close();
	await Clip.bringToFront();
	await Extension.evaluate(() => {globalThis.NaverOldScan = globalThis.NaverProbeScan;});
	await Clip.mouse.move(650, 400);
	await Clip.mouse.wheel(0, 650);
	await Clip.waitForFunction(Seed => new URL(location.href).searchParams.get('seedMediaId') !== Seed &&
		document.querySelector('video')?.readyState >= 2, Seed, {timeout: 15000});
	await Clip.waitForTimeout(1000);
	Report.navigation = {page: Clip.url(), ...await Scan()};
	Progress('Navigation scan: ' + Report.navigation.count + ' candidates');
	const NextId = new URL(Clip.url()).searchParams.get('seedMediaId');
	Assert.ok(Report.navigation.count > 0 && Report.navigation.items.every(Item => Item.url.includes('/' + NextId + '/')));
	Report.oldCandidateRejected = await Extension.evaluate(async TabId =>
	{
		try
		{
			const {ResolveCandidate} = await import('./detection.js');
			await ResolveCandidate(TabId, globalThis.NaverOldScan.scanId, 0, 'naver-probe');
			return false;
		}
		catch {return true;}
	}, TabId);
	Assert.equal(Report.oldCandidateRejected, true);
	await Clip.goto(`https://clip.naver.com/contents?seedMediaId=${Seed}&serviceType=CLIP`, {waitUntil: 'domcontentloaded'});
	await Clip.waitForTimeout(3000);
	await Clip.bringToFront();
	if (await Clip.evaluate(() => document.querySelector('video')?.readyState >= 2))
	{
		Report.desktop = {page: Clip.url(), ...await Scan()};
		Assert.equal(Report.desktop.count, 3);
	}
	else Report.desktop = {page: Clip.url(), siteError: await Clip.evaluate(() => document.body.innerText.slice(0, 200)), verified: false};
	}
	Report.passed = true;
	await writeFile(Path.join(Artifact, 'result.json'), JSON.stringify(Report, null, 2));
	console.log(JSON.stringify({artifact: Artifact, ...Report}, null, 2));
}
catch (ErrorValue)
{
	Report.error = String(ErrorValue.message).slice(0, 3000);
	await writeFile(Path.join(Artifact, 'result.json'), JSON.stringify(Report, null, 2));
	console.error(JSON.stringify({artifact: Artifact, ...Report}, null, 2));
	process.exitCode = 1;
}
finally {await Context.close();}
