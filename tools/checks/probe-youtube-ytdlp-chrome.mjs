/** 일회성 yt-dlp 추출 → 개발판 실제 Chrome 수신. Native Messaging 통합은 아닙니다. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,copyFile,open,stat} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const Root=fileURLToPath(new URL('../../',import.meta.url));
const Exe=process.env.MDOWNLOADER_YTDLP_PATH||Path.join(Root,'artifacts/youtube-attestation/ytdlp/yt-dlp.exe');
const Artifact=Path.join(Root,'artifacts/youtube-attestation/native-ytdlp-'+Date.now());await mkdir(Artifact,{recursive:true});
const Report={date:'2026-11-08',videoId:'-XHx839rSc8',flavor:'development',computerUse:false,nativeMessagingIntegrated:false};let Context;
async function HashFile(file){const handle=await open(file),hash=createHash('sha256');try{for await(const chunk of handle.createReadStream())hash.update(chunk);return hash.digest('hex');}finally{await handle.close();}}
try{
 const metadata=await new Promise((resolve,reject)=>{
  const child=spawn(Exe,['--ignore-config','--no-plugin-dirs','--no-playlist','--no-mark-watched','--no-remote-components','--js-runtimes','node:'+process.execPath,'--socket-timeout','20','--retries','0','--extractor-retries','0','--skip-download','--dump-single-json','-f','18','https://www.youtube.com/watch?v=-XHx839rSc8'],{windowsHide:true});
  let out='',size=0;const timeout=setTimeout(()=>child.kill(),120000);child.stdout.on('data',chunk=>{size+=chunk.length;if(size>16*1024**2)child.kill();else out+=chunk;});child.stderr.resume();child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);if(code!==0)reject(Error('extractor-failed'));else try{resolve(JSON.parse(out));}catch{reject(Error('extractor-output-invalid'));}});
 });
 if(metadata.id!==Report.videoId||metadata.duration!==623||metadata.format_id!=='18'||metadata.vcodec==='none'||metadata.acodec==='none')throw Error('extractor-source-mismatch');
 Report.extractor={sha256:createHash('sha256').update(await readFile(Exe)).digest('hex'),version:metadata._version?.version,formatId:metadata.format_id,duration:metadata.duration,width:metadata.width,height:metadata.height,vcodec:metadata.vcodec,acodec:metadata.acodec};
 const Source={url:metadata.url,contentLength:Number(new URL(metadata.url).searchParams.get('clen'))};
 if(!Number.isSafeInteger(Source.contentLength)||Source.contentLength<1||Source.contentLength>16*1024**3)throw Error('extractor-source-mismatch');
 Report.extractor.expectedBytes=Source.contentLength;Report.extractor.sourceDuration=Number(new URL(metadata.url).searchParams.get('dur'));
 Report.transportControls=[];
 for(const [label,headers] of [['node-default',{}],['node-extractor-headers',metadata.http_headers]]){
  const response=await fetch(Source.url,{headers:{...headers,Range:'bytes=0-1'},redirect:'error',signal:AbortSignal.timeout(30000)});Report.transportControls.push({label,status:response.status});await response.body?.cancel();
 }
 const {chromium}=await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
 Context=await chromium.launchPersistentContext(Path.join(Artifact,'profile'),{executablePath:process.env.MDOWNLOADER_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:process.env.MDOWNLOADER_HEADFUL!=='1',acceptDownloads:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
 const Browser=await Context.browser().newBrowserCDPSession();await Browser.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:Path.join(Artifact,'downloads'),eventsEnabled:true});Report.browser=(await Browser.send('Browser.getVersion')).product;
 const {id}=await Browser.send('Extensions.loadUnpacked',{path:Path.join(Root,'artifacts/distributions/development/extension')});
 const Settings=await Context.newPage();await Settings.goto('chrome://extensions');const Page=await Context.newPage();await Page.goto(`chrome-extension://${id}/options.html`);
 const hosts=[new URL(Source.url).origin+'/*'];await Settings.evaluate(async({id,hosts})=>{for(const host of hosts)await chrome.developerPrivate.addHostPermission(id,host);},{id,hosts});
 if(!await Page.evaluate(hosts=>chrome.permissions.request({origins:hosts}),hosts))throw Error('permission-denied');
 await Page.evaluate(async({url,headers})=>{const allowed=['user-agent','accept','accept-language','sec-fetch-mode'];await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[2146999997],addRules:[{id:2146999997,priority:2,condition:{urlFilter:'|'+url+'|',isUrlFilterCaseSensitive:true,initiatorDomains:[chrome.runtime.id],requestMethods:['get'],resourceTypes:['xmlhttprequest']},action:{type:'modifyHeaders',requestHeaders:Object.entries(headers).filter(([key])=>allowed.includes(key.toLowerCase())).map(([header,value])=>({header,operation:'set',value}))}}]});},{url:Source.url,headers:metadata.http_headers});
 await Page.evaluate(async()=>{const{EnsureRunner}=await import('./hls-jobs.js');await EnsureRunner();});
 const Target=(await Browser.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/hls-runner.html`);
 const{sessionId}=await Browser.send('Target.attachToTarget',{targetId:Target.targetId,flatten:false});let Counter=0;
 async function Run(expression){const serial=++Counter;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{Browser.off('Target.receivedMessageFromTarget',listener);reject(Error('offscreen-timeout'));},300000);function listener(e){if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id!==serial)return;clearTimeout(timer);Browser.off('Target.receivedMessageFromTarget',listener);if(m.error||m.result?.exceptionDetails)reject(Error('offscreen-failed'));else resolve(m.result.result.value);}Browser.on('Target.receivedMessageFromTarget',listener);void Browser.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:serial,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})}).catch(reject);});}
 Report.receive=await Run(`(async()=>{
  const{ReceiveYoutubeFile}=await import('./features/youtube/direct.js');
  const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('youtube-direct-probe',{create:true});
  const handle=await directory.getFileHandle('result.mp4',{create:true});let ranges=0,statuses=[];
  try{const result=await ReceiveYoutubeFile(${JSON.stringify(Source)},{createWriter:()=>handle.createWritable(),hasPermission:async origin=>(await chrome.runtime.sendMessage({type:'youtubePermission',origin})).allowed,fetch:async request=>{const r=await fetch(request);statuses.push(r.status);return r;},report:()=>ranges++});
   const file=await handle.getFile();globalThis.DirectProbeUrl=URL.createObjectURL(file);return{ok:true,...result,ranges,statuses};
  }catch(e){return{ok:false,code:e.code||'receive-failed',ranges,statuses};}
 })()`);
 if(!Report.receive.ok&&process.env.MDOWNLOADER_YTDLP_TRANSPORT==='helper'){
  Report.directReceive=Report.receive;
  const file=Path.join(Artifact,'helper-received.mp4');
  await new Promise((resolve,reject)=>{const child=spawn(Exe,['--ignore-config','--no-plugin-dirs','--no-remote-components','--load-info-json','-','--no-progress','--no-continue','--force-overwrites','--retries','0','--socket-timeout','20','-o',file],{windowsHide:true});const timeout=setTimeout(()=>child.kill(),180000);child.stdout.resume();child.stderr.resume();child.on('error',reject);child.on('close',code=>{clearTimeout(timeout);code===0?resolve():reject(Error('helper-download-failed'));});child.stdin.end(JSON.stringify(metadata));});
  const size=(await stat(file)).size;if(size!==Source.contentLength)throw Error('helper-size-invalid');
  await Run(`(async()=>{const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('youtube-helper-probe',{create:true});globalThis.HelperHandle=await directory.getFileHandle('result.mp4',{create:true});globalThis.HelperWriter=await globalThis.HelperHandle.createWritable();})()`);
  const input=await open(file);let received=0,chunks=0;
  try{for await(const chunk of input.createReadStream({highWaterMark:512*1024})){await Run(`globalThis.HelperWriter.write(Uint8Array.from(atob(${JSON.stringify(chunk.toString('base64'))}),c=>c.charCodeAt(0)))`);received+=chunk.length;chunks++;}}finally{await input.close();}
  if(received!==size)throw Error('helper-size-invalid');
  const bytes=await Run(`(async()=>{await globalThis.HelperWriter.close();const file=await globalThis.HelperHandle.getFile();globalThis.DirectProbeUrl=URL.createObjectURL(file);return file.size;})()`);
  Report.receive={ok:bytes===size,transport:'yt-dlp-network-to-file-then-CDP-chunks-to-Chrome-OPFS',bytes,total:size,chunks,helperFileSha256:await HashFile(file)};
 }
 if(!Report.receive.ok)throw Error('receive-failed');
 Report.decode=await Run(`(async()=>{
  const{Input,BlobSource,ALL_FORMATS,AudioSampleSink,VideoSampleSink,EncodedPacketSink}=await import('./vendor/mediabunny-1.65.2.mjs');
  const file=await(await fetch(globalThis.DirectProbeUrl)).blob(),input=new Input({formats:ALL_FORMATS,source:new BlobSource(file)});
  try{const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();if(!video||!audio)return{ok:false};
   const samples=[];for(const time of [1,620]){const v=await new VideoSampleSink(video).getSample(time),a=await new AudioSampleSink(audio).getSample(time);if(!v||!a)return{ok:false};
    const frame=v.toVideoFrame(),data=a.toAudioData(),values=new Float32Array(data.numberOfFrames);data.copyTo(values,{planeIndex:0,format:'f32-planar'});
    samples.push({at:time,videoTimestamp:v.timestamp,width:frame.displayWidth,height:frame.displayHeight,audioTimestamp:a.timestamp,audioFrames:data.numberOfFrames,channels:data.numberOfChannels,sampleRate:data.sampleRate,rms:Math.sqrt(values.reduce((s,x)=>s+x*x,0)/values.length)});frame.close();data.close();v.close();a.close();}
   const packets={};for(const[kind,track]of [['video',video],['audio',audio]]){let count=0,end=0,start=Infinity;for await(const packet of new EncodedPacketSink(track).packets()){count++;start=Math.min(start,packet.timestamp);end=Math.max(end,packet.timestamp+packet.duration);}packets[kind]={count,start,end};}
   // YouTube의 정수 초는 반올림 값입니다. 전체 바이트 일치와 양 트랙의 반올림 초를 함께 검사합니다.
   const duration=await input.computeDuration();return{ok:Math.round(duration)===623&&Math.round(packets.video.end)===623&&Math.round(packets.audio.end)===623,duration,samples,packets};
  }finally{input.dispose();}
 })()`);
 const name=await Page.evaluate(async title=>{const{SafeFilename}=await import('./lib/download-folder.js');return SafeFilename(undefined,title,new Date());},metadata.title);
 // 같은 확장 origin의 offscreen blob을 실제 downloads API로 저장합니다.
 const Url=await Run('globalThis.DirectProbeUrl');
 Report.save=await Page.evaluate(async({url,filename})=>{const{DownloadNamedFile}=await import('./lib/browser-download.js');const id=await DownloadNamedFile(url,filename);const deadline=Date.now()+60000;let item;do{[item]=await chrome.downloads.search({id});if(item.state!=='in_progress')break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);return{state:item.state,bytes:item.bytesReceived,filename:item.filename};},{url:Url,filename:name});
 const original=Path.resolve(Report.save.filename);if(!original.startsWith(Path.resolve(Artifact)+Path.sep))throw Error('output-outside-artifacts');
 const output=Path.join(Artifact,Path.basename(name));await copyFile(original,output);const fileBytes=(await stat(output)).size;
 Report.save={...Report.save,filename:Path.basename(original),requestedFilename:name,output,sha256:await HashFile(output),fileBytes};
 Report.gatePassed=Report.receive.ok&&Report.decode.ok&&Report.save.state==='complete'&&Report.save.bytes===Report.receive.bytes&&fileBytes===Report.receive.bytes&&(!Report.receive.helperFileSha256||Report.receive.helperFileSha256===Report.save.sha256);
 Report.chromeDirectNetworkPassed=Report.gatePassed&&!Report.directReceive;
}catch(e){Report.failure=['extractor-failed','extractor-output-invalid','extractor-source-mismatch','permission-denied','offscreen-timeout','offscreen-failed','receive-failed','output-outside-artifacts','helper-download-failed','helper-size-invalid'].includes(e.message)?e.message:'probe-failed';}
finally{await writeFile(Path.join(Artifact,'result.json'),JSON.stringify(Report,null,2));console.log(JSON.stringify({artifact:Artifact,...Report}));await Context?.close();}
if(!Report.gatePassed)process.exitCode=2;
