import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const run = (...args) => spawnSync(process.execPath, args, {encoding: 'utf8'});
test('flavor is mandatory, independent packages exclude executable YouTube files from store', async () => {
 assert.notEqual(run('tools/build/package-extension.mjs').status, 0);
 assert.notEqual(run('tools/build/package-extension.mjs', '--flavor', 'invalid').status, 0);
 const original = await readFile('extension/lib/distribution-policy.js', 'utf8');
 assert.notEqual(run('tools/build/package-extension.mjs', '--flavor', 'manual').status, 0);
 for (const flavor of ['development', 'chrome-store']) {
  const result = run('tools/build/package-extension.mjs', '--flavor', flavor);
  assert.equal(result.status, 0, result.stderr);
  const root = `artifacts/distributions/${flavor}/extension`;
  const policy = await import(`../${root}/lib/distribution-policy.js?${Date.now()}`);
  assert.equal(policy.DistributionPolicy.flavor, flavor);
  assert.equal(policy.CanUseYoutube({...policy.DistributionPolicy, youtubeEnabled: true}, 'chrome'), flavor !== 'chrome-store');
  const verified = run('--expose-internals', 'tools/checks/verify-distribution.mjs', '--flavor', flavor);
  assert.equal(verified.status, 0, verified.stderr + verified.stdout);
  if (flavor === 'chrome-store') {
   const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
   assert.ok(manifest.permissions.includes('declarativeNetRequest'));
   assert.ok(!manifest.permissions.includes('declarativeNetRequestWithHostAccess'));
   assert.equal(manifest.sandbox,undefined);assert.equal(manifest.content_security_policy?.sandbox,undefined);
   assert.deepEqual(await readdir(`${root}/features/youtube`), ['entry.js']);
   const entry = await import(`../${root}/features/youtube/entry.js`);
   assert.equal(entry.YoutubeAvailable(), false);
   await assert.rejects(entry.DiscoverYoutube(), {key: 'youtube_distribution_disabled'});
   const Id='33333333-3333-3333-3333-333333333333';
   const {JobThumbnails,CaptureJobPreview,PreviewJob,SavedLocation}=await import(`../${root}/jobs.js`);
   globalThis.chrome={storage:{local:{get:async Key=>({[Key]:{requestId:Id,youtube:true,state:'active'}})},session:{get:async()=>({})}}};
   try { for(const Read of [()=>JobThumbnails([Id]),()=>CaptureJobPreview(Id),()=>PreviewJob(Id)]) await assert.rejects(Read(),{key:'youtube_distribution_disabled'}); }
   finally {delete globalThis.chrome;}
   globalThis.chrome={storage:{local:{get:async Key=>({[Key]:{requestId:Id,youtube:true,state:'complete',exists:true,pickedDownloadFolder:'folder',filename:'saved.mp4'}})}}};
   try{await assert.rejects(SavedLocation(Id),{key:'youtube_distribution_disabled'});}finally{delete globalThis.chrome;}
  }
  else{const manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'));assert.deepEqual(manifest.sandbox.pages,['features/youtube/evaluator-sandbox.html']);assert.ok(manifest.content_security_policy.sandbox.includes("connect-src 'none'"));assert.ok(!(manifest.content_security_policy.extension_pages??"script-src 'self'").includes('unsafe-eval'));}
 }
 assert.equal(await readFile('extension/lib/distribution-policy.js', 'utf8'), original);
});
