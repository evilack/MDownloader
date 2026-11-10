/** Production settings preview: typography, checkbox placement and native labels. */
import {mkdir,writeFile} from 'node:fs/promises';
import Path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const Base=process.env.CAPTION_UI_PREVIEW_URL;if(!Base)throw Error('CAPTION_UI_PREVIEW_URL is required');
const Out=Path.resolve('artifacts/caption-recognition-layout');await mkdir(Out,{recursive:true});
const {chromium}=await import(pathToFileURL(Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),Checks=[];
try{
 const Page=await Browser.newPage({viewport:{width:1280,height:1400}});
 await Page.goto(Base+'/options.html?section=captions&state=ready');await Page.waitForSelector('#caption-engine');
 // Mount the production form with a ready transport fixture. The older general
 // preview's package-2 probe would otherwise invoke unrelated helper setup.
 await Page.evaluate(async()=>{
  const {CreateCaptionSettings}=await import('./local-captions-ui.js'),{CaptionPackageVersion}=await import('./data/caption-runtime-metadata.js');
  const Ui=CreateCaptionSettings({probe:async()=>({connected:true,executionProtocol:2,engineReady:true,converterReady:true,modelManagement:true,modelDownloadVersion:3,captionTranslationVersion:1,recognitionOptionsVersion:1,captionPackageVersion:CaptionPackageVersion,installedModels:['base']})});
  document.getElementById('section-captions').replaceChildren(Ui.form);Ui.write({engine:'faster-whisper',model:'base',language:'auto',formats:['vtt']});await Ui.refresh();
 });
 await Page.locator('.caption-recognition-details').evaluate(E=>E.open=true);
 await Page.waitForFunction(()=>document.querySelector('.caption-recognition-options input[name=cpuThreads]')&&!document.querySelector('.caption-recognition-options input[name=cpuThreads]').disabled);
 for(const Engine of ['faster-whisper','whisper.cpp']){
  await Page.locator('#caption-engine').selectOption(Engine);await Page.locator('.caption-recognition-details').evaluate(E=>E.open=true);
  for(const Width of [1280,680,390]){
   await Page.setViewportSize({width:Width,height:1400});
   const Result=await Page.evaluate(()=>{
    const Root=document.querySelector('.caption-recognition-options'),Reference=Root.querySelector('.caption-preset-save-row label'),Font=N=>{const S=getComputedStyle(N);return {family:S.fontFamily,size:S.fontSize,weight:S.fontWeight,lineHeight:S.lineHeight};};
    const Pairs=[['conditionOnPreviousText','vadFilter']],TwoColumns=getComputedStyle(Root.querySelector('.caption-recognition-fields')).gridTemplateColumns.split(' ').length===2;
    const adjacentCenterDeltas=TwoColumns?Pairs.flatMap(([A,B])=>{const L=Root.querySelector('input[name='+A+']'),R=Root.querySelector('input[name='+B+']');if(!L||!R)return [];const X=L.getBoundingClientRect(),Y=R.getBoundingClientRect();return [{name:A,delta:Math.abs((X.top+X.bottom-Y.top-Y.bottom)/2)}];}):[];
    return {adjacentCenterDeltas,reference:Font(Reference),labels:[...Root.querySelectorAll('.caption-recognition-fields>label')].map(L=>({name:L.querySelector('input,select').name,text:L.textContent,font:Font(L)})),parentTitle:Font(Root.parentElement.closest('fieldset').querySelector(':scope>legend')),title:Font(Root.querySelector(':scope>legend')),
     checkboxes:[...Root.querySelectorAll('input[type=checkbox]')].map(C=>{const L=C.closest('label'),Text=[...L.childNodes].find(N=>N.nodeType===Node.TEXT_NODE&&N.textContent.trim()),R=document.createRange();R.selectNodeContents(Text);const B=C.getBoundingClientRect(),T=R.getBoundingClientRect();return {name:C.name,first:C===L.firstElementChild,left:B.right<=T.left,centerDelta:Math.abs((B.top+B.bottom-T.top-T.bottom)/2),labelFont:getComputedStyle(L).fontSize};}),overflow:document.documentElement.scrollWidth>innerWidth};
   });
   if(Engine==='faster-whisper')assert.deepEqual(Result.labels.map(L=>L.name),['cpuThreads','beamSize','bestOf','temperature','computeType','device','conditionOnPreviousText','vadFilter']);
   assert.equal(Result.reference.size,'12px');for(const Label of Result.labels)assert.equal(Label.font.size,Result.reference.size,Label.text);
   assert.deepEqual(Result.title,Result.parentTitle);assert.ok(Result.checkboxes.every(C=>C.first&&C.left&&C.centerDelta<=1));assert.ok(Result.adjacentCenterDeltas.every(C=>C.delta<=1),JSON.stringify(Result.adjacentCenterDeltas));assert.equal(Result.overflow,false);
   await Page.locator('.caption-recognition-options').screenshot({path:Path.join(Out,Engine+'-'+Width+'.png')});Checks.push({engine:Engine,width:Width,...Result});
  }
 }
 await Page.locator('#caption-engine').selectOption('faster-whisper');
 for(const Name of ['conditionOnPreviousText','vadFilter']){
  const Input=Page.locator('.caption-recognition-options input[name='+Name+']'),Before=await Input.isChecked();await Input.locator('..').click();assert.equal(await Input.isChecked(),!Before);await Input.focus();await Page.keyboard.press('Space');assert.equal(await Input.isChecked(),Before);
 }
 await writeFile(Path.join(Out,'result.json'),JSON.stringify({checks:Checks,labelClickAndKeyboard:true},null,2));console.log(JSON.stringify({passed:true,layouts:Checks.length,labelClickAndKeyboard:true,output:Out}));
}finally{await Browser.close();}
