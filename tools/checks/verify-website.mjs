import Assert from 'node:assert/strict';
import { mkdir as Mkdir, writeFile as WriteFile } from 'node:fs/promises';
import {ToolConfig, ProjectPath, PreviewUrl, BrowserOptions, LoadBrowserAutomation} from '../lib/tool-config.mjs';
const Puppeteer = await LoadBrowserAutomation();
const Output = ProjectPath('artifacts', ToolConfig.artifacts, 'verify-website');
await Mkdir(Output, { recursive: true });
const Browser = await Puppeteer.launch({ ...BrowserOptions,
	headless: true, pipe: true, defaultViewport: { width: 1440, height: 1100, deviceScaleFactor: 1 } });
const Audit = [];
try
{
	const Page = await Browser.newPage();
	const Errors = [];
	Page.on('pageerror', Error => Errors.push(Error.message));
	for (const [Name, Width, Height, Scheme] of [['desktop', 1440, 1100, 'light'], ['desktop-dark', 1440, 1100, 'dark'], ['tablet', 900, 1000, 'light'], ['mobile', 390, 844, 'light'], ['mobile-small', 320, 800, 'dark']])
	{
		await Page.setViewport({ width: Width, height: Height, deviceScaleFactor: 1 });
		await Page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: Scheme }]);
		await Page.goto(ToolConfig.previewUrl + '?lang=ko', { waitUntil: 'networkidle0' });
		const Result = await Page.evaluate(() => ({
			viewport: innerWidth, contentWidth: document.documentElement.scrollWidth,
			label: document.querySelector('.preview-label').textContent,
			fakeCount: document.querySelectorAll('.demo-window,.landscape,.download-panel').length,
			images: [...document.querySelectorAll('.capture-figure img')].map(Image => ({
				src: Image.getAttribute('src'), loaded: Image.complete && Image.naturalWidth > 0,
				naturalWidth: Image.naturalWidth, naturalHeight: Image.naturalHeight,
				width: Image.getBoundingClientRect().width, height: Image.getBoundingClientRect().height,
				left: Image.getBoundingClientRect().left, top: Image.getBoundingClientRect().top,
			})),
		}));
		Assert.equal(Result.contentWidth, Result.viewport, `${Name}: no horizontal overflow`);
		Assert.equal(Result.label, '실제 실행 화면');
		Assert.equal(Result.fakeCount, 0);
		Assert.equal(Result.images.length, 3);
		Assert.ok(Result.images.every(Image => Image.loaded));
		for (const Image of Result.images)
		{
			Assert.ok(Math.abs(Image.width / Image.height - Image.naturalWidth / Image.naturalHeight) < 0.01);
		}
		const [Sample, Popup, Manager] = Result.images;
		Assert.ok(Popup.width <= 420 && Manager.width <= 420, Name + ': native screenshot width cap');
		Assert.ok(Math.abs(Popup.width - Manager.width) < 1, Name + ': matching extension widths');
		if (Width > 1000)
		{
			Assert.ok(Math.abs(Sample.top - Popup.top) < 1);
			Assert.ok(Math.abs(Popup.left - Manager.left) < 1);
		}
		await (await Page.$('.showcase')).screenshot({ path: `${Output}/homepage-${Name}.png` });
		Audit.push({ name: Name, scheme: Scheme, ...Result });
	}
	Assert.deepEqual(Errors, []);
	await WriteFile(`${Output}/website-verification.json`, JSON.stringify({ checkedAt: new Date().toISOString(), audit: Audit, errors: Errors }, null, 2));
	console.log(JSON.stringify({ passed: Audit.length, audit: Audit, errors: Errors }));
}
finally
{
	await Browser.close();
}
