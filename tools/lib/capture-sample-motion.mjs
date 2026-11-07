/** 언어와 출력 위치만 데이터로 받아 동일한 실제 샘플 화면 수집 절차를 사용합니다.
 * 스크린샷 원본·실제 재생 시각·해시를 함께 보존합니다. 이 도구는 일반 웹 페이지만 엽니다. */
import Assert from 'node:assert/strict';
import {mkdir as Mkdir, readFile as ReadFile, writeFile as WriteFile} from 'node:fs/promises';
import {createHash as CreateHash} from 'node:crypto';
import {setTimeout as Delay} from 'node:timers/promises';
import Path from 'node:path';
import {ToolConfig, ProjectPath, PreviewUrl, BrowserOptions, LoadBrowserAutomation} from './tool-config.mjs';
export const MotionPolicy = Object.freeze({fps: 8, frames: 23, startSeconds: 6.7, endSeconds: 10.03,
	viewport: Object.freeze({width: 960, height: 1100, deviceScaleFactor: 1}), clipInsetPx: 20});
export async function CaptureSampleMotion({locale: Locale = 'ko', output: Output = ProjectPath('artifacts', ToolConfig.artifacts, 'sample-motion', Locale)} = {})
{
	if (!['ko', 'en'].includes(Locale))
	{
		throw new TypeError('Unsupported website locale');
	}
	await Mkdir(Output, {recursive: true});
	const Automation = await LoadBrowserAutomation();
	const Browser = await Automation.launch({...BrowserOptions, headless: false, pipe: true, defaultViewport: MotionPolicy.viewport});
	const Audit = {capturedAt: new Date().toISOString(), source: 'Actual local sample playback screenshots',
		url: PreviewUrl('sample/?lang=' + Locale), fps: MotionPolicy.fps, frames: []};
	try
	{
		const Page = await Browser.newPage();
		await Page.goto(Audit.url, {waitUntil: 'networkidle0'});
		await Page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
		Audit.clip = await Page.evaluate(Inset =>
		{
			const Top = Math.floor(document.querySelector('header').getBoundingClientRect().bottom);
			return {x: 0, y: Top, width: innerWidth, height: Math.ceil(document.querySelector('.player').getBoundingClientRect().bottom + Inset) - Top};
		}, MotionPolicy.clipInsetPx);
		await Page.$eval('video', (Video, Seconds) =>
		{
			Video.pause();
			Video.loop = false;
			Video.currentTime = Seconds;
		}, MotionPolicy.startSeconds);
		await Page.waitForFunction(() => !document.querySelector('video').seeking);
		await Page.$eval('video', Video => Video.play());
		const Started = performance.now();
		for (let Index = 0; Index < MotionPolicy.frames; Index++)
		{
			const Remaining = Started + Index * 1000 / MotionPolicy.fps - performance.now();
			if (Remaining > 0)
			{
				await Delay(Remaining);
			}
			const State = await Page.$eval('video', Video => ({time: Video.currentTime, paused: Video.paused, ended: Video.ended, width: Video.videoWidth, height: Video.videoHeight}));
			Assert.equal(State.paused, false);
			Assert.ok(State.time >= MotionPolicy.startSeconds && State.time < MotionPolicy.endSeconds);
			const Name = `frame-${String(Index).padStart(3, '0')}.png`;
			const Bytes = await Page.screenshot({clip: Audit.clip});
			await WriteFile(Path.join(Output, Name), Bytes);
			Audit.frames.push({name: Name, ...State, capturedMs: Math.round(performance.now() - Started), sha256: CreateHash('sha256').update(Bytes).digest('hex')});
		}
		Assert.ok(Audit.frames.at(-1).time > Audit.frames[0].time + 2);
		Audit.videoSha256 = CreateHash('sha256').update(await ReadFile(ProjectPath('website/sample/media/sample-film.mp4'))).digest('hex');
		await WriteFile(Path.join(Output, 'capture.json'), JSON.stringify(Audit, null, 2));
		return Audit;
	}
	finally
	{
		await Browser.close();
	}
}
