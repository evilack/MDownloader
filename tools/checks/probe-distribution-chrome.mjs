/** 실제 Chrome + 별도 프로필에서 생성된 패키지의 차단과 일반 저장을 검사합니다.
 * 사용자 프로필/확장을 열거나 재로드하지 않습니다. */
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const Root = fileURLToPath(new URL('../../', import.meta.url));
const AutomationPath = process.env.MDOWNLOADER_PLAYWRIGHT_MODULE || Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs');
const {chromium} = await import(pathToFileURL(AutomationPath));
const Artifact = Path.join(Root, 'artifacts/youtube-implementation/native-' + Date.now());
await mkdir(Artifact, {recursive: true});
const Bytes = await readFile(Path.join(Root, 'website/sample/media/sample-film.mp4'));
let Hits = 0;
const Server = createServer((Request, Response) => {
 Hits++;
 if (Request.url === '/redirect') {Response.writeHead(302, {location: 'https://r1.googlevideo.com/distribution-policy-fixture'}); Response.end(); return;}
 Response.writeHead(200, {'content-type': 'video/mp4', 'content-length': Bytes.length}); Response.end(Bytes);
});
await new Promise(Resolve => Server.listen(0, '127.0.0.1', Resolve));
const Url = `http://127.0.0.1:${Server.address().port}/fixture.mp4`;
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {executablePath: process.env.MDOWNLOADER_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, acceptDownloads: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']});
try {
 const Browser = await Context.browser().newBrowserCDPSession();
 const Version = await Browser.send('Browser.getVersion');
 const {id} = await Browser.send('Extensions.loadUnpacked', {path: Path.join(Root, 'artifacts/distributions/chrome-store/extension')});
 const Page = await Context.newPage();
 await Page.goto(`chrome-extension://${id}/options.html`);
 const Result = await Page.evaluate(async ({url}) => {
  const Policy = await import('./lib/distribution-policy.js');
  const Source = await import('./lib/youtube-source-policy.js');
  const Jobs = await import('./jobs.js');
  const Http = await import('./lib/hls-http.js');
  const BrowserDownload = await import('./lib/browser-download.js');
  const Checks = [];
  await chrome.storage.local.set({youtubeEnabled: true, blockedBrowserFamilies: [], flavor: 'manual'});
  for (const operation of [() => BrowserDownload.DownloadNamedFile('https://r1.googlevideo.com/videoplayback', 'blocked.mp4'), () => Http.FetchMedia('https://r1.googlevideo.com/file.m3u8', new AbortController().signal), () => Jobs.EnqueuePlayback({requestId: crypto.randomUUID(), playlist: '#EXTM3U', count: 1, bytes: 1})]) {
   try {await operation(); Checks.push('unexpected-success');} catch (error) {Checks.push(error.key);}
  }
  for (const source of [{url: 'https://cdn.test/movie.mp4', page: 'https://youtube.com/watch?v=aqz-KE-bpKQ'}, {url: 'https://cdn.test/movie.mpd', initiator: 'https://youtube-nocookie.com'}, {url: 'https://rr1.googlevideo.com/file', provider: 'generic'}]) {
   try {Source.AssertMediaAllowed(source); Checks.push('unexpected-success');} catch (error) {Checks.push(error.key);}
  }
  const DownloadId = await BrowserDownload.DownloadNamedFile(url, 'distribution-fixture.mp4');
  const Deadline = Date.now() + 15000;
  let Item;
  do { [Item] = await chrome.downloads.search({id: DownloadId}); if (Item?.state !== 'in_progress') break; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < Deadline);
  const RedirectId = await BrowserDownload.DownloadNamedFile(new URL('/redirect', url).href, 'blocked-redirect.mp4');
  let Redirect;
  do { [Redirect] = await chrome.downloads.search({id: RedirectId}); if (Redirect?.state !== 'in_progress') break; await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < Deadline);
  const Matches = await chrome.declarativeNetRequest.testMatchOutcome({url: 'https://r1.googlevideo.com/distribution-policy-fixture', initiator: chrome.runtime.getURL(''), type: 'xmlhttprequest'});
  const PageMatches = await chrome.declarativeNetRequest.testMatchOutcome({url: 'https://r1.googlevideo.com/distribution-policy-fixture', initiator: 'https://www.youtube.com', type: 'media'});
  return {policy: Policy.DistributionPolicy, checks: Checks, ordinaryDownload: {state: Item?.state, bytes: Item?.bytesReceived, error: Item?.error}, redirect: {state: Redirect?.state, bytes: Redirect?.bytesReceived, error: Redirect?.error}, matches: Matches, pageMatches: PageMatches, rules: await chrome.declarativeNetRequest.getSessionRules()};
 }, {url: Url});
 assert.ok(Result.checks.every(Value => Value === 'youtube_distribution_disabled'));
 assert.equal(Result.policy.flavor, 'chrome-store');
 assert.equal(Result.ordinaryDownload.state, 'complete');
 assert.equal(Result.ordinaryDownload.bytes, Bytes.length);
 assert.equal(Result.redirect.state, 'interrupted');
 assert.equal(Result.redirect.bytes, 0);
 assert.equal(Result.matches.matchedRules.length, 1);
 assert.equal(Result.pageMatches.matchedRules.length, 0);
 const Report = {browser: Version.product, generatedPackage: 'chrome-store', ...Result, fixtureServerHits: Hits};
 await writeFile(Path.join(Artifact, 'result.json'), JSON.stringify(Report, null, 2));
 console.log(JSON.stringify({artifact: Artifact, ...Report}));
} finally {await Context.close(); await new Promise(Resolve => Server.close(Resolve));}
