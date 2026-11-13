import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir, stat, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {setImmediate as settle} from 'node:timers/promises';
import {DistributionFiles} from '../tools/lib/distribution-archive.mjs';
const run = (...args) => spawnSync(process.execPath, args, {encoding: 'utf8'});
test('flavor is mandatory, independent packages exclude executable YouTube files from store', async () => {
 assert.notEqual(run('tools/build/package-extension.mjs').status, 0);
 assert.notEqual(run('tools/build/package-extension.mjs', '--flavor', 'invalid').status, 0);
 const original = await readFile('extension/lib/distribution-policy.js', 'utf8');
 const SourceFiles=await DistributionFiles('extension');
 const SourceHashes=await Promise.all(SourceFiles.map(async Name=>[Name,createHash('sha256').update(await readFile('extension/'+Name)).digest('hex')]));
 assert.notEqual(run('tools/build/package-extension.mjs', '--flavor', 'manual').status, 0);
 assert.notEqual(run('tools/build/package-extension.mjs', '--flavor', 'edge-store').status, 0);
 for (const flavor of ['development', 'chrome-store']) {
  const result = run('tools/build/package-extension.mjs', '--flavor', flavor);
  assert.equal(result.status, 0, result.stderr);
  const root = `artifacts/distributions/${flavor}/extension`;
  const policy = await import(`../${root}/lib/distribution-policy.js?${Date.now()}`);
  assert.equal(policy.DistributionPolicy.flavor, flavor);
  assert.equal(policy.CanUseYoutube?.({...policy.DistributionPolicy, youtubeEnabled: true}, 'chrome') ?? false, flavor !== 'chrome-store');
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  const zip=await readFile(`artifacts/distributions/${flavor}/MDownloader-${flavor}-${manifest.version}.zip`);
  assert.ok(zip.length > 1000);
  // Independently read ZIP central/local records and compare every inflated byte with the directory.
  const end=zip.length-22;
  assert.equal(zip.readUInt32LE(end),0x06054b50);
  const names=[];
  let position=zip.readUInt32LE(end+16);
  for(let index=0;index<zip.readUInt16LE(end+10);index++) {
   assert.equal(zip.readUInt32LE(position),0x02014b50);
   const length=zip.readUInt16LE(position+28),name=zip.subarray(position+46,position+46+length).toString();
   const offset=zip.readUInt32LE(position+42);
   assert.equal(zip.readUInt32LE(offset),0x04034b50);
   assert.equal(zip.readUInt16LE(offset+8),8);
   const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
   const data=inflateRawSync(zip.subarray(start,start+zip.readUInt32LE(position+20)));
   assert.equal(data.length,zip.readUInt32LE(position+24));
   assert.deepEqual(data,await readFile(`${root}/${name}`),name);
   names.push(name);position+=46+length+zip.readUInt16LE(position+30)+zip.readUInt16LE(position+32);
  }
  assert.deepEqual(names,await DistributionFiles(root));
  assert.ok(names.includes('manifest.json'));
  assert.ok(!names.some(name=>name.startsWith('extension/')||name.includes('.local/')));
  const {ObserveYoutubePolicyNotice}=await import(`../${root}/lib/youtube-policy-notice.js`);
  let tab={id:1,windowId:1,url:'https://www.youtube.com/watch?v=aqz-KE-bpKQ'},refresh;
  const states=[];
  globalThis.chrome={tabs:{query:async()=>[tab],onUpdated:{addListener:fn=>refresh=fn,removeListener(){}},onActivated:{addListener(){},removeListener(){}}}};
  try {
   const stop=ObserveYoutubePolicyNotice(Blocked=>states.push(Blocked));
   await settle();assert.equal(states.at(-1),flavor==='chrome-store');
   if(flavor==='chrome-store') {tab={...tab,url:'https://example.org/video'};refresh(1,{url:tab.url});await settle();assert.equal(states.at(-1),false);}
   stop();
  } finally {delete globalThis.chrome;}
  const verified = run('--expose-internals', 'tools/checks/verify-distribution.mjs', '--flavor', flavor);
  assert.equal(verified.status, 0, verified.stderr + verified.stdout);
  if (flavor === 'chrome-store') {
   const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
   assert.ok(manifest.permissions.includes('declarativeNetRequest'));
   assert.ok(manifest.permissions.includes('tabs'), 'store side panel reads the active page URL without host access');
   assert.ok(!manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
   assert.equal(manifest.sandbox,undefined);assert.equal(manifest.content_security_policy?.sandbox,undefined);
   await assert.rejects(readdir(`${root}/features/youtube`), {code:'ENOENT'});
   await assert.rejects(stat(`${root}/icons/youtube-brand-32.png`), {code:'ENOENT'});
   for(const name of ['background.js','jobs.js','detection.js','hls-runner.js']) {
    const source=await readFile(`${root}/${name}`,'utf8');
    assert.doesNotMatch(source,/features\/youtube|DiscoverYoutube|ResolveYoutubeSelection|HandleYoutubeRunner|ytInitialPlayerResponse|i\.ytimg\.com|youtubeQualities/);
   }
   const options=await readFile(`${root}/options.html`,'utf8');
   assert.doesNotMatch(options,/youtube-caption-settings|include-youtube-auto-captions/);
   for(const locale of await readdir(`${root}/_locales`)) {
    const catalog=JSON.parse(await readFile(`${root}/_locales/${locale}/messages.json`,'utf8'));
    assert.ok(catalog.youtube_store_policy_notice?.message);
    assert.ok(catalog.youtube_distribution_disabled?.message);
    assert.equal(catalog.opt_youtube_auto_captions,undefined);
    assert.equal(catalog.youtube_extraction_failed,undefined);
   }
   for(const page of ['popup','sidepanel']) {
    assert.match(await readFile(`${root}/${page}.html`,'utf8'),/data-youtube-policy-notice/);
    assert.match(await readFile(`${root}/${page}.js`,'utf8'),/ObserveYoutubePolicyNotice/);
   }
   const Id='33333333-3333-3333-3333-333333333333';
   const {JobThumbnails,CaptureJobPreview,PreviewJob,SavedLocation}=await import(`../${root}/jobs.js`);
   globalThis.chrome={storage:{local:{get:async Key=>({[Key]:{requestId:Id,youtube:true,state:'active'}})},session:{get:async()=>({})}}};
   try { for(const Read of [()=>JobThumbnails([Id]),()=>CaptureJobPreview(Id),()=>PreviewJob(Id)]) await assert.rejects(Read(),{key:'youtube_distribution_disabled'}); }
   finally {delete globalThis.chrome;}
   globalThis.chrome={storage:{local:{get:async Key=>({[Key]:{requestId:Id,youtube:true,state:'complete',exists:true,pickedDownloadFolder:'folder',filename:'saved.mp4'}})}}};
   try{await assert.rejects(SavedLocation(Id),{key:'youtube_distribution_disabled'});}finally{delete globalThis.chrome;}
  }
  else{
   const manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'));assert.deepEqual(manifest.sandbox.pages,['features/youtube/evaluator-sandbox.html']);assert.ok(manifest.content_security_policy.sandbox.includes("connect-src 'none'"));assert.ok(!(manifest.content_security_policy.extension_pages??"script-src 'self'").includes('unsafe-eval'));
   for(const name of names.filter(name=>/^(features|vendor)\/youtube\//.test(name))) assert.deepEqual(await readFile(`${root}/${name}`),await readFile(`extension/${name}`),name);
   assert.deepEqual(await readFile(`${root}/icons/youtube-brand-32.png`),await readFile('extension/icons/youtube-brand-32.png'));
  }
 }
 assert.equal(await readFile('extension/lib/distribution-policy.js', 'utf8'), original);
 for(const [Name,Hash] of SourceHashes) assert.equal(createHash('sha256').update(await readFile('extension/'+Name)).digest('hex'),Hash,'source changed: '+Name);
});

test('build lock is released when staging cleanup or lock metadata writing fails', async () => {
 for(const failure of ['cleanup','lock-write']) {
  const preload=`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
   const rm=fs.rm,open=fs.open;
   fs.rm=async(path,...args)=>{if(${JSON.stringify(failure)}==='cleanup'&&/staging-\\d+$/.test(String(path)))throw Error('injected cleanup failure');return rm(path,...args);};
   fs.open=async(path,...args)=>{const handle=await open(path,...args);if(${JSON.stringify(failure)}==='lock-write'&&String(path).endsWith('.build.lock'))handle.writeFile=async()=>{throw Error('injected lock write failure');};return handle;};
   syncBuiltinESMExports();`;
  const result=run('--import','data:text/javascript,'+encodeURIComponent(preload),'tools/build/package-extension.mjs','--flavor','chrome-store');
  try {
   assert.notEqual(result.status,0);
   assert.match(result.stderr,/injected/);
   await assert.rejects(stat('artifacts/distributions/chrome-store/.build.lock'),{code:'ENOENT'},failure);
  } finally {await rm('artifacts/distributions/chrome-store/.build.lock',{force:true});}
 }
});
