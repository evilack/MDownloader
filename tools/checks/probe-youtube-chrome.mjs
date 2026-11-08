/** Native Chrome feasibility gate. No profile reuse, proxy, cookies, token generation or client cycling. */
import {mkdir, writeFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const Root = fileURLToPath(new URL('../../', import.meta.url));
const {chromium} = await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE || Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const Artifact = Path.join(Root, 'artifacts/youtube-implementation/youtube-native-' + Date.now());
await mkdir(Artifact, {recursive: true});
const Flavor = 'development';
// 개발판이 수동 설치판입니다. 별도 manual 배포판은 없습니다.
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {executablePath: process.env.MDOWNLOADER_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: process.env.MDOWNLOADER_HEADFUL !== '1', ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging']});
try {
 const Browser = await Context.browser().newBrowserCDPSession();
 const Version = await Browser.send('Browser.getVersion');
 const {id} = await Browser.send('Extensions.loadUnpacked', {path: Path.join(Root, `artifacts/distributions/${Flavor}/extension`)});
 const ApiHosts = ['https://www.youtube.com/*', 'https://youtube.com/*', 'https://youtubei.googleapis.com/*'];
 const Settings = await Context.newPage();
 await Settings.goto('chrome://extensions');
 async function GrantHosts(Hosts) {
  await Settings.evaluate(async ({id, hosts}) => {for (const host of hosts) await chrome.developerPrivate.addHostPermission(id, host);}, {id, hosts: Hosts});
  const Granted = await Page.evaluate(hosts => chrome.permissions.request({origins: hosts}), Hosts);
  if (!Granted) throw new Error('Optional test host permission denied');
 }
 const Page = await Context.newPage();
 await Page.goto(`chrome-extension://${id}/options.html`);
 await GrantHosts(ApiHosts);
 const Permissions = await Page.evaluate(() => chrome.permissions.getAll());
 const VodPage = await Context.newPage();
 let PublicPage;
 try {
  const Response = await VodPage.goto('https://www.youtube.com/watch?v=-XHx839rSc8', {waitUntil: 'domcontentloaded', timeout: 30000});
  PublicPage = await VodPage.evaluate(() => {
   const info = globalThis.ytInitialPlayerResponse;
   const formats = [...(info?.streamingData?.formats ?? []), ...(info?.streamingData?.adaptiveFormats ?? [])];
   return {title: document.title, status: info?.playabilityStatus?.status, formats: info?.streamingData?.formats?.length ?? 0, adaptiveFormats: info?.streamingData?.adaptiveFormats?.length ?? 0, directUrls: formats.filter(f => !!f.url).length, cipherUrls: formats.filter(f => !!(f.signatureCipher || f.cipher)).length, sabr: !!info?.streamingData?.serverAbrStreamingUrl};
  });
  PublicPage.httpStatus = Response.status();
 } catch {PublicPage = {result: 'navigation-failed'};}
 await Page.evaluate(async () => {const {EnsureRunner} = await import('./hls-jobs.js'); await EnsureRunner();});
 const {targetInfos} = await Browser.send('Target.getTargets');
 const Target = targetInfos.find(Target => Target.url === `chrome-extension://${id}/hls-runner.html`);
 if (!Target) throw new Error('Missing real offscreen target');
 const {sessionId} = await Browser.send('Target.attachToTarget', {targetId: Target.targetId, flatten: false});
 let Counter = 0;
 async function Offscreen(Expression) {
  const MessageId = ++Counter;
  return new Promise((Resolve, Reject) => {
   const Timer = setTimeout(() => {Browser.off('Target.receivedMessageFromTarget', Listener); Reject(new Error('Offscreen probe timed out'));}, 90000);
   function Listener(Event) {
    if (Event.sessionId !== sessionId) return;
    const Message = JSON.parse(Event.message);
    if (Message.id !== MessageId) return;
    clearTimeout(Timer); Browser.off('Target.receivedMessageFromTarget', Listener);
    if (Message.error || Message.result?.exceptionDetails) Reject(new Error('Offscreen execution failed'));
    else Resolve(Message.result?.result?.value);
   }
   Browser.on('Target.receivedMessageFromTarget', Listener);
   Browser.send('Target.sendMessageToTarget', {sessionId, message: JSON.stringify({id: MessageId, method: 'Runtime.evaluate', params: {expression: Expression, awaitPromise: true, returnByValue: true}})}).catch(Reject);
  });
 }
 const Result = await Offscreen(`(async () => {
  const {CreateEvaluator} = await import('./features/youtube/evaluator.js');
  const evaluate = CreateEvaluator();
  const evaluator = {};
  try {evaluator.simple = await evaluate({output:'({sig: "safe", n: "test"})'}, {});} catch(e) {evaluator.simpleError = e.code;}
  try {await evaluate({output:'while (true) {}'}, {});} catch(e) {evaluator.timeout = e.code;}
  evaluator.deniedCapabilities = [];
  for (const script of ['fetch("https://example.org")', 'chrome.runtime.sendMessage({})', '({sig: "".constructor.constructor("return typeof fetch")()})']) {
   try {await evaluate({output:script}, {}); evaluator.deniedCapabilities.push('unexpected-success');} catch(e) {evaluator.deniedCapabilities.push(e.code);}
  }
  const {CreateYoutubeClient} = await import('./features/youtube/client.js');
  const events = [];
  globalThis.YoutubeProbeClient = CreateYoutubeClient({evaluate, report: event => events.push(event)});
  try {
   const resolved = await globalThis.YoutubeProbeClient.DiscoverYoutube({pageUrl:'https://www.youtube.com/watch?v=-XHx839rSc8'});
   globalThis.YoutubeProbeResolved = resolved;
   return {evaluator, events, result:'metadata', resolved};
  } catch(e) {return {evaluator, events, result:'failed', code:e.code ?? 'unexpected'};}
 })()`);
 if (Result.result === 'metadata') {
  // Ask the exact selected CDN host permission after deciphering, never *.googlevideo.com.
  const TrackResult = await Offscreen(`(async () => {
   const info = globalThis.YoutubeProbeResolved;
   const video = info.formats.filter(f => f.kind === 'video' && f.container === 'mp4' && f.codecs.some(c=>c.startsWith('avc1'))).sort((a,b)=>a.height-b.height)[0];
   const audio = info.formats.find(f => f.kind === 'audio' && f.container === 'mp4' && f.codecs.some(c=>c.startsWith('mp4a')));
   if (!video || !audio) return {result:'no-compatible-tracks'};
   try {return {result:'resolved', value: await globalThis.YoutubeProbeClient.ResolveYoutubeSelection({sessionKey:info.sessionKey, videoId:info.videoId, selection:{videoFormatId:video.id,audioFormatId:audio.id,output:'mp4'}})};}
   catch(e) {return {result:'failed',code:e.code};}
  })()`);
  // Do not persist signed URLs in reports. The follow-up receive path is only reached if exact permissions are already available.
  Result.selection = {result: TrackResult.result, code: TrackResult.code};
 }
 const Report = {browser: Version.product, flavor: Flavor, context: 'real offscreen document', videoId: '-XHx839rSc8', contentAuthorization: 'User-requested test VOD', publicPage: PublicPage, permissions: Permissions, ...Result,
  gatePassed: false, receive: {attempted: false, bytes: 0}, save: {attempted: false, reason: Result.code ?? Result.selection?.code ?? 'receive-not-verified'}};
 await writeFile(Path.join(Artifact, 'result.json'), JSON.stringify(Report, null, 2));
 console.log(JSON.stringify({artifact: Artifact, ...Report}));
 process.exitCode = 2;
} finally {await Context.close();}
