/** Real Rumble DVR segments through a copied extension; never reloads the user's extension. */
import Assert from 'node:assert/strict';
import {mkdir,cp,readFile,writeFile} from 'node:fs/promises';
import Path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {openAsBlob} from 'node:fs';
import {Input,BlobSource,ALL_FORMATS,EncodedPacketSink} from '../../extension/vendor/mediabunny-1.65.2.mjs';

const Stream=process.env.MDOWNLOADER_RUMBLE_STREAM_URL;
Assert.ok(Stream,'Set MDOWNLOADER_RUMBLE_STREAM_URL to a currently observed Rumble DVR media playlist');
const Root=fileURLToPath(new URL('../../',import.meta.url));
const Out=Path.join(Root,'artifacts/rumble-live','current-'+Date.now());
await mkdir(Path.join(Out,'downloads'),{recursive:true});
const ExtPath=Path.join(Out,'extension'); await cp(Path.join(Root,'extension'),ExtPath,{recursive:true});
const Manifest=JSON.parse(await readFile(Path.join(ExtPath,'manifest.json')));
Manifest.host_permissions.push('http://127.0.0.1/*',new URL(Stream).origin+'/*');
await writeFile(Path.join(ExtPath,'manifest.json'),JSON.stringify(Manifest));
await writeFile(Path.join(ExtPath,'popup.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live start verification</title><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="download-options.css"><link rel="stylesheet" href="local-captions.css"><body class="popup"><main><div class="quality-slot" id="mount"></div></main></body></html>');
const RunnerPath=Path.join(ExtPath,'hls-runner.js');
await writeFile(RunnerPath,'globalThis.RumbleProbeRequests=[];const RumbleProbeFetch=globalThis.fetch;globalThis.fetch=function(...Args){RumbleProbeRequests.push(String(Args[0]?.url||Args[0]));return RumbleProbeFetch.apply(this,Args);};\n'+await readFile(RunnerPath,'utf8'));
const Server=createServer((_Q,R)=>R.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Rumble live-start verification</title><video controls src="'+Stream.replaceAll('&','&amp;')+'"></video>'));
await new Promise(R=>Server.listen(0,'127.0.0.1',R));
const Source='http://127.0.0.1:'+Server.address().port+'/';
const {chromium}=await import(pathToFileURL(Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const C=await chromium.launchPersistentContext(Path.join(Out,'profile'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
	ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
const Report={isolatedCopiedExtension:true,sourcePlayerFixture:Source,realRumbleMedia:Stream,requests:[]};
try {
	const B=await C.browser().newBrowserCDPSession();
	await B.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:Path.join(Out,'downloads')});
	const {id}=await B.send('Extensions.loadUnpacked',{path:ExtPath});
	const E=await C.newPage();await E.goto(`chrome-extension://${id}/popup.html`);await E.setViewportSize({width:420,height:900});
	await E.evaluate(async()=>{await chrome.storage.local.set({language:'ko',usePageTitle:false,useDownloadDateTime:false,notifyDownloadComplete:false,localCaptions:{enabled:false},subtitleTranslation:{enabled:false}});await (await import('./hls-discovery.js')).SyncHlsDiscovery();});
	const P=await C.newPage();await P.goto(Source);await P.waitForTimeout(500);
	const TabId=await E.evaluate(async U=>(await chrome.tabs.query({url:U}))[0].id,Source);
	Report.playlist=await E.evaluate(async U=>{
		const {ReadPlaylist}=await import('./lib/hls-http.js'),{ParseMediaPlaylist}=await import('./lib/hls.js');
		const L=ParseMediaPlaylist(await ReadPlaylist(U),U);
		return {ended:L.ended,count:L.segments.length,first:L.segments[0].sequence,last:L.segments.at(-1).sequence,target:L.targetDuration};
	},Stream);
	Assert.equal(Report.playlist.ended,false);Assert.ok(Report.playlist.count>30);
	await P.bringToFront();
	Report.selection=await E.evaluate(async({TabId,Stream})=>{
		const {Scan,ResolveCandidate}=await import('./detection.js');const S=await Scan(TabId,'popup');
		const V=S.candidates?.find(V=>V.format==='M3U8');if(!V)throw Error(JSON.stringify(S));
		const Input={tabId:TabId,scanId:S.scanId,candidateId:V.id,scope:'popup'};
		const {InitializeLocale}=await import('./lib/i18n.js');await InitializeLocale('ko');
		const {CreateDownloadOptionsDialog}=await import('./download-options-dialog.js');
		globalThis.RumbleInput=Input;globalThis.RumbleOptions=CreateDownloadOptionsDialog();
		globalThis.RumbleSelection=RumbleOptions.openInline({...V,live:true},Input,document.getElementById('mount'));
		return {candidate:V,source:(await ResolveCandidate(TabId,S.scanId,V.id,'popup')).url};
	},{TabId,Stream});
	if(process.argv.includes('--badge-only')){
		Assert.equal(Report.selection.candidate.dvr,true,'real retained history must be exposed by normal scan');
		Report.badge=await E.evaluate(async Candidate=>{
			RumbleOptions.close();const Mount=document.getElementById('mount');Mount.replaceChildren();
			const Css=document.createElement('link');Css.rel='stylesheet';Css.href='media-row.css';document.head.append(Css);
			const {CreateCandidateRow}=await import('./candidate-row.js');
			const Thumb=document.createElement('div');Thumb.className='preview-anchor';
			const Button=document.createElement('button');Button.textContent='↓';
			const Entry=CreateCandidateRow(Candidate,{thumbnail:{control:Thumb},download:Button});
			const List=document.createElement('ul');List.append(Entry.row);Mount.append(List);
			return {text:Entry.row.innerText,badge:Entry.row.querySelector('.candidate-format').textContent,live:!Entry.live.hidden,format:Candidate.format};
		},Report.selection.candidate);
		Assert.equal(Report.badge.badge,'DVR');Assert.equal(Report.badge.live,true);Assert.equal(Report.badge.format,'M3U8');
		await E.bringToFront();await E.locator('.media-row').screenshot({path:Path.join(Out,'dvr-badge.png')});
	}else{
	try{await E.waitForFunction(()=>!document.querySelector('.download-options-editor button[type=submit]')?.disabled);}
	catch(ErrorValue){Report.uiFailure=await E.evaluate(()=>({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(B=>({text:B.textContent,disabled:B.disabled}))}));console.log(JSON.stringify(Report.uiFailure));throw ErrorValue;}
	await E.bringToFront();
	const Start=E.locator('select[name=download_options_live_start]');
	Assert.equal(await Start.inputValue(),'beginning');await Start.selectOption('current');
	Report.ui={label:await E.locator('label[for="'+await Start.getAttribute('id')+'"]').innerText(),selected:await Start.inputValue()};
	Report.ui.layout=[];
	for(const Width of [420,340]){
		await E.setViewportSize({width:Width,height:900});await E.evaluate(W=>{document.body.classList.toggle('popup',W===420);},Width);await Start.focus();
		const Layout=await E.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,help:!!document.querySelector('select[name=download_options_live_start]').getAttribute('aria-describedby'),focus:getComputedStyle(document.activeElement).outlineStyle}));
		Assert.equal(Layout.overflow,false);Assert.equal(Layout.help,true);Assert.notEqual(Layout.focus,'none');Report.ui.layout.push(Layout);
		await E.screenshot({path:Path.join(Out,'options-'+Width+'.png'),fullPage:true});
	}
	await E.locator('.download-options-editor button[type=submit]').click();
	Report.ui.result=await E.evaluate(()=>RumbleSelection);
	Assert.equal(Report.ui.result.liveStart,'current');
	await P.bringToFront();
	const RequestId=await E.evaluate(async()=>{
		const {Scan}=await import('./detection.js');const S=await Scan(RumbleInput.tabId,'popup');
		const V=S.candidates.find(V=>V.format==='M3U8');const Id=crypto.randomUUID();
		const Reply=await chrome.runtime.sendMessage({type:'enqueue',tabId:RumbleInput.tabId,scanId:S.scanId,candidateId:V.id,requestId:Id,liveStart:'current',captionOverride:'off',subtitleOptions:(await RumbleSelection).subtitleOptions});
		if(!Reply?.ok)throw Error(JSON.stringify(Reply));return Id;
	});
	let State,Stopped=false;
	for(let I=0;I<120;I++){
		State=await E.evaluate(async Id=>{const J=(await chrome.storage.local.get('job:'+Id))['job:'+Id];const [D]=J?.downloadId===undefined?[]:await chrome.downloads.search({id:J.downloadId});return {state:J?.state,error:J?.error,finished:J?.finished,liveStart:J?.liveStart,download:D&&{state:D.state,filename:D.filename}};},RequestId);
		if(['failed','canceled'].includes(State.state))throw Error(JSON.stringify(State));
		if(State.finished>=5&&!Stopped){Stopped=true;const R=await E.evaluate(Id=>chrome.runtime.sendMessage({type:'control',requestId:Id,action:'finish'}),RequestId);Assert.ok(R.ok);}
		if(State.download?.state==='complete')break;
		await E.waitForTimeout(500);
	}
	Assert.equal(State.download?.state,'complete',JSON.stringify(State));Assert.equal(State.liveStart,'current');
	Report.transfer=State;
	const Targets=(await B.send('Target.getTargets')).targetInfos;
	const Runner=Targets.find(T=>T.url===`chrome-extension://${id}/hls-runner.html`);Assert.ok(Runner);
	const {sessionId}=await B.send('Target.attachToTarget',{targetId:Runner.targetId,flatten:false});
	Report.requests=await new Promise(async(Resolve,Reject)=>{
		const OnMessage=Event=>{if(Event.sessionId!==sessionId)return;const M=JSON.parse(Event.message);if(M.id===901){B.off('Target.receivedMessageFromTarget',OnMessage);M.error?Reject(Error(JSON.stringify(M.error))):Resolve(M.result.result.value);}};
		B.on('Target.receivedMessageFromTarget',OnMessage);
		await B.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:901,method:'Runtime.evaluate',params:{expression:'globalThis.RumbleProbeRequests',returnByValue:true}})});
	});
	await B.send('Target.detachFromTarget',{sessionId});
	const Sequences=Report.requests.filter(U=>/media_.*\.ts/.test(U)).map(U=>Number(/_(\d+)\.ts/.exec(U)?.[1]));
	Report.firstRequestedSequence=Sequences[0];
	Assert.ok(Sequences[0]>=Report.playlist.last-3,'first actual segment request must be near the recorded edge');
	const Media=new Input({source:new BlobSource(await openAsBlob(State.download.filename)),formats:ALL_FORMATS});
	try{Report.duration=await Media.computeDuration();Report.tracks=[];for(const T of await Media.getTracks()){let N=0;for await(const P of new EncodedPacketSink(T).packets())N++;Report.tracks.push({type:T.type,codec:await T.getCodec(),packets:N});}}finally{Media.dispose();}
	Assert.ok(Report.duration<60);Assert.ok(Report.tracks.some(T=>T.type==='audio'&&T.packets>0));Assert.ok(Report.tracks.some(T=>T.type==='video'&&T.packets>0));
	const Playback=await C.newPage();await Playback.goto(pathToFileURL(State.download.filename).href);
	await Playback.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
	Report.playback=await Playback.evaluate(async()=>{const V=document.querySelector('video');V.muted=true;await V.play();await new Promise(R=>setTimeout(R,700));return {width:V.videoWidth,height:V.videoHeight,time:V.currentTime,audioBytes:V.webkitAudioDecodedByteCount,error:V.error?.code};});
	Assert.equal(Report.playback.error,undefined);Assert.ok(Report.playback.width>0&&Report.playback.time>0&&Report.playback.audioBytes>0);
	}
	Report.passed=true;console.log(JSON.stringify({out:Out,...Report},null,2));
}catch(E){Report.error=E.stack;console.log(E.stack);process.exitCode=1;}
finally{await writeFile(Path.join(Out,'result.json'),JSON.stringify(Report,null,2));await C.close();await new Promise(R=>Server.close(R));}
