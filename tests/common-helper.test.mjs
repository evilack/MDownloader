import test from 'node:test';import assert from 'node:assert/strict';
import {InstallCaptionsWithCommonHelper,ProbeCommonHelper} from '../extension/lib/common-helper.js';
import {InstallCaptionHelper,DownloadCaptionInstaller} from '../extension/lib/caption-installer.js';
import {readFile} from 'node:fs/promises';
import {CaptionPackageVersion} from '../extension/lib/caption-runtime-contract.js';
const HelperReady=()=>({ok:true,protocol:1,platform:'win',helperVersion:9,helperRevision:1,capabilities:['captionSetup','captionPackageUpdate','genericPackageManifest']});
const RuntimeReady=()=>({connected:true,executionProtocol:2,engineReady:true,converterReady:true,modelManagement:true,modelDownloadVersion:3,captionTranslationVersion:1,recognitionOptionsVersion:1,captionPackageVersion:CaptionPackageVersion});
test('caption installation uses a registered common helper and verifies the actual caption host without any downloads API',async()=>{
 const Bundle=JSON.parse(await readFile(new URL('../extension/data/caption-installer.json',import.meta.url),'utf8')),Calls=[];let Checks=0;const request=async M=>{Calls.push(M);return M.action==='ping'?HelperReady() : M.action==='installCaptions'?{ok:true,jobId:'a'.repeat(32),status:'installing'}:{ok:true,jobId:'a'.repeat(32),status:++Checks===2?'complete':'installing'};};
 const Result=await InstallCaptionsWithCommonHelper(async()=>RuntimeReady(),()=>{},{request,wait:async()=>{},bundle:Bundle});
 assert.equal(Result.connected,true);assert.deepEqual(Calls.map(M=>M.action),['ping','installCaptions','captionSetupStatus','captionSetupStatus']);assert.ok(Calls.every(M=>!('path'in M)&&!('command'in M)&&!('files'in M)));
 assert.deepEqual(Calls[1].package,Bundle);
});
test('legacy and missing helper produce distinct actionable errors before any setup request',async()=>{
 await assert.rejects(InstallCaptionsWithCommonHelper(()=>assert.fail('not installed'),()=>{},{request:async()=>({ok:true,protocol:1}),wait:async()=>{}}),/common_helper_update_required/);
 assert.deepEqual(await ProbeCommonHelper(async()=>{throw Error('missing');}),{connected:false,ready:false,reason:'unavailable'});
});
test('worker completion without caption engine readiness cannot become installation success',async()=>{
 let Clock=0;await assert.rejects(InstallCaptionsWithCommonHelper(async()=>({...RuntimeReady(),engineReady:false}),()=>{},{request:async M=>M.action==='ping'?HelperReady():{ok:true,status:'complete',jobId:'a'.repeat(32)},wait:async()=>{},now:()=>Clock+=100,timeout:300}),/common_setup_timeout/);
});
test('failed worker stops polling and exposes failure without attempting another installer path',async()=>{
 await assert.rejects(InstallCaptionsWithCommonHelper(()=>assert.fail('failed worker probed as ready'),()=>{},{request:async M=>M.action==='ping'?HelperReady():{ok:true,status:'failed',error:'runtime_download_failed',jobId:'a'.repeat(32)},wait:async()=>{}}),/runtime_download_failed/);
});
test('Windows options installer succeeds with no chrome.downloads or permission APIs',async t=>{
 const Calls=[],Messages=[],Bundle=JSON.parse(await readFile(new URL('../extension/data/caption-installer.json',import.meta.url),'utf8')),PreviousFetch=globalThis.fetch;
 globalThis.fetch=async Url=>{assert.equal(Url,'chrome-extension://'+'a'.repeat(32)+'/data/caption-installer.json');return {ok:true,json:async()=>Bundle};};
 globalThis.chrome={runtime:{id:'a'.repeat(32),getURL:Name=>'chrome-extension://'+'a'.repeat(32)+'/'+Name,sendMessage:async M=>{Calls.push(M.type);return {ok:true};},connectNative(){let Reply;return{onMessage:{addListener:F=>Reply=F},onDisconnect:{addListener(){}},disconnect(){},postMessage(M){Calls.push(M.action);Messages.push(M);queueMicrotask(()=>Reply(M.action==='ping'?HelperReady():{ok:true,status:'complete',jobId:'a'.repeat(32)}));}};}}};t.after(()=>{delete globalThis.chrome;globalThis.fetch=PreviousFetch;});
 const Result=await InstallCaptionHelper('win',async Options=>{assert.deepEqual(Options,{engine:'faster-whisper',model:''});return RuntimeReady();});assert.equal(Result.connected,true);assert.deepEqual(Calls,['captionReconnect','ping','installCaptions','captionReconnect']);assert.deepEqual(Messages.find(M=>M.action==='installCaptions').package,Bundle);
 await assert.rejects(DownloadCaptionInstaller('win'),/common_helper_required/);
});
test('an unresponsive common helper cannot keep setup pending past its deadline',async()=>{
 await assert.rejects(InstallCaptionsWithCommonHelper(()=>assert.fail('no helper reply'),()=>{},{request:()=>new Promise(()=>{}),timeout:20}),/common_setup_timeout/);
});
