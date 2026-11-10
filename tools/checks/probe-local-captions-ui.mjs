import {createRequire} from 'node:module';import {writeFile} from 'node:fs/promises';import assert from 'node:assert/strict';
import {ProjectPath} from '../lib/tool-config.mjs';
const Playwright=createRequire(import.meta.url)(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||'playwright');
const Browser=await Playwright.chromium.launch({headless:true,executablePath:process.env.MDOWNLOADER_BROWSER_PATH});
const Base=process.env.CAPTION_UI_PREVIEW_URL||'http://127.0.0.1:54802',Errors=[],Checks=[];
try{
 const Page=await Browser.newPage({viewport:{width:1280,height:1000}});Page.on('pageerror',E=>Errors.push(E.message));
 await Page.goto(Base+'/options.html?section=captions&state=model');await Page.evaluate(()=>localStorage.removeItem('caption-pages-preview'));await Page.reload();
 await Page.waitForFunction(()=>document.querySelector('#caption-model')?.disabled===true);
 assert.equal(await Page.locator('#caption-model').inputValue(),'');assert.deepEqual(await Page.locator('#caption-model option').allTextContents(),['설치된 모델 없음']);Checks.push('initial-no-model');
 await Page.locator('#caption-download-model').selectOption('tiny');await Page.getByRole('button',{name:'모델 다운로드',exact:true}).click();await Page.waitForFunction(()=>document.querySelector('#caption-model').value==='tiny');Checks.push('explicit-download-and-select');
 await Page.locator('#caption-enabled').check();await Page.locator('#apply-settings').click();await Page.waitForFunction(()=>document.querySelector('#local-captions-status').textContent.includes('적용했습니다'));Checks.push('saved-defaults');
 await Page.locator('#caption-language').selectOption('en');await Page.locator('#reset-settings').click();await Page.waitForFunction(()=>document.querySelector('#caption-model').value==='tiny'&&document.querySelector('#caption-language').value==='auto');Checks.push('revert-preserves-model');
 for(const Width of [1280,680,390]){
  await Page.setViewportSize({width:Width,height:1000});
  const Layout=await Page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,vertical:[...document.querySelectorAll('#settings-nav a')].every((N,I,A)=>I===0||N.getBoundingClientRect().top>A[I-1].getBoundingClientRect().top)}));assert.equal(Layout.overflow,false);assert.equal(Layout.vertical,true);
  await Page.screenshot({path:ProjectPath('artifacts/local-captions-settings-'+Width+'.png'),fullPage:true});
 }Checks.push('vertical-tabs-and-no-overflow-1280-680-390');
 await Page.setViewportSize({width:1280,height:1000});await Page.locator('#caption-download-model').focus();await Page.keyboard.press('Tab');const Focus=await Page.evaluate(()=>({tag:document.activeElement.tagName,outline:getComputedStyle(document.activeElement).outlineStyle}));assert.notEqual(Focus.outline,'none');Checks.push('keyboard-visible-focus');
 await Page.goto(Base+'/download-options-preview.html?state=model');await Page.waitForFunction(()=>document.querySelector('#caption-override')&&!document.querySelector('button[type=submit]').disabled);assert.match(await Page.locator('.download-options-captions').textContent(),/tiny/);
 await Page.locator('#caption-override').selectOption('off');await Page.getByRole('button',{name:'다운로드',exact:true}).click();await Page.waitForFunction(()=>document.querySelector('#preview-result').textContent.includes('captionOverride'));assert.match(await Page.locator('#preview-result').textContent(),/"captionOverride":"off"/);Checks.push('per-download-override');
 await Page.goto(Base+'/options.html?section=captions&state=model&os=mac');await Page.waitForFunction(()=>document.querySelector('#caption-engine'));assert.deepEqual(await Page.locator('#caption-engine option').allTextContents(),['whisper.cpp']);Checks.push('mac-engine-restriction');
 await Page.goto(Base+'/options.html?section=captions&state=missing');await Page.waitForFunction(()=>document.querySelector('#caption-connection')?.textContent.includes('연결되지 않음'));assert.equal(await Page.getByRole('button',{name:'모델 다운로드',exact:true}).isDisabled(),true);Checks.push('missing-helper-state');
 await Page.locator('#caption-install').click();await Page.waitForFunction(()=>document.querySelector('#caption-install').hidden);assert.match(await Page.locator('#caption-connection').textContent(),/연결됨/);Checks.push('shared-install-button-connects-without-caption-cmd');
 await Page.goto(Base+'/options.html?section=captions&state=missing&helper=legacy');await Page.waitForFunction(()=>document.querySelector('#caption-common-install')?.textContent.includes('업데이트'));assert.equal(await Page.locator('#caption-install').isDisabled(),true);await Page.locator('#caption-common-install').click();await Page.waitForFunction(()=>document.querySelector('#caption-install').hidden);Checks.push('legacy-common-helper-update-continues-caption-setup');
 await Page.goto(Base+'/options.html?section=captions&state=missing&helper=missing');await Page.waitForFunction(()=>document.querySelector('#caption-connection')?.textContent.includes('공통 도우미 설치 필요'));assert.equal(await Page.locator('#caption-common-install').isVisible(),true);assert.equal(await Page.locator('#caption-install').isDisabled(),true);Checks.push('missing-common-helper-state');
 await Page.goto(Base+'/captions-setup.html');await Page.waitForSelector('#setup-install');
 for(const Width of [1280,390]){await Page.setViewportSize({width:Width,height:1000});assert.equal(await Page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok(await Page.locator('.setup-card p').first().evaluate(N=>parseFloat(getComputedStyle(N).fontSize))>=16);await Page.screenshot({path:ProjectPath('artifacts/local-captions-guide-'+Width+'.png'),fullPage:true});}
 assert.equal(await Page.locator('pre').count(),0);await Page.locator('#setup-install').click();await Page.waitForFunction(()=>document.querySelector('#setup-install').hidden);Checks.push('readable-guide-shares-real-installer-no-command-entry');
 assert.deepEqual(Errors,[]);await writeFile(ProjectPath('artifacts/local-captions-ui-evidence.json'),JSON.stringify({checks:Checks,errors:Errors},null,2));console.log(JSON.stringify({checks:Checks,errors:Errors}));
}finally{await Browser.close();}
