/** Real Chrome preview lifecycle: init-only media fails; playable media presents a frame. */
import Assert from 'node:assert/strict';
import {mkdir, cp, readFile, writeFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const Root = fileURLToPath(new URL('../../', import.meta.url));
const Artifact = Path.join(Root, 'artifacts/preview-terminal/chrome-' + Date.now());
await mkdir(Artifact, {recursive: true});
const ExtensionPath = Path.join(Artifact, 'extension');
await cp(Path.join(Root, 'extension'), ExtensionPath, {recursive: true});
const {chromium} = await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE ||
	Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {
	executablePath: process.env.MDOWNLOADER_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
	headless: true, ignoreDefaultArgs: ['--disable-extensions'],
	args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
});
const Report = {isolatedProfile: true, computerUse: false};
try
{
	const CDP = await Context.browser().newBrowserCDPSession();
	const {id} = await CDP.send('Extensions.loadUnpacked', {path: ExtensionPath});
	const Page = await Context.newPage();
	await Page.goto(`chrome-extension://${id}/options.html`);
	await Page.waitForTimeout(700);
	const Film = await readFile(Path.join(Root, 'website/sample/media/sample-film.mp4'));
	let Init;
	if (process.argv[2])
	{
		Init = await readFile(Path.resolve(process.argv[2]));
	}
	else
	{
		const Pieces = [];
		for (let Offset = 0; Offset + 8 <= Film.length;)
		{
			const Size = Film.readUInt32BE(Offset), Type = Film.toString('ascii', Offset + 4, Offset + 8);
			if (Size < 8 || Offset + Size > Film.length) throw Error('Invalid fixture MP4 box');
			if (['ftyp', 'moov'].includes(Type)) Pieces.push(Film.subarray(Offset, Offset + Size));
			Offset += Size;
		}
		Init = Buffer.concat(Pieces);
	}
	await Page.evaluate(async ({Init, Film}) =>
	{
		const {CreateMediaPreview} = await import('./media-preview.js');
		const {PreviewTile} = await import('./media-thumbnails.js');
		const Main = document.createElement('main');
		document.body.replaceChildren(Main);
		document.body.className = 'popup';
		const Playback = CreateMediaPreview();
		globalThis.PreviewChecks = {};
		const Canvas = document.createElement('canvas');
		Canvas.width = 128; Canvas.height = 72;
		Canvas.getContext('2d').fillRect(0, 0, 128, 72);
		for (const [Name, Bytes] of Object.entries({init: Init, playable: Film}))
		{
			const States = [];
			const Preview = {attach(...Args)
			{
				const ReportState = Args[4];
				Args[4] = State => {States.push(State); ReportState(State);};
				Playback.attach(...Args);
			}};
			const Tile = PreviewTile(Preview, async () => ({format: 'MP4',
				file: new Blob([Uint8Array.from(atob(Bytes), Char => Char.charCodeAt(0))], {type: 'video/mp4'})}));
			Tile.control.id = Name;
			const Row = document.createElement('div'); Row.className = 'candidate';
			const Label = document.createElement('strong'); Label.textContent = Name;
			Row.append(Tile.control, Label); Main.append(Row);
			await Tile.show({still: Canvas.toDataURL('image/jpeg')});
			PreviewChecks[Name] = States;
		}
	}, {Init: Init.toString('base64'), Film: Film.toString('base64')});
	await Page.locator('#init').hover();
	await Page.waitForFunction(() => PreviewChecks.init.includes('failed'), undefined, {timeout: 5000});
	Report.init = await Page.evaluate(() => ({states: PreviewChecks.init,
		loading: document.querySelectorAll('.preview-loading').length,
		failed: !document.querySelector('#init .candidate-preview-stale').hidden,
		players: document.querySelectorAll('#preview-media video').length}));
	Assert.deepEqual(Report.init, {states: ['loading', 'failed'], loading: 0, failed: true, players: 0});
	await Page.screenshot({path: Path.join(Artifact, 'init-failed.png')});
	await Page.locator('#playable').hover();
	await Page.waitForFunction(() => PreviewChecks.playable.includes('playing'), undefined, {timeout: 5000});
	Report.playable = await Page.evaluate(() => {
		const Video = document.querySelector('#preview-media video');
		return {states: PreviewChecks.playable, loading: document.querySelectorAll('.preview-loading').length,
			failed: !document.querySelector('#playable .candidate-preview-stale').hidden,
			width: Video?.videoWidth, height: Video?.videoHeight};
	});
	Assert.deepEqual(Report.playable.states, ['loading', 'playing']);
	Assert.equal(Report.playable.loading, 0);
	Assert.equal(Report.playable.failed, false);
	Assert.ok(Report.playable.width > 0 && Report.playable.height > 0);
	await Page.screenshot({path: Path.join(Artifact, 'playable.png')});
	Report.passed = true;
}
catch (ErrorValue) {Report.error = ErrorValue.stack; process.exitCode = 1;}
finally
{
	await writeFile(Path.join(Artifact, 'result.json'), JSON.stringify(Report, null, 2));
	console.log(JSON.stringify({artifact: Artifact, ...Report}, null, 2));
	await Context.close();
}
