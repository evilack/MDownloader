/**
 * 확장 촬영의 공통 실행 엔진입니다. 언어·캡처 대상·크기만 프리셋으로
 * 주입하고 확장 복제, 새 프로필, 실제 다운로드 검증, 파일 해시·브라우저 정리를 공유합니다.
 * 확장 내부 페이지 접근이 금지된 세션에서는 실행하지 않습니다. 실제 촬영 검증은 해당 실행의 결과로 판단합니다.
 */
import Assert from 'node:assert/strict';
import {cp as Cp, mkdir as Mkdir, mkdtemp as Mkdtemp, readFile as ReadFile, writeFile as WriteFile} from 'node:fs/promises';
import {createHash as CreateHash} from 'node:crypto';
import {tmpdir as Tmpdir} from 'node:os';
import Path from 'node:path';
import {setTimeout as Delay} from 'node:timers/promises';
import {ToolConfig, ProjectPath, PreviewUrl, BrowserOptions, LoadBrowserAutomation} from './tool-config.mjs';
export const CapturePresets = Object.freeze({
	aligned: {locale: 'ko', sample: true, popup: true, panelMedia: false, managers: [{name: 'downloads.png', width: 420, height: 280}]},
	english: {locale: 'en', sample: true, popup: true, panelMedia: false, managers: [{name: 'downloads.png', width: 420, height: 280}]},
	manager: {locale: 'ko', sample: false, popup: false, panelMedia: false, managers: [
			{name: 'downloads-wide.png', width: 760, height: 460},
			{name: 'downloads-wide-cropped.png', width: 760, height: 460, crop: true},
			{name: 'downloads-mobile.png', width: 360, height: 460, crop: true},
		]},
	website: {locale: 'ko', sample: true, popup: true, panelMedia: true, nativePanel: true,
		managers: [{name: 'extension-downloads.png', width: 1100, height: 950}, {name: 'extension-downloads-crop.png', width: 1100, height: 950, crop: true}]},
});
const CapturePolicy = Object.freeze({attempts: 50, pollMs: 100, settleMs: 700, timeoutMs: 15000, downloadPollMs: 200,
	sampleWidth: 960, sampleHeight: 1100, sampleInsetPx: 20});
export function CapturePlan(Preset, Artifact = ToolConfig.artifacts)
{
	if (!Object.hasOwn(CapturePresets, Preset))
	{
		throw new TypeError('Unknown capture preset');
	}
	return {...CapturePresets[Preset], name: Preset, output: ProjectPath('artifacts', Artifact, 'captures', Preset),
		evidence: ProjectPath('artifacts', Artifact, 'captures', Preset, 'metadata')};
}

