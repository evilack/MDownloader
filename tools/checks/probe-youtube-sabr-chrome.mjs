/** 개발판 전용 실제 Chrome SABR 진단. 사용자 프로필·Computer Use·프록시를 사용하지 않습니다. */
import {VideoPlaybackAbrRequest,MediaHeader,StreamProtectionStatus,UMPPartId} from 'googlevideo/protos';
import {UmpReader,CompositeBuffer} from 'googlevideo/ump';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const Root=fileURLToPath(new URL('../../',import.meta.url));
const {chromium}=await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Artifact=Path.join(Root,'artifacts/youtube-sabr/native-'+Date.now());await mkdir(Artifact,{recursive:true});
const Context=await chromium.launchPersistentContext(Path.join(Artifact,'profile'),{executablePath:process.env.MDOWNLOADER_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:process.env.MDOWNLOADER_HEADFUL!=='1',acceptDownloads:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required']});
const Report={date:'2026-11-08',flavor:'development',videoId:'-XHx839rSc8',computerUse:false};
try{
 const Browser=await Context.browser().newBrowserCDPSession();await Browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:Path.join(Artifact,'downloads'),eventsEnabled:true});Report.browser=(await Browser.send('Browser.getVersion')).product;
 const {id}=await Browser.send('Extensions.loadUnpacked',{path:Path.join(Root,'artifacts/distributions/development/extension')});
 const Settings=await Context.newPage();await Settings.goto('chrome://extensions');
 const Page=await Context.newPage();await Page.goto(`chrome-extension://${id}/options.html`);
 async function Grant(Hosts){await Settings.evaluate(async({id,hosts})=>{for(const host of hosts)await chrome.developerPrivate.addHostPermission(id,host);},{id,hosts:Hosts});return Page.evaluate(hosts=>chrome.permissions.request({origins:hosts}),Hosts);}
 await Grant(['https://www.youtube.com/*','https://youtube.com/*','https://youtubei.googleapis.com/*']);
 const Vod=await Context.newPage();let ObservedUrl;let ObservedBody;let ObservedHttp200Request;let ObservedHttp200Response;const MediaResponses=[];
 Vod.on('request',Request=>{const Url=new URL(Request.url());if(Url.hostname.endsWith('.googlevideo.com')&&Url.searchParams.get('sabr')==='1'){ObservedUrl=Request.url();ObservedBody=Request.postDataBuffer();}});
 Vod.on('response',Response=>{if(new URL(Response.url()).hostname.endsWith('.googlevideo.com')){MediaResponses.push(Response.status());if(Response.status()===200&&new URL(Response.url()).searchParams.get('sabr')==='1'){ObservedHttp200Request=Response.request();ObservedHttp200Response=Response;}}});
 await Vod.goto('https://www.youtube.com/watch?v=-XHx839rSc8',{waitUntil:'domcontentloaded',timeout:30000});
 const Watch=await Vod.evaluate(()=>({player:globalThis.ytInitialPlayerResponse,context:globalThis.ytcfg?.get('INNERTUBE_CONTEXT')}));
 Report.watch={status:Watch.player?.playabilityStatus?.status,duration:Number(Watch.player?.videoDetails?.lengthSeconds),hasSabr:!!Watch.player?.streamingData?.serverAbrStreamingUrl};
 const Post={context:Watch.context,videoId:Report.videoId};
 Report.pageApi=await Vod.evaluate(async body=>{const r=await fetch('/youtubei/v1/player?prettyPrint=false',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'omit'});const t=await r.text();return {status:r.status,automated:/automated|\bbot\b/i.test(t)};},Post);
 await Page.evaluate(async()=>{const{EnsureRunner}=await import('./hls-jobs.js');await EnsureRunner();});
 const Target=(await Browser.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/hls-runner.html`);
 const {sessionId}=await Browser.send('Target.attachToTarget',{targetId:Target.targetId,flatten:false});let Counter=0;
 async function Run(Expression){const serial=++Counter;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{Browser.off('Target.receivedMessageFromTarget',listener);reject(Error('Offscreen timeout'));},180000);function listener(e){if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id!==serial)return;clearTimeout(timer);Browser.off('Target.receivedMessageFromTarget',listener);if(m.error||m.result?.exceptionDetails)reject(Error('Offscreen execution failed'));else resolve(m.result.result.value);}Browser.on('Target.receivedMessageFromTarget',listener);void Browser.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:serial,method:'Runtime.evaluate',params:{expression:Expression,awaitPromise:true,returnByValue:true}})}).catch(reject);});}
 Report.offscreenApi=await Run(`(async()=>{const r=await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(Post)}),credentials:'omit'});const t=await r.text();return {status:r.status,automated:/automated|\\bbot\\b/i.test(t)};})()`);
 await Page.evaluate(async value=>{await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[2146999998],addRules:[{id:2146999998,priority:2,condition:{urlFilter:'|https://www.youtube.com/youtubei/v1/player?prettyPrint=false|',initiatorDomains:[chrome.runtime.id],requestMethods:['post'],resourceTypes:['xmlhttprequest']},action:{type:'modifyHeaders',requestHeaders:[{header:'Origin',operation:'set',value:'https://www.youtube.com'},{header:'Referer',operation:'set',value:'https://www.youtube.com/watch?v=-XHx839rSc8'}]}}]});},{});
 Report.offscreenWithPageContext=await Run(`(async()=>{const r=await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(Post)}),credentials:'omit'});const t=await r.text();return {status:r.status,automated:/automated|\\bbot\\b/i.test(t)};})()`);
 await Page.evaluate(()=>chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[2146999998]}));
 // 일반 공개 페이지의 원본 응답을 메모리로만 전달합니다. 서명 URL/설정/토큰은 로그에 쓰지 않습니다.
 try {await Vod.waitForFunction(()=>document.querySelector('video')?.currentTime>8,{},{timeout:20000});} catch {}
 const NextMedia=Vod.waitForResponse(r=>r.status()===200&&new URL(r.url()).hostname.endsWith('.googlevideo.com')&&new URL(r.url()).searchParams.get('sabr')==='1',{timeout:20000}).catch(()=>undefined);
 await Vod.evaluate(()=>{const video=document.querySelector('video');if(video){video.currentTime=120;void video.play();}});
 await NextMedia;
 if(ObservedHttp200Request){ObservedUrl=ObservedHttp200Request.url();ObservedBody=ObservedHttp200Request.postDataBuffer();}
 const ObservedHeaders=await ObservedHttp200Request?.allHeaders();
 const sourceHeaders=[];const sourceProtection=[];
 if(ObservedHttp200Response){const payload=await ObservedHttp200Response.body();const reader=new UmpReader({onPart:(type,data)=>{const b=Buffer.concat(data.chunks.map(c=>Buffer.from(c)));if(type===UMPPartId.MEDIA_HEADER){const h=MediaHeader.decode(b);sourceHeaders.push({videoId:h.videoId,itag:h.itag,segment:h.segmentNum});}if(type===UMPPartId.STREAM_PROTECTION_STATUS)sourceProtection.push(StreamProtectionStatus.decode(b).status);}});await reader.feed(new CompositeBuffer([new Uint8Array(payload)]));}
 Report.observedPayload={headers:sourceHeaders,protection:sourceProtection};
 const RequestContext=ObservedBody?VideoPlaybackAbrRequest.decode(ObservedBody):undefined;
 const Token=RequestContext?.streamerContext?.poToken;
 Report.normalSession={tokenPresent:!!Token?.length,tokenBytes:Token?.length??0,clientInfoPresent:!!RequestContext?.streamerContext?.clientInfo,contextTypes:RequestContext?.streamerContext?.sabrContexts?.map(c=>c.type),hasExtraContext:!!RequestContext?.streamerContext?.field4};
 const Url=ObservedUrl||Watch.player?.streamingData?.serverAbrStreamingUrl;
 await Grant([new URL(Url).origin+'/*']);
 if(ObservedHeaders?.origin&&ObservedHeaders?.referer){await Page.evaluate(value=>{
 const Base=new URL(value.url);Base.searchParams.delete('rn');
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message.type!=='sabrProbeHeaders'||sender.url!==chrome.runtime.getURL('hls-runner.html'))return;
  const actual=new URL(message.url),key=new URL(message.url);key.searchParams.delete('rn');
  if(key.href!==Base.href){respond({ok:false});return;}
  chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[2146999999],addRules:[{id:2146999999,priority:2,condition:{urlFilter:'|'+actual.href+'|',isUrlFilterCaseSensitive:true,initiatorDomains:[chrome.runtime.id],requestMethods:['post'],resourceTypes:['xmlhttprequest']},action:{type:'modifyHeaders',requestHeaders:[{header:'Origin',operation:'set',value:value.origin},{header:'Referer',operation:'set',value:value.referer}]}}]}).then(()=>respond({ok:true}),()=>respond({ok:false}));return true;
 });
 },{url:Url,origin:ObservedHeaders.origin,referer:ObservedHeaders.referer});}
 Report.observedContext={hasOrigin:!!ObservedHeaders?.origin,hasReferer:!!ObservedHeaders?.referer};
 Report.source={observedSabr:!!ObservedUrl,observedRequestBodyBytes:ObservedBody?.byteLength??0,pageMediaResponses:MediaResponses};
 await Vod.close();Report.sourceTabClosed=true;
 Report.receive=await Run(`(async()=>{
  const {NormalizeWatchPlayer,ReceiveSabrTracks}=await import('./features/youtube/sabr.js');
  const config=NormalizeWatchPlayer(${JSON.stringify(Watch.player)},'-XHx839rSc8',${JSON.stringify(Watch.context?.client||{})});
  config.url=${JSON.stringify(Url)};
  config.ustreamerConfig=${JSON.stringify(RequestContext?.videoPlaybackUstreamerConfig?.length?Buffer.from(RequestContext.videoPlaybackUstreamerConfig).toString('base64'):Watch.player?.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig)};
  config.poToken=${JSON.stringify(Token?.length?Buffer.from(Token).toString("base64"):undefined)};
  config.clientInfo=${JSON.stringify(RequestContext?.streamerContext?.clientInfo||{})};
  const video=config.formats.filter(f=>f.mimeType?.includes('avc1')).sort((a,b)=>a.height-b.height)[0];
  const audio=config.formats.find(f=>f.mimeType?.includes('mp4a')&&!f.isDrc);
  if(!video||!audio)return {ok:false,code:'youtube_format_unavailable'};
  const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('youtube-sabr-probe',{create:true});
  const events=[];let last={video:0,audio:0};globalThis.SabrProbeDirectory=directory;globalThis.SabrProbeConfig=config;
  try{
   const result=await ReceiveSabrTracks(config,{video:video.itag,audio:audio.itag},{
    fetch:async request=>{const ready=await chrome.runtime.sendMessage({type:'sabrProbeHeaders',url:request.url});if(!ready?.ok)throw Error('request context unavailable');return fetch(request);},
    keepReceivedOnFailure:true,
    hasPermission:async origin=>(await chrome.runtime.sendMessage({type:'youtubePermission',origin})).allowed,
    createWriter:async kind=>(await directory.getFileHandle(kind+'.mp4',{create:true})).createWritable(),
    report:event=>{if(event.stage==='sabr-bytes')last=event;else events.push(event);}
   });
   globalThis.SabrProbeDirectory=directory;globalThis.SabrProbeConfig=config;
   return {ok:true,bytes:result.bytes,videoItag:video.itag,audioItag:audio.itag,events};
  }catch(e){return {ok:false,code:e.code||'youtube_sabr_receive_failed',bytes:{video:last.video,audio:last.audio},events};}
 })()`);
 if(Report.receive.bytes?.video>0&&Report.receive.bytes?.audio>0){
 const Mux=await Run(`(async()=>{
  const{RemuxYoutubeTracks}=await import('./features/youtube/remux.js');
  const{SafeFilename}=await import('./lib/download-folder.js');
  const{PartialFilename}=await import('./lib/partial-naming.js');
  const directory=globalThis.SabrProbeDirectory;
  const video=await(await directory.getFileHandle('video.mp4')).getFile(),audio=await(await directory.getFileHandle('audio.mp4')).getFile();
  const handle=await directory.getFileHandle('result.mp4',{create:true}),writer=await handle.createWritable();
  try{
   const result=await RemuxYoutubeTracks(video,audio,writer,new AbortController().signal);
   const file=await handle.getFile(),url=URL.createObjectURL(file);
   let filename=SafeFilename(undefined,globalThis.SabrProbeConfig.title,new Date());
   if(!${Report.receive.ok})filename=PartialFilename(filename);
   return {ok:true,url,filename,bytes:file.size,...result};
  }catch(e){await writer.abort().catch(()=>{});return {ok:false,code:e.code||'remux-failed'};}
 })()`);
 if(Mux.ok){
  const Download=await Page.evaluate(async value=>{const{DownloadNamedFile}=await import('./lib/browser-download.js');const id=await DownloadNamedFile(value.url,value.filename);const deadline=Date.now()+20000;let item;do{[item]=await chrome.downloads.search({id});if(item.state!=='in_progress')break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);return {state:item.state,bytes:item.bytesReceived,filename:item.filename};},Mux);
  Report.save={requestedFilename:Mux.filename,state:Download.state,bytes:Download.bytes,filename:Path.basename(Download.filename),duration:Mux.duration,videoPackets:Mux.videoPackets,audioPackets:Mux.audioPackets,partial:!Report.receive.ok};
  const original=Path.resolve(Download.filename);if(!original.startsWith(Path.resolve(Artifact)+Path.sep))throw Error('output outside test artifacts');
  const exported=Path.join(Artifact,Path.basename(Mux.filename));await copyFile(original,exported);Report.output=exported;
  Report.save.fileSha256=createHash('sha256').update(await readFile(exported)).digest('hex');
  const Playback=await Page.evaluate(async url=>{const video=document.createElement('video');video.muted=true;document.body.append(video);video.src=url;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;});await video.play();await new Promise(resolve=>video.requestVideoFrameCallback(resolve));return {width:video.videoWidth,height:video.videoHeight,duration:video.duration,frames:video.getVideoPlaybackQuality().totalVideoFrames};},Mux.url);
  Report.playback=Playback;
  Report.audioDecode=await Page.evaluate(async url=>{
   const{Input,BlobSource,ALL_FORMATS,AudioSampleSink}=await import('./vendor/mediabunny-1.65.2.mjs');
   const blob=await(await fetch(url)).blob(),input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
   try{const track=await input.getPrimaryAudioTrack(),sample=await new AudioSampleSink(track).getSample(10);const data=sample.toAudioData(),values=new Float32Array(data.numberOfFrames);data.copyTo(values,{planeIndex:0,format:'f32-planar'});const rms=Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);const result={frames:data.numberOfFrames,channels:data.numberOfChannels,sampleRate:data.sampleRate,rms};data.close();sample.close();return result;}finally{input.dispose();}
  },Mux.url);
 }else Report.save=Mux;
 }
 Report.gatePassed=!!(Report.receive.ok&&Report.save?.state==='complete'&&Report.playback?.frames>0&&Report.audioDecode?.frames>0);
}catch(ErrorValue){Report.failure=ErrorValue.message==='Offscreen timeout'?'offscreen-timeout':'probe-failed';}
finally{await writeFile(Path.join(Artifact,'result.json'),JSON.stringify(Report,null,2));console.log(JSON.stringify({artifact:Artifact,...Report}));await Context.close();}
if(!Report.gatePassed)process.exitCode=2;
