/** NicoNico reproduction in a disposable browser; never touches an existing session. */
import Path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {mkdir, cp, readFile, writeFile} from 'node:fs/promises';
import Assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openAsBlob} from 'node:fs';
import {Input, BlobSource, ALL_FORMATS, EncodedPacketSink} from '../../extension/vendor/mediabunny-1.65.2.mjs';
const Root = fileURLToPath(new URL('../../', import.meta.url));
const Artifact = Path.join(Root, 'artifacts/niconico/chrome-' + Date.now());
const ExtensionPath = Path.join(Artifact, 'extension');
await mkdir(Artifact, {recursive: true});
await cp(Path.join(Root, 'extension'), ExtensionPath, {recursive: true});
const Manifest = JSON.parse(await readFile(Path.join(ExtensionPath, 'manifest.json'), 'utf8'));
Manifest.host_permissions.push('https://www.nicovideo.jp/*', 'https://delivery.domand.nicovideo.jp/*', 'https://asset.domand.nicovideo.jp/*');
await writeFile(Path.join(ExtensionPath, 'manifest.json'), JSON.stringify(Manifest));
const {chromium} = await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE || Path.resolve(Path.dirname(process.execPath), '../node_modules/playwright/index.mjs')));
const Context = await chromium.launchPersistentContext(Path.join(Artifact, 'profile'), {
 executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
 ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
});
const Report = {source: 'https://www.nicovideo.jp/watch/sm45342269', isolatedProfile: true, computerUse: false,
 testOnlyHosts: Manifest.host_permissions.filter(H=>H.includes('nicovideo')), requests: []};
