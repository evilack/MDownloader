import Assert from 'node:assert/strict';
import { mkdir as Mkdir, writeFile as WriteFile } from 'node:fs/promises';
import {ToolConfig, ProjectPath, PreviewUrl, BrowserOptions, LoadBrowserAutomation} from '../lib/tool-config.mjs';
const Puppeteer = await LoadBrowserAutomation();
const Base = ToolConfig.previewUrl + '';
const Output = ProjectPath('artifacts', ToolConfig.artifacts, 'verify-site-languages');
await Mkdir(Output, { recursive: true });
const Families = [
	{ name: 'product', en: 'index.html', ko: 'index-ko.html' },
	{ name: 'sample', en: 'sample/index.html', ko: 'sample/index-ko.html' },
];
const Browser = await Puppeteer.launch({ ...BrowserOptions, headless: true, pipe: true });
const Audit = [];
try
{
	const Context = await Browser.createBrowserContext();
	const Page = await Context.newPage();
	const Errors = [];
	Page.on('pageerror', Error => Errors.push(Error.message));
	for (const Family of Families)
	{
		for (const Lang of ['en', 'ko'])
		{
			for (const Width of [1440, 390, 320])
			{
				await Page.setViewport({ width: Width, height: 1050, deviceScaleFactor: 1 });
				await Page.goto(Base + Family[Lang] + '?lang=' + Lang, { waitUntil: 'networkidle0' });
				const Result = await Page.evaluate(() => ({
					lang: document.documentElement.lang, title: document.title, body: document.body.innerText,
					overflow: document.documentElement.scrollWidth - innerWidth,
					missingImages: [...document.images].filter(Image => !Image.complete || !Image.naturalWidth).map(Image => Image.src),
					switchHref: document.querySelector('.language-link')?.getAttribute('href'),
					paypal: document.querySelector('#paypal-support')?.href,
				}));
				Assert.equal(Result.lang, Lang, Family.name + ' document language');
				Assert.equal(Result.overflow, 0, Family.name + ' horizontal overflow at ' + Width);
				Assert.ok(Result.switchHref, 'Every page has a native language switch');
				if (Family.name === 'product')
				{
					Assert.equal(await Page.$eval('.support-nav', Link => Link.href), 'https://evilack.github.io/donate.html');
					Assert.equal(await Page.$eval('.support-banner a', Link => Link.href), 'https://evilack.github.io/donate.html');
				}
				Assert.equal(await Page.$$eval('a[href]', Links => Links.filter(Link => Link.href.includes('cabinet-preview')).length), 0, 'No links to deleted preview pages');
				Assert.equal(await Page.$eval('link[hreflang="x-default"]', Link => Link.getAttribute('href')), Family.en.split('/').at(-1));
				Assert.equal(await Page.$eval('link[hreflang="en"]', Link => Link.getAttribute('href')), Family.en.split('/').at(-1));
				if (Lang === 'en')
				{
					Assert.ok(!/[가-힣]/.test(Result.body.replaceAll('한국어', '')), Family.name + ' has untranslated visible text');
				}
				Assert.deepEqual(Result.missingImages, []);
				if (Family.name === 'product' && Lang === 'en')
				{
					Assert.ok(await Page.$eval('#sample-motion', Image => Image.src.includes('/en/')));
					Assert.equal(await Page.$eval('.capture-motion-toggle', Button => Button.textContent), 'Pause');
					await Page.click('.capture-motion-toggle');
					Assert.equal(await Page.$eval('.capture-motion-toggle', Button => Button.textContent), 'Play');
					await Page.click('[data-store="chrome"]');
					Assert.ok((await Page.$eval('#notice-dialog', Element => Element.innerText)).includes('Chrome Web Store'));
					Assert.ok(!/[가-힣]/.test(await Page.$eval('#notice-dialog', Element => Element.innerText)));
					await Page.click('.dialog-confirm');
					for (const Image of await Page.$$('.capture-figure img'))
					{
						Assert.ok(await Image.evaluate(Image => Math.abs(Image.getBoundingClientRect().width / Image.getBoundingClientRect().height - Image.naturalWidth / Image.naturalHeight) < .005), 'Capture proportions match the actual image');
					}
				}
				if (Lang === 'en' && Width !== 390 && Family.name !== 'sample')
				{
					await Page.screenshot({ path: `${Output}/${Family.name}-en-${Width}.png`, fullPage: true });
				}
				delete Result.body;
				Audit.push({ page: Family.name, lang: Lang, width: Width, ...Result });
			}
		}
	}
	// 한 페이지에서 선택한 언어는 사이트 안의 다른 경로에서도 유지되어야 합니다.
	await Page.goto(Base + 'index.html?lang=en', { waitUntil: 'networkidle0' });
	await Promise.all([Page.waitForNavigation({ waitUntil: 'networkidle0' }), Page.click('.language-link')]);
	Assert.equal(await Page.$eval('html', Html => Html.lang), 'ko');
	for (const Family of Families)
	{
		await Page.goto(Base + Family.en, { waitUntil: 'networkidle0' });
		Assert.equal(await Page.$eval('html', Html => Html.lang), 'ko');
		Assert.equal(new URL(Page.url()).pathname, '/' + Family.ko);
	}
	Assert.deepEqual(Errors, []);
	await Context.close();
	// 스크립트를 끄면 모든 기본 URL은 영어 원문과 정상 링크를 제공해야 합니다.
	const Plain = await Browser.createBrowserContext();
	const Native = await Plain.newPage();
	await Native.setJavaScriptEnabled(false);
	for (const Family of Families)
	{
		await Native.goto(Base + Family.en, { waitUntil: 'networkidle0' });
		Assert.equal(await Native.$eval('html', Html => Html.lang), 'en');
	}
	await Plain.close();
	await WriteFile(`${Output}/verification.json`, JSON.stringify({ checkedAt: new Date().toISOString(),
		views: Audit.length, crossPagePreference: true, noScriptDefaultEnglish: true, errors: Errors, audit: Audit }, null, 2));
	console.log(JSON.stringify({ views: Audit.length, crossPagePreference: true, noScriptDefaultEnglish: true, errors: Errors }));
}
finally
{
	await Browser.close();
}
