/** Isolated BIGO failure reproduction. Never attaches to an existing browser. */
import {mkdir, cp, readFile, writeFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import Assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openAsBlob} from 'node:fs';
import {Input, BlobSource, ALL_FORMATS, EncodedPacketSink} from '../../extension/vendor/mediabunny-1.65.2.mjs';
import {ParseMediaPlaylist} from '../../extension/lib/hls.js';
import {createServer} from 'node:http';
let StreamUrl = process.env.MDOWNLOADER_BIGO_STREAM_URL;
const CaptureDir = process.env.MDOWNLOADER_BIGO_CAPTURE_DIR;
let ReplayServer, ReplayInfo;
if (CaptureDir)
{
 Assert.ok(StreamUrl, 'Replay requires the originally supplied stream URL');
 const Original = await readFile(Path.join(CaptureDir, 'playlist.m3u8'), 'utf8');
 const First = ParseMediaPlaylist(Original, StreamUrl).segments[0];
 const Bytes = await readFile(Path.join(CaptureDir, 'segment.bin'));
 const Sample = '#EXTM3U\n#EXT-X-BIGO-WEB-PROTECTION:VERSION=1,SEED=' + First.webProtection.seed +
  '\n#EXT-X-TARGETDURATION:2\n#EXTINF:' + First.duration + ',\nsample.ts\n#EXT-X-ENDLIST\n';
 ReplayInfo = {originalSegment: First.url.split('?')[0], bytesUnmodified: true, finiteSample: true};
 ReplayServer = createServer((Request, Response) => {
  const Segment = Request.url === '/sample.ts', Manifest = Request.url === '/live.m3u8';
  Response.writeHead(200, {'Content-Type': Segment ? 'video/mp2t' : Manifest ? 'application/vnd.apple.mpegurl' : 'text/html', 'Access-Control-Allow-Origin': '*'});
  Response.end(Segment ? Bytes : Manifest ? Sample : '<!doctype html><title>BIGO recorded sample</title><video controls src="/live.m3u8"></video>');
 });
 await new Promise(Resolve => ReplayServer.listen(0, '127.0.0.1', Resolve));
 StreamUrl = 'http://127.0.0.1:' + ReplayServer.address().port + '/live.m3u8';
}
const Root = fileURLToPath(new URL('../../', import.meta.url));
const Artifact = Path.join(Root, 'artifacts/bigo/chrome-' + Date.now());
await mkdir(Artifact, {recursive: true});
const ExtensionPath = Path.join(Artifact, 'extension');
await cp(Path.join(Root, 'extension'), ExtensionPath, {recursive: true});
const Manifest = JSON.parse(await readFile(Path.join(ExtensionPath, 'manifest.json'), 'utf8'));
const Hosts = ['https://*.bigo.tv/*', ...(StreamUrl ? [new URL(StreamUrl).protocol + '//' + new URL(StreamUrl).hostname + '/*'] : [])];
Manifest.host_permissions.push(...Hosts);
await writeFile(Path.join(ExtensionPath, 'manifest.json'), JSON.stringify(Manifest));
const {chromium} = await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE ||
 Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {
 executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
 ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
});
const ProbePage = CaptureDir ? new URL('/', StreamUrl).href : 'https://www.bigo.tv/165253945';
const Report = {source: 'https://www.bigo.tv/165253945', isolatedProfile: true, computerUse: false,
 ...(ReplayInfo ? {replay: ReplayInfo} : {}),
 mode: CaptureDir ? 'recorded-single-segment-replay' : 'live-network', testOnlyHosts: Hosts, requests: [], failures: []};
