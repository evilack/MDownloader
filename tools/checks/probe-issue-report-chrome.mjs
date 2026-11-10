/** Isolated UI -> worker -> POST verification. Default is loopback-only; --live sends one marked test. */
import Assert from 'node:assert/strict';
import Http from 'node:http';
import Path from 'node:path';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const Live=process.argv.includes('--live');
const Root=Path.resolve(import.meta.dirname,'../..');
const Artifact=Path.join(Root,'artifacts',`issue-report-${Live?'live':'mock'}-${Date.now()}`);
await mkdir(Artifact,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||Path.resolve(process.execPath,'../../node_modules/playwright/index.mjs')));
const Requests=[];
const RequestHeaders=[];
let Mode='failure',Release;
const Server=Http.createServer(async(Request,Response)=>{
 const Parts=[];for await(const Part of Request)Parts.push(Part);
 Requests.push(JSON.parse(Buffer.concat(Parts).toString('utf8')));
 RequestHeaders.push({origin:Request.headers.origin,referer:Request.headers.referer});
 if(Mode==='held')await new Promise(Resolve=>{Release=Resolve;});
 Response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(Mode==='failure'?{success:'false',message:'Rejected'}:{success:'true'}));
});
if(!Live)await new Promise(Resolve=>Server.listen(0,'127.0.0.1',Resolve));
const Extension=Path.join(Artifact,'extension');
await cp(Path.join(Root,'extension'),Extension,{recursive:true,filter:Source=>Path.basename(Source)!=='.local'});
if(!Live){
 const Module=Path.join(Extension,'lib/issue-report.js');
 await writeFile(Module,(await readFile(Module,'utf8')).replace('https://formsubmit.co/ajax/evilackyt01@gmail.com',`http://127.0.0.1:${Server.address().port}/submit`));
 const Manifest=JSON.parse(await readFile(Path.join(Extension,'manifest.json'),'utf8'));Manifest.host_permissions.push('http://127.0.0.1/*');
 await writeFile(Path.join(Extension,'manifest.json'),JSON.stringify(Manifest));
}
const Context=await chromium.launchPersistentContext(Path.join(Artifact,'profile'),{headless:true,executablePath:process.env.MDOWNLOADER_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const Report={mode:Live?'live':'loopback-only',installedExtensionReloaded:false,checks:[],errors:[]};
let Page;
Context.on('response',async Response=>{
 if(Response.url().startsWith('https://formsubmit.co/ajax/')){
  Report.serviceStatus=Response.status();
  Report.responseOrigin=await Response.headerValue('access-control-allow-origin');
  try{Report.serviceResponse=await Response.text();}catch{}
 }
});
try{
 const CDP=await Context.browser().newBrowserCDPSession();const {id}=await CDP.send('Extensions.loadUnpacked',{path:Extension});
 Page=await Context.newPage();await Page.setViewportSize({width:500,height:560});
 Page.on('pageerror',E=>Report.errors.push(E.message));
 await Page.goto(`chrome-extension://${id}/popup.html`);
 await Page.getByRole('button',{name:/이슈 신고|Report an issue/}).waitFor();
 await Page.evaluate(async()=>{
  const {InitializeLocale}=await import('./lib/i18n.js');await InitializeLocale('ko');
  const {ShowIssueReportDialog}=await import('./issue-report-dialog.js');
  // A toolbar popup opened as a full tab otherwise detects its own extension URL.
  ShowIssueReportDialog({url:'https://example.com/mdownloader-report-integration-test'});
 });
 const Dialog=Page.locator('.issue-report-dialog:not(.issue-report-message)');const Confirm=Dialog.getByRole('button',{name:'확인',exact:true});
 const Result=Page.locator('.issue-report-message[data-issue-report-stage="result"]');
 const Pending=Page.locator('.issue-report-message[data-issue-report-stage="sending"]');
 await Page.getByLabel('URL 탐색 실패',{exact:true}).check();
 await Page.getByLabel('다운로드 실패',{exact:true}).check();
 const Details=Page.getByLabel('상세 내용 (선택)');
 await Details.fill('MDownloader 신고 전송 구현 검증용 테스트입니다. 실제 사용자 오류 신고가 아닙니다.');
 await Page.screenshot({path:Path.join(Artifact,'ready.png')});
 if(!Live){
  await Confirm.click();await Result.getByText('신고 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.',{exact:true}).waitFor();
  await Page.screenshot({path:Path.join(Artifact,'failure-notice.png')});
  await Result.getByRole('button',{name:'확인',exact:true}).click();await Result.waitFor({state:'detached'});
  Assert.equal(await Dialog.isVisible(),true);
  Assert.equal(await Confirm.isEnabled(),true);Assert.equal(await Details.isEnabled(),true);
  Assert.match(await Details.inputValue(),/구현 검증용 테스트/);Assert.equal(Requests.length,1);
  Report.checks.push('failure preserves inputs and permits manual retry');
  Assert.equal(await Page.evaluate(async()=> (await chrome.declarativeNetRequest.getSessionRules()).some(Rule=>Rule.id===2147000001)),false);
  Mode='held';await Confirm.click();await Pending.waitFor();
  Assert.equal(await Pending.evaluate(Node=>Node.matches(':modal')),true);
  Assert.equal(await Page.evaluate(()=>{const Input=document.querySelector('.issue-report-dialog:not(.issue-report-message) input[readonly]');Input.focus();return document.activeElement===Input;}),false,'even the read-only URL cannot receive focus while sending');
  Assert.equal(await Confirm.isDisabled(),true);Assert.equal(await Details.isDisabled(),true);
  await Page.evaluate(()=>document.querySelector('.issue-report-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await Page.keyboard.press('Escape');Assert.equal(await Pending.isVisible(),true);Assert.equal(await Dialog.isVisible(),true);
  await Page.screenshot({path:Path.join(Artifact,'sending.png')});
  await Page.waitForFunction(()=>!!document.querySelector('form[aria-busy="true"]'));
  // Wait for the loopback server to receive the worker fetch, then release the held response.
  for(let I=0;I<100&&!Release;I++)await new Promise(Resolve=>setTimeout(Resolve,10));
  Assert.equal(Requests.length,2);Assert.equal(typeof Release,'function');Release();
  Report.checks.push('pending locks fields, blocks Escape and ignores duplicate submit');
 }else await Confirm.click();
 await Result.waitFor({timeout:25000});
 Report.feedback=await Dialog.getByRole('status').textContent();
 Assert.equal(Report.feedback,'신고가 접수되었습니다.');
 Assert.equal(await Confirm.isDisabled(),true);
 Assert.equal(await Result.getByRole('button',{name:'확인',exact:true}).evaluate(Node=>Node===document.activeElement),true);
 Assert.equal(await Pending.count(),0);
 await Page.keyboard.press('Escape');Assert.equal(await Result.isVisible(),true);
 await Page.screenshot({path:Path.join(Artifact,'accepted.png')});
 Report.checks.push('actual extension UI and worker show accepted result');
 Assert.equal(await Page.evaluate(async()=> (await chrome.declarativeNetRequest.getSessionRules()).some(Rule=>Rule.id===2147000001)),false);
 await Page.evaluate(()=>document.querySelector('.issue-report-dialog form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 if(!Live){
  Assert.equal(Requests.length,2);
  for(const Body of Requests){
   Assert.deepEqual(Object.keys(Body).sort(),['_subject','_url','message']);
   Assert.match(Body._subject,/^MDownloader_report_\d{8}-\d{6}_[a-f0-9]{8}$/);
   const Data=JSON.parse(Body.message);Assert.equal(Data.page_url,'https://example.com/mdownloader-report-integration-test');
   Assert.deepEqual(Data.issue_types,['url_detection_failed','download_failed']);
  }
  Report.checks.push('success blocks repeat sends; request has unique title, report JSON and no name');
  Report.subjects=Requests.map(Body=>Body._subject);
  Assert.deepEqual(RequestHeaders,[{origin:'https://evilack.github.io',referer:'https://evilack.github.io/'},{origin:'https://evilack.github.io',referer:'https://evilack.github.io/'}]);
  Report.checks.push('wire headers use one stable app identity; temporary rules removed after success and failure');
 }
 await Result.getByRole('button',{name:'확인',exact:true}).click();await Result.waitFor({state:'detached'});await Dialog.waitFor({state:'detached'});
 Report.checks.push('success acknowledgement closes both result and report dialogs; failure acknowledgement preserves report');
 await Page.evaluate(()=>chrome.storage.local.set({showPanelMedia:true}));
 await Page.goto(`chrome-extension://${id}/sidepanel.html`);
 await Page.getByRole('button',{name:/이슈 신고|Report an issue/}).click();
 await Page.getByRole('dialog').waitFor();Report.checks.push('actual sidepanel shares updated dialog');
 Assert.deepEqual(Report.errors,[]);
 console.log(JSON.stringify({...Report,artifact:Artifact},null,2));
}catch(E){Report.failure=E.message;if(Page){Report.feedback=await Page.locator('.issue-report-feedback').textContent().catch(()=>null);await Page.screenshot({path:Path.join(Artifact,'failure.png')}).catch(()=>{});}console.log(JSON.stringify(Report,null,2));throw E;}
finally{Release?.();await writeFile(Path.join(Artifact,'verification.json'),JSON.stringify(Report,null,2));await Context.close();if(!Live)await new Promise(Resolve=>Server.close(Resolve));}