console.log('Artifact:', Artifact);
try {
 const Browser = await Context.browser().newBrowserCDPSession();
 await Browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: Path.join(Artifact, 'downloads')});
 const {id} = await Browser.send('Extensions.loadUnpacked', {path: ExtensionPath});
 const Extension = await Context.newPage();
 await Extension.goto(`chrome-extension://${id}/popup.html`);
 await Extension.evaluate(async () => { await chrome.storage.local.set({notifyDownloadComplete: false, subtitleTranslation: {enabled: false}}); await (await import('./hls-discovery.js')).SyncHlsDiscovery(); });
 const Page = await Context.newPage();
 Page.on('response', async R => {
  const Url = new URL(R.url());
  if (/m3u8|mpd|mp3|\.key|access-rights|watch\/sm/.test(Url.pathname)) {
   const Headers = await R.request().allHeaders();
   const Item = {url: Url.origin + Url.pathname, status: R.status(), mime: R.headers()['content-type'],
    headers: {origin: Headers.origin, referer: Headers.referer, hasCookie: !!Headers.cookie}};
   Report.requests.push(Item);
   if (/m3u8/.test(Url.pathname)) { try {Item.text = await R.text();} catch {} }
  }
 });
 await Page.goto(Report.source, {waitUntil: 'domcontentloaded', timeout: 60000});
 await Page.waitForTimeout(12000);
 Report.page = await Page.evaluate(() => ({title: document.title, text: document.body.innerText.slice(-3500), videos: [...document.querySelectorAll('video')].map(V=>({src:V.currentSrc, ready:V.readyState, width:V.videoWidth,error:V.error?.code}))}));
 const AudioText = Report.requests.find(R=>R.text?.includes('#EXT-X-KEY:'))?.text;
 const KeyUrl = /#EXT-X-KEY:[^\n]*URI="([^"]+)"/.exec(AudioText)?.[1];
 if(KeyUrl && process.env.MDOWNLOADER_NICO_DIAGNOSE) {
  const ProbeFetch = async Url => {const Result=[];for(const credentials of ['omit','include']){try{const R=await fetch(Url,{credentials,cache:'no-store'});Result.push({credentials,status:R.status,bytes:(await R.arrayBuffer()).byteLength});}catch(E){Result.push({credentials,error:String(E)});}}return Result;};
  Report.keyProbe = {page:await Page.evaluate(ProbeFetch,KeyUrl),extension:await Extension.evaluate(ProbeFetch,KeyUrl)};
  console.log('Key probe:',JSON.stringify(Report.keyProbe));
 }
 const TabId = await Extension.evaluate(async () => (await chrome.tabs.query({url:'https://www.nicovideo.jp/watch/*'}))[0].id);
 Report.candidates = await Extension.evaluate(async TabId => {
  const {Scan, ResolveCandidate} = await import('./detection.js');
  const ScanReply = await chrome.runtime.sendMessage({type:'scan',tabId:TabId});
  if(!ScanReply?.ok) throw Error(JSON.stringify(ScanReply));
  const ScanResult = ScanReply.data;
  globalThis.NicoScan = ScanResult;
  globalThis.NicoCandidates = await Promise.all((ScanResult.candidates || []).map(C=>ResolveCandidate(TabId,ScanResult.scanId,C.id,'popup')));
  return globalThis.NicoCandidates;
 }, TabId);
 console.log('Candidates:', JSON.stringify(Report.candidates.map(C=>({id:C.id,name:C.name,format:C.format,qualities:C.qualities?.length}))));
 Assert.equal(Report.candidates.length, 1, 'master, video and companion audio form one download');
 Report.repeat = await Extension.evaluate(async TabId => {
  const Reply = await chrome.runtime.sendMessage({type:'scan',tabId:TabId});
  if(!Reply?.ok) throw Error(JSON.stringify(Reply));
  globalThis.NicoScan = Reply.data;
  const {ResolveCandidate} = await import('./detection.js');
  return Promise.all(Reply.data.candidates.map(C=>ResolveCandidate(TabId,Reply.data.scanId,C.id,'popup')));
 }, TabId);
 Assert.equal(Report.repeat.length, 1);
 Report.qualities = await Extension.evaluate(async TabId => {
  const Reply = await chrome.runtime.sendMessage({type:'hlsQualities',tabId:TabId,scanId:globalThis.NicoScan.scanId,candidateId:0});
  if(!Reply?.ok) throw Error(JSON.stringify(Reply));
  return Reply.data.map(Q=>({resolution:Q.resolution, bandwidth:Q.bandwidth, separateAudio:!!Q.audioUrl}));
 }, TabId);
 Assert.deepEqual([...new Set(Report.qualities.map(Q=>Q.resolution))].sort(), ['1280x720','256x144','640x360','854x480'].sort());
 Assert.ok(Report.qualities.every(Q=>Q.separateAudio));
 Report.jobs = [];
 for (const Candidate of Report.candidates) {
  const Entry = {format: Candidate.format, url: Candidate.url?.split('?')[0]}; Report.jobs.push(Entry);
  try {
   Entry.start = await Extension.evaluate(async ({TabId, CandidateId}) => {
    const requestId = crypto.randomUUID();
    return {requestId, result: await chrome.runtime.sendMessage({type:'enqueue',tabId: TabId, scanId: globalThis.NicoScan.scanId,candidateId: CandidateId, requestId, captionOverride:'off'})};
   },{TabId,CandidateId:Candidate.id});
   for(let I=0;I<240;I++) {
    Entry.state = await Extension.evaluate(async Id=> {
     const Job=(await chrome.storage.local.get('job:'+Id))['job:'+Id];
     const [Download]=Job?.downloadId===undefined ? [] : await chrome.downloads.search({id:Job.downloadId});
     return {...Job, download: Download && {state:Download.state,filename:Download.filename,error:Download.error,bytes:Download.bytesReceived}};
    },Entry.start.requestId);
    if(['failed','canceled','complete'].includes(Entry.state.state)||['complete','interrupted'].includes(Entry.state.download?.state)) break;
    await Extension.waitForTimeout(500);
   }
  } catch(E) {Entry.error=String(E.stack||E);}
  Assert.equal(Entry.state?.download?.state, 'complete', JSON.stringify(Entry));
  const Filename = Entry.state.download.filename;
  const Relative = Path.relative(Path.join(Artifact, 'downloads'), Filename);
  Assert.ok(Relative && !Relative.startsWith('..') && !Path.isAbsolute(Relative));
  const Bytes = await readFile(Filename);
  Entry.file = {filename:Filename,bytes:Bytes.length,sha256:createHash('sha256').update(Bytes).digest('hex')};
  const Media = new Input({source:new BlobSource(await openAsBlob(Filename)),formats:ALL_FORMATS});
  try {
   Entry.duration = await Media.computeDuration(); Entry.tracks=[];
   for(const Track of await Media.getTracks()) {
    let Packets=0;for await(const Packet of new EncodedPacketSink(Track).packets()) Packets++;
    Entry.tracks.push({type:Track.type,codec:await Track.getCodec(),packets:Packets,width:Track.displayWidth,height:Track.displayHeight,duration:await Track.computeDuration()});
   }
  } finally {Media.dispose();}
  Assert.ok(Entry.tracks.some(T=>T.type==='video' && T.codec==='avc' && T.height===720 && T.packets>6000));
  Assert.ok(Entry.tracks.some(T=>T.type==='audio' && T.codec==='aac' && T.packets>10000));
  Assert.ok(Entry.duration>230);
  const Playback = await Context.newPage();
  await Playback.goto(pathToFileURL(Filename).href);
  await Playback.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  Entry.playback = await Playback.evaluate(async()=>{
   const V=document.querySelector('video'); V.muted=true;await V.play();
   const Results=[];
   for(const Position of [1,V.duration/2,V.duration-1]) {
    V.currentTime=Position;
    await new Promise((Resolve,Reject)=>{const Timer=setTimeout(()=>Reject(Error('seek timeout')),10000);V.addEventListener('seeked',()=>{clearTimeout(Timer);Resolve();},{once:true});});
    await new Promise(R=>setTimeout(R,350));
    Results.push({position:V.currentTime,ready:V.readyState,audioBytes:V.webkitAudioDecodedByteCount});
   }
   return {width:V.videoWidth,height:V.videoHeight,duration:V.duration,error:V.error?.code,positions:Results};
  });
  Assert.equal(Entry.playback.height,720);Assert.equal(Entry.playback.error,undefined);
  Assert.ok(Entry.playback.positions.every(P=>P.ready>=2 && P.audioBytes>0));
  console.log('Verified:',JSON.stringify({file:Entry.file,tracks:Entry.tracks,playback:Entry.playback}));
 }
 Report.passed=true;
} catch(E) {Report.error=String(E.stack||E);console.error(Report.error);process.exitCode=1;}
finally {await writeFile(Path.join(Artifact,'report.json'),JSON.stringify(Report,null,2));await Context.close();}
