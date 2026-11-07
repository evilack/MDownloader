import Assert from 'node:assert/strict';
import { mkdir as Mkdir, writeFile as WriteFile } from 'node:fs/promises';
import { createHash as CreateHash } from 'node:crypto';
import { setTimeout as Delay } from 'node:timers/promises';
import {ToolConfig, ProjectPath, PreviewUrl, BrowserOptions, LoadBrowserAutomation} from '../lib/tool-config.mjs';
const Puppeteer = await LoadBrowserAutomation();
const Language = process.argv[2] === 'en' ? 'en' : 'ko';
const Evidence = ProjectPath('artifacts', ToolConfig.artifacts, 'verify-motion', Language);
await Mkdir(Evidence, {recursive: true});
const Browser = await Puppeteer.launch({ ...BrowserOptions,
	headless: true, pipe: true, defaultViewport: { width: 1440, height: 1100 } });
try
{
	const Page = await Browser.newPage();
	await Page.goto(ToolConfig.previewUrl + '?lang=' + Language, { waitUntil: 'networkidle0' });
	const GifResponse = await fetch(await Page.$eval('#sample-motion', Image => Image.dataset.animatedSrc && new URL(Image.dataset.animatedSrc, location.href).href));
	Assert.equal(GifResponse.headers.get('content-type'), 'image/gif');
	await Page.waitForFunction(() =>
	{
		const Image = document.querySelector('#sample-motion');
		return Image.src.endsWith('.gif') && Image.complete;
	});
	const Image = await Page.$('#sample-motion');
	const Hash = Bytes => CreateHash('sha256').update(Bytes).digest('hex');
	const First = Hash(await Image.screenshot());
	await Delay(650);
	const Second = Hash(await Image.screenshot());
	Assert.notEqual(First, Second, 'GIF must visibly advance in the live browser');
	await Page.locator('.capture-motion-toggle').click();
	await Page.waitForFunction(() => document.querySelector('#sample-motion').src.endsWith('sample-still.png') && document.querySelector('#sample-motion').complete);
	// 이미지 디코딩과 부드러운 스크롤이 끝난 뒤 픽셀을 비교합니다. 클릭·촬영이 스크롤 중간에 겹치지 않게 합니다.
	await Image.evaluate(async Image =>
	{
		await Image.decode();
		Image.scrollIntoView({ behavior: 'instant', block: 'center' });
		await new Promise(Resolve => requestAnimationFrame(() => requestAnimationFrame(Resolve)));
	});
	const PausedFirst = Hash(await Image.screenshot());
	await Delay(650);
	const PausedSecond = Hash(await Image.screenshot());
	Assert.equal(PausedFirst, PausedSecond, 'Paused image must remain static');
	await Page.locator('.capture-motion-toggle').click();
	await Page.waitForFunction(() => document.querySelector('#sample-motion').src.endsWith('.gif'));
	await Page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
	await Page.waitForFunction(() => document.querySelector('#sample-motion').src.endsWith('sample-still.png'));
	await Page.reload({ waitUntil: 'networkidle0' });
	Assert.ok(await Page.$eval('#sample-motion', Image => Image.src.endsWith('sample-still.png')));
	await Page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
	await Page.waitForFunction(() => document.querySelector('#sample-motion').src.endsWith('.gif'));
	const Result = { checkedAt: new Date().toISOString(), gifContentType: GifResponse.headers.get('content-type'),
		visiblyAnimates: First !== Second, pauseStable: PausedFirst === PausedSecond, resume: true,
		reducedMotionOnChange: true, reducedMotionOnLoad: true };
	await WriteFile(`${Evidence}/browser-verification.json`, JSON.stringify(Result, null, 2));
	console.log(JSON.stringify(Result));
}
finally
{
	await Browser.close();
}