try {
 const Browser = await Context.browser().newBrowserCDPSession();
 await Browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: Path.join(Artifact, 'downloads')});
 const {id} = await Browser.send('Extensions.loadUnpacked', {path: ExtensionPath});
 const Extension = await Context.newPage();
 await Extension.waitForTimeout(1500);
 await Extension.goto(`chrome-extension://${id}/popup.html`);
 await Extension.evaluate(async () => {
  await (await import('./hls-discovery.js')).SyncHlsDiscovery();
 });
 const Page = await Context.newPage();
 Page.on('response', async Response => {
  const Url = new URL(Response.url());
  const Mime = Response.headers()['content-type'] || '';
  if (/m3u8|\.flv|\.mpd|\/studio\//i.test(Url.pathname) || /video|mpegurl/i.test(Mime)) {
   const Item = {url: Url.origin + Url.pathname, status: Response.status(), mime: Mime};
   Report.requests.push(Item);
   if (/\/studio\//.test(Url.pathname) && /json/i.test(Mime)) {
    try { const Body = await Response.json(); Report.studio = {code: Body.code, needLogin: Body.data?.needLogin,
     hlsSourcePresent: !!Body.data?.hls_src, cdnSourceCount: Body.data?.cdn_src?.length}; } catch {}
   }
  }
 });
 Page.on('requestfailed', Request => Report.failures.push({url: Request.url().split('?')[0], error: Request.failure()?.errorText}));
 await Page.goto(ProbePage, {waitUntil: 'domcontentloaded', timeout: 60000});
 await Page.waitForTimeout(CaptureDir ? 500 : 12000);
 if (await Page.getByText('모두 수락', {exact:true}).isVisible()) await Page.getByText('모두 수락', {exact:true}).click();
 if (!CaptureDir) await Page.waitForTimeout(5000);
 Report.page = await Page.evaluate(() => ({url: location.href, title: document.title, text: document.body.innerText.slice(-2500), videos: [...document.querySelectorAll('video')].map(V => ({src: V.currentSrc, ready: V.readyState, width: V.videoWidth, height: V.videoHeight, error: V.error?.code}))}));
 await Page.screenshot({path: Path.join(Artifact, 'page.png')});
 const TabId = await Extension.evaluate(async Url => (await chrome.tabs.query({url: new URL(Url).origin + '/*'}))[0].id, ProbePage);
 if (StreamUrl)
 {
  // The logged-out test page does not receive a stream URL from BIGO. The
  // user-supplied live URL is fetched in that real page; the response enters
  // normal manifest observation, without fabricating a server response.
  const Text = await Page.evaluate(async Url => {
   const Response = await fetch(Url, {signal: AbortSignal.timeout(15000)});
   if (!Response.ok) throw Error('Live manifest HTTP ' + Response.status);
   return Response.text();
  }, StreamUrl);
  Report.manifest = {webProtection: Text.includes('#EXT-X-BIGO-WEB-PROTECTION:'), suppliedByUser: !CaptureDir};
  await Extension.evaluate(async ({TabId, StreamUrl, Text}) => {
   const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId}, func: () => location.href});
   await (await import('./network.js')).ObserveManifest({tab: {id: TabId}, frameId: 0,
    documentId: Frame.documentId, origin: new URL(Frame.result).origin}, {url: StreamUrl, text: Text, page: Frame.result});
  }, {TabId, StreamUrl, Text});
 }
 Report.scan = await Extension.evaluate(async TabId => {
  const {Scan, ResolveCandidate} = await import('./detection.js');
  const ScanResult = await Scan(TabId, 'bigo-probe');
  globalThis.BigoScan = ScanResult;
  globalThis.BigoCandidates = await Promise.all((ScanResult.candidates || []).map(C => ResolveCandidate(TabId, ScanResult.scanId, C.id, 'bigo-probe')));
  return {restricted: ScanResult.restricted, candidates: globalThis.BigoCandidates.map(C => ({...C, url: C.url?.split('?')[0]}))};
 }, TabId);
 if (StreamUrl)
 {
  const RequestId = await Extension.evaluate(async ({TabId, StreamUrl}) => {
   // The real popup can rescan while preview requests finish. Obtain the
   // worker's current popup scan immediately before enqueue, as its UI does.
   const {Scan, ResolveCandidate} = await import('./detection.js');
   const Current = await Scan(TabId, 'popup');
   const Resolved = await Promise.all((Current.candidates || []).map(C => ResolveCandidate(TabId, Current.scanId, C.id, 'popup')));
   const Candidate = Resolved.find(C => C.url === StreamUrl);
   if (!Candidate) throw Error('Supplied live stream did not enter normal detection');
   const RequestId = crypto.randomUUID();
   const Reply = await chrome.runtime.sendMessage({type: 'enqueue', tabId: TabId,
    scanId: Current.scanId, candidateId: Candidate.id, requestId: RequestId, captionOverride: 'off'});
   if (!Reply?.ok || Reply.data?.state !== 'started') throw Error(JSON.stringify(Reply));
   return RequestId;
  }, {TabId, StreamUrl});
  console.log(CaptureDir ? 'Started extension download of recorded protected BIGO segment' : 'Started actual protected BIGO live transfer');
  Report.preview = await Extension.evaluate(async StreamUrl => {
   const {ReadStreamThumbnail} = await import('./lib/stream-thumbnail.js');
   const Result = await ReadStreamThumbnail({url: StreamUrl, format: 'M3U8'}, new AbortController().signal);
   return {resolution: Result.resolution, live: Result.live, jpeg: Result.still?.startsWith('data:image/jpeg;base64,')};
  }, StreamUrl);
  if (CaptureDir) Assert.deepEqual(Report.preview.resolution, {width: 480, height: 854});
  else Assert.ok(Report.preview.resolution?.width > 0 && Report.preview.resolution?.height > 0);
  Assert.equal(Report.preview.jpeg, true);
  let State, ClosedAt, FinishSent = false;
  for (let Attempt = 0; Attempt < 100; Attempt++)
  {
   State = await Extension.evaluate(async Id => {
    const Job = (await chrome.storage.local.get('job:' + Id))['job:' + Id];
    const [Download] = Job?.downloadId === undefined ? [] : await chrome.downloads.search({id: Job.downloadId});
    return {state: Job?.state, error: Job?.error, finished: Job?.finished, bytes: Job?.bytesReceived,
     download: Download && {state: Download.state, filename: Download.filename}};
   }, RequestId);
   if (['failed', 'canceled'].includes(State.state)) throw Error(JSON.stringify(State));
   if (!CaptureDir && !ClosedAt && State.finished >= 3) {ClosedAt = State.finished; await Page.close(); console.log('Closed source tab after ' + ClosedAt + ' committed segments');}
   if (ClosedAt && !FinishSent && State.finished >= ClosedAt + 4)
   {
    const Reply = await Extension.evaluate(Id => chrome.runtime.sendMessage({type: 'control', requestId: Id, action: 'finish'}), RequestId);
    Assert.equal(Reply?.ok, true, JSON.stringify(Reply)); FinishSent = true;
    console.log('Stopped and saved after ' + State.finished + ' committed segments');
   }
   if (State.download?.state === 'complete') break;
   await Extension.waitForTimeout(500);
  }
  Assert.equal(State.download?.state, 'complete', JSON.stringify(State));
  if (!CaptureDir) Assert.ok(ClosedAt && FinishSent);
  Report.transfer = {...State, ...(ClosedAt ? {segmentsAtTabClose: ClosedAt, segmentsReceivedAfterTabClose: State.finished - ClosedAt} : {})};
  const Filename = State.download.filename;
  const Relative = Path.relative(Path.join(Artifact, 'downloads'), Filename);
  Assert.ok(Relative && !Relative.startsWith('..') && !Path.isAbsolute(Relative));
  const Bytes = await readFile(Filename);
  Report.file = {filename: Filename, bytes: Bytes.length, sha256: createHash('sha256').update(Bytes).digest('hex')};
  const Media = new Input({source: new BlobSource(await openAsBlob(Filename)), formats: ALL_FORMATS});
  try {
   Report.duration = await Media.computeDuration(); Report.tracks = [];
   for (const Track of await Media.getTracks()) {
    let Packets = 0; for await (const Packet of new EncodedPacketSink(Track).packets()) Packets++;
    Report.tracks.push({type: Track.type, codec: await Track.getCodec(), packets: Packets});
   }
  } finally {Media.dispose();}
  Assert.ok(Report.tracks.some(T => T.type === 'video' && T.codec === 'avc' && T.packets > 10));
  Assert.ok(Report.tracks.some(T => T.type === 'audio' && T.codec === 'aac' && T.packets > 10));
  const Playback = await Context.newPage(); await Playback.goto(pathToFileURL(Filename).href);
  await Playback.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  Report.playback = await Playback.evaluate(async () => {
   const Video = document.querySelector('video'); Video.muted = true; await Video.play();
   await new Promise(R => setTimeout(R, 700));
   Video.currentTime = Video.duration - 1;
   await new Promise(R => Video.addEventListener('seeked', R, {once: true}));
   await new Promise(R => setTimeout(R, 300));
   return {duration: Video.duration, width: Video.videoWidth, height: Video.videoHeight,
    audioBytes: Video.webkitAudioDecodedByteCount, endPosition: Video.currentTime, error: Video.error?.code};
  });
  Assert.ok(Report.playback.audioBytes > 0 && Report.playback.width > 0 && Report.playback.endPosition > Report.duration - 2);
  Report.passed = true;
 }
 console.log(JSON.stringify({artifact: Artifact, ...Report, requests: Report.requests.filter(R => /studio|m3u8|flv|mpd/i.test(R.url))}, null, 2));
 await writeFile(Path.join(Artifact, 'result.json'), JSON.stringify(Report, null, 2));
} catch (ErrorValue) {
 Report.error = ErrorValue.stack;
 await writeFile(Path.join(Artifact, 'result.json'), JSON.stringify(Report, null, 2));
 console.error(JSON.stringify({artifact: Artifact, ...Report}, null, 2)); process.exitCode = 1;
} finally {await Context.close(); if (ReplayServer) await new Promise(Resolve => ReplayServer.close(Resolve));}