export async function CaptureExtension(Preset)
{
	const Plan = CapturePlan(Preset);
	await Promise.all([Mkdir(Plan.output, {recursive: true}), Mkdir(Plan.evidence, {recursive: true})]);
	const Scratch = await Mkdtemp(Path.join(Tmpdir(), 'mdownloader-capture-'));
	const ExtensionPath = Path.join(Scratch, 'extension');
	await Cp(ProjectPath('extension'), ExtensionPath, {recursive: true});
	const ManifestBytes = await ReadFile(Path.join(ExtensionPath, 'manifest.json'));
	const Hash = Bytes => CreateHash('sha256').update(Bytes).digest('hex');
	const Automation = await LoadBrowserAutomation();
	const Browser = await Automation.launch({...BrowserOptions, headless: false, pipe: true, userDataDir: Path.join(Scratch, 'profile'),
		enableExtensions: [ExtensionPath], targetFilter: () => true, defaultViewport: {width: 1100, height: 950, deviceScaleFactor: 1}});
	const Audit = {capturedAt: new Date().toISOString(), version: JSON.parse(ManifestBytes).version, scratch: Scratch,
		manifestSha256: Hash(ManifestBytes), source: 'Actual isolated unpacked extension and local sample download', files: []};
	async function Capture(Page, Name, Options = {})
	{
		const Bytes = await Page.screenshot({...Options, path: Path.join(Plan.output, Name)});
		Audit.files.push({name: Name, bytes: Bytes.length, sha256: Hash(Bytes)});
	}
	try
	{
		let Extension;
		for (let Attempt = 0; Attempt < CapturePolicy.attempts && !Extension; Attempt++)
		{
			Extension = [...(await Browser.extensions()).values()].find(Item => Item.name === 'MDownloader');
			if (!Extension)
			{
				await Delay(CapturePolicy.pollMs);
			}
		}
		Assert.ok(Extension, 'The actual unpacked extension must be loaded');
		const ExtensionRoot = `chrome-extension://${Extension.id}/`;
		const Options = await Browser.newPage();
		await Options.goto(ExtensionRoot + 'options.html');
		await Options.evaluate(({locale: Locale, panelMedia: bPanelMedia}) => chrome.storage.local.set({language: Locale, showPanelMedia: bPanelMedia}), Plan);
		const Sample = await Browser.newPage();
		await Sample.goto(PreviewUrl('sample/?lang=' + Plan.locale), {waitUntil: 'networkidle0'});
		await Sample.waitForFunction(() => document.querySelector('video')?.currentTime > 0.1);
		if (Plan.sample)
		{
			await Sample.setViewport({width: CapturePolicy.sampleWidth, height: CapturePolicy.sampleHeight, deviceScaleFactor: 1});
			const Clip = await Sample.evaluate(Inset =>
			{
				const Top = Math.floor(document.querySelector('header').getBoundingClientRect().bottom);
				return {x: 0, y: Top, width: innerWidth, height: Math.ceil(document.querySelector('.player').getBoundingClientRect().bottom + Inset) - Top};
			}, CapturePolicy.sampleInsetPx);
			await Capture(Sample, Plan.nativePanel ? 'sample-page.png' : 'sample-page-v3.png', {clip: Clip});
		}
		await Sample.bringToFront();
		await Extension.triggerAction(Sample);
		const Popup = await (await Browser.waitForTarget(Target => Target.url() === ExtensionRoot + 'popup.html')).asPage();
		await Popup.waitForSelector('.candidate button.primary');
		if (Plan.popup)
		{
			await Delay(CapturePolicy.settleMs);
			await Capture(Popup, Plan.nativePanel ? 'extension-popup.png' : 'media-list.png');
		}
		await Popup.locator('.candidate button.primary').click();
		await Options.waitForFunction(async () => (await chrome.downloads.search({})).some(Item => Item.state === 'complete'), {timeout: CapturePolicy.timeoutMs, polling: CapturePolicy.downloadPollMs});
		const Downloads = await Options.evaluate(async () => (await chrome.downloads.search({})).map(Item => ({filename: Item.filename, url: Item.url, state: Item.state, bytesReceived: Item.bytesReceived})));
		const Download = Downloads.find(Item => Item.state === 'complete' && Item.url === PreviewUrl('sample/media/sample-film.mp4'));
		Assert.ok(Download);
		Audit.sourceSha256 = Hash(await ReadFile(ProjectPath('website/sample/media/sample-film.mp4')));
		Audit.downloadSha256 = Hash(await ReadFile(Download.filename));
		Assert.equal(Audit.sourceSha256, Audit.downloadSha256);
		let Manager;
		if (Plan.nativePanel)
		{
			await Popup.click('#manage');
			Manager = await (await Browser.waitForTarget(Target => Target.url() === ExtensionRoot + 'sidepanel.html')).asPage();
		}
		else
		{
			Manager = await Browser.newPage();
		}
		for (const View of Plan.managers)
		{
			await Manager.setViewport({width: View.width, height: View.height, deviceScaleFactor: 1});
			if (!Plan.nativePanel && Manager.url() !== ExtensionRoot + 'sidepanel.html')
			{
				await Manager.goto(ExtensionRoot + 'sidepanel.html', {waitUntil: 'networkidle0'});
			}
			await Manager.waitForSelector('#complete li');
			await Delay(CapturePolicy.settleMs);
			const Clip = View.crop ? await Manager.evaluate(() => ({x: 0, y: 0, width: innerWidth, height: Math.min(innerHeight, Math.ceil(document.querySelector('main').getBoundingClientRect().bottom + 24))})) : undefined;
			await Capture(Manager, View.name, Clip ? {clip: Clip} : {});
		}
		return Audit;
	}
	catch (ErrorValue)
	{
		Audit.failed = true;
		throw ErrorValue;
	}
	finally
	{
		try
		{
			await WriteFile(Path.join(Plan.evidence, 'capture.json'), JSON.stringify(Audit, null, 2));
		}
		finally
		{
			await Browser.close();
		}
	}
}
