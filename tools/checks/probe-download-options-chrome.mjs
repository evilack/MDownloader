/** Actual Chrome + real UI modules; provider/session fixtures, no billable requests. */
import {mkdir,writeFile,cp,copyFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const Root=fileURLToPath(new URL('../../',import.meta.url));
const Artifact=Path.join(Root,'artifacts/options/chrome-'+Date.now());await mkdir(Artifact,{recursive:true});
const Fixture=Path.join(Artifact,'extension');await cp(Path.join(Root,'extension'),Fixture,{recursive:true});
if(process.argv.includes('--baseline'))await copyFile('E:/Project/MDownloader/extension/download-options-dialog.js',Path.join(Fixture,'download-options-dialog.js'));
await writeFile(Path.join(Fixture,'fixture.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="style.css"><body><main><ul id="candidates"></ul><p id="notice" role="status"></p></main><script type="module" src="fixture.js"></script></body></html>');
await writeFile(Path.join(Fixture,'fixture.js'),String.raw`
import {InitializeLocale,Translate} from './lib/i18n.js';
import {CreateCandidateDownloadActions} from './candidate-download.js';
await chrome.storage.local.set({language:'ko',subtitleTranslation:{enabled:false,targetLanguage:'es',provider:'google',providers:{google:{key:'fixture-only-not-a-real-key'},openai:{key:'fixture-only-not-a-real-key',model:'fixture-small',models:[{id:'fixture-small',label:'Small',efforts:['low','high']},{id:'fixture-large',label:'Large',efforts:['medium']}]}}}});
await InitializeLocale('ko');
const state=window.fixture={enqueued:[],requests:[],delayPermission:false,pending:[],empty:false};
state.text=Translate;
const captions=[{id:'0',language:'en',label:'English'},{id:'1',language:'fr',label:'French'},{id:'2',language:'ko',label:'Korean'}];
chrome.runtime.sendMessage=async message=>{state.requests.push(message.type);if(message.type==='youtubeQualities')return{ok:true,data:[{resolution:'1920x1080',bandwidth:2000000,captions:state.empty?[]:captions,serverPermission:'https://*.googlevideo.com/*',quality:{videoId:'abcdefghijk',selection:{videoFormatId:'high',audioFormatId:'audio'}}},{resolution:'640x360',bandwidth:400000,captions:state.empty?[]:captions,serverPermission:'https://*.googlevideo.com/*',quality:{videoId:'abcdefghijk',selection:{videoFormatId:'low',audioFormatId:'audio'}}}]};if(message.type==='enqueue'){state.enqueued.push(message);return{ok:true,data:{state:'started'}};}return{ok:true,data:[]};};
chrome.permissions.request=async({origins})=>state.delayPermission&&origins.includes('https://*.googlevideo.com/*')?new Promise(resolve=>state.pending.push(resolve)):true;
const actions=CreateCandidateDownloadActions(text=>document.querySelector('#notice').textContent=text,()=>{});
const row=document.createElement('li');row.className='candidate';row.append(actions.CreateDownloadButton({format:'YOUTUBE',mediaKey:'fixture'},{tabId:1,scanId:'fixture',candidateId:1},()=>true));document.querySelector('#candidates').append(row);
state.ready=true;
`);
const {chromium}=await import(pathToFileURL(Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Context=await chromium.launchPersistentContext(Path.join(Artifact,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const Report={computerUse:false,actualChrome:true,fixture:'real candidate/dialog code; deterministic metadata/permissions only',paidRequests:false};
try{
 const Browser=await Context.browser().newBrowserCDPSession();Report.browser=(await Browser.send('Browser.getVersion')).product;
 const{id}=await Browser.send('Extensions.loadUnpacked',{path:Fixture});const Page=await Context.newPage();await Page.setViewportSize({width:420,height:780});await Page.goto('chrome-extension://'+id+'/fixture.html');await Page.waitForFunction(()=>window.fixture?.ready);
 const Dialog=Page.getByRole('dialog'),Open=Page.locator('#candidates button');
 async function open(){await Open.click({modifiers:['Shift']});await Dialog.getByRole('button',{name:'다운로드',exact:true}).waitFor();await Page.waitForFunction(()=>{const s=document.querySelector('dialog select');return s?.options.length===2;});}
 await Open.click();await Page.waitForFunction(()=>fixture.enqueued.length===1);
 Report.normalClickQuick=!(await Dialog.isVisible())&&await Page.evaluate(()=>fixture.enqueued[0].quality.selection.videoFormatId==='high'&&fixture.enqueued[0].subtitleOptions===undefined);
 await Page.evaluate(()=>fixture.enqueued=[]);
 await open();Report.title=await Dialog.getByRole('heading',{level:2}).textContent();await Page.screenshot({path:Artifact+'/options-420.png'});
 // Locale wording can vary; labels are inspected rather than silently assuming an index.
 const labels=await Dialog.locator('label').allTextContents();Report.labels=labels;
 const selectQuality=Dialog.locator('select').first();await selectQuality.selectOption('1');
 await Dialog.getByRole('checkbox',{name:'French (fr)',exact:true}).uncheck();await Dialog.getByRole('checkbox',{name:'Korean (ko)',exact:true}).uncheck();
 const translation=Dialog.locator('section').last().getByRole('checkbox');await translation.check();
 const target=Dialog.locator('section').last().locator('input[type="text"],input:not([type])').first();await target.fill('es');
 await Dialog.locator('summary').click();const provider=Dialog.locator('details select').nth(0);await provider.selectOption('openai');
 await Dialog.locator('details select').nth(1).selectOption('fixture-large');await Dialog.locator('details select').nth(2).selectOption('medium');
 await Page.screenshot({path:Artifact+'/options-translation.png'});
 await Dialog.getByRole('button',{name:'다운로드',exact:true}).click();await Dialog.waitFor({state:'hidden'});
 const chosen=await Page.evaluate(()=>fixture.enqueued[0]);Report.selection={quality:chosen.quality,subtitles:chosen.subtitleOptions,noCredential:!JSON.stringify(chosen).includes('fixture-only-not-a-real-key')};
 // Regression: a valid submit must disable the action; its late permission result
 // must never close a freshly reopened dialog or enqueue canceled choices.
 await Page.evaluate(()=>{fixture.enqueued=[];fixture.delayPermission=true;});await open();await Dialog.getByRole('button',{name:'다운로드',exact:true}).click();
 Report.submitDisabled=await Dialog.getByRole('button',{name:'다운로드',exact:true}).isDisabled();
 await Page.keyboard.press('Escape');await Dialog.waitFor({state:'hidden'});await open();await Page.evaluate(()=>{for(const resolve of fixture.pending.splice(0))resolve(true);fixture.delayPermission=false;});
 await new Promise(resolve=>setTimeout(resolve,100));Report.stalePermissionSafe=await Dialog.isVisible()&&await Page.evaluate(()=>fixture.enqueued.length===0);
 if(await Dialog.isVisible()){await Page.keyboard.press('Escape');await Dialog.waitFor({state:'hidden'});}
 Report.focusReturned=await Open.evaluate(e=>e===document.activeElement);
 await open();await target.fill('ko');
 Report.existingTargetReused=await Dialog.getByRole('checkbox',{name:'Korean (ko)',exact:true}).isChecked()&&await Dialog.getByRole('checkbox',{name:'Korean (ko)',exact:true}).isDisabled()&&!await Dialog.locator('details').isVisible();
 await Page.keyboard.press('Escape');await Dialog.waitFor({state:'hidden'});
 await Page.evaluate(async()=>{const {subtitleTranslation}=await chrome.storage.local.get('subtitleTranslation');subtitleTranslation.providers.openai.key='';await chrome.storage.local.set({subtitleTranslation});fixture.enqueued=[];});
 await open();await target.fill('es');await Dialog.getByRole('button',{name:'다운로드',exact:true}).click();
 Report.missingCredentialsBlocked=await Dialog.isVisible()&&await Page.evaluate(()=>fixture.enqueued.length===0)&&await Dialog.locator('[role="status"]').innerText()===await Page.evaluate(()=>fixture.text('download_options_auth_required'));
 await Page.keyboard.press('Escape');await Dialog.waitFor({state:'hidden'});
 await Page.evaluate(()=>{fixture.empty=true;fixture.enqueued=[];});await open();Report.noSubtitleMessage=await Dialog.getByText('다운로드할 수 있는 자막이 없습니다.',{exact:true}).count()>0;
 await Page.setViewportSize({width:360,height:640});await Page.screenshot({path:Artifact+'/options-360.png'});Report.noHorizontalOverflow=await Dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().width<=innerWidth);
 await Dialog.getByRole('button',{name:'다운로드',exact:true}).click();await Dialog.waitFor({state:'hidden'});
 Report.avOnlyWithoutSubtitles=await Page.evaluate(()=>fixture.enqueued[0].subtitleOptions.trackIds.length===0&&!fixture.enqueued[0].subtitleOptions.translation.enabled);
 Report.passed=Report.normalClickQuick&&Report.title==='다운로드 옵션'&&Report.selection.quality.selection.videoFormatId==='low'&&JSON.stringify(Report.selection.subtitles.trackIds)==='["0"]'&&Report.selection.subtitles.translation.model==='fixture-large'&&Report.selection.noCredential&&Report.submitDisabled&&Report.stalePermissionSafe&&Report.focusReturned&&Report.noSubtitleMessage&&Report.noHorizontalOverflow&&Report.existingTargetReused&&Report.missingCredentialsBlocked&&Report.avOnlyWithoutSubtitles;
}catch(error){Report.failure=String(error.message).slice(0,400);}
finally{await writeFile(Artifact+'/result.json',JSON.stringify(Report,null,2));console.log(JSON.stringify({artifact:Artifact,...Report}));await Context.close();}
if(!Report.passed)process.exitCode=2;
