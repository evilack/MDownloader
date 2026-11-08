/** 개발판 전용 공개 플레이어 진단. 토큰/URL/본문은 출력하지 않습니다. */
import {VideoPlaybackAbrRequest,MediaHeader,StreamProtectionStatus,UMPPartId} from 'googlevideo/protos';
import {UmpReader,CompositeBuffer} from 'googlevideo/ump';
import {mkdir,writeFile} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const Root=fileURLToPath(new URL('../../',import.meta.url));
const {chromium}=await import(pathToFileURL(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||Path.resolve(Path.dirname(process.execPath),'../node_modules/playwright/index.mjs')));
const Artifact=Path.join(Root,'artifacts/browser-only/attestation-'+Date.now());await mkdir(Artifact,{recursive:true});
const Normal=process.env.MDOWNLOADER_NORMAL_CHROME==='1';
const Context=await chromium.launchPersistentContext(Path.join(Artifact,'profile'),{executablePath:process.env.MDOWNLOADER_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,ignoreDefaultArgs:['--disable-extensions',...(Normal?['--enable-automation']:[])],args:['--enable-unsafe-extension-debugging','--autoplay-policy=no-user-gesture-required']});
const Report={videoId:'-XHx839rSc8',flavor:'development',computerUse:false,normalChrome:Normal,responses:[],challenge:[],failures:[],console:[],progress:[]};
const Tokens=[],Pending=new Set();
function Category(url){const u=new URL(url);if(u.hostname==='jnn-pa.googleapis.com'||u.pathname.startsWith('/api/jnn/'))return u.pathname.includes('GenerateIT')?'integrity':'challenge';if(u.pathname.includes('/att/'))return'attestation-api';if(u.hostname==='www.youtube.com'&&u.pathname.startsWith('/s/player/'))return'player-script';return null;}
try{
 const Browser=await Context.browser().newBrowserCDPSession();Report.browser=(await Browser.send('Browser.getVersion')).product;
 try{Report.automationFlags=(await Browser.send('Browser.getBrowserCommandLine')).arguments.filter(a=>/enable-automation|remote-debugging|headless|unsafe-extension/.test(a));}catch{Report.automationFlagsUnavailable=true;}
 await Browser.send('Extensions.loadUnpacked',{path:Path.join(Root,'artifacts/distributions/development/extension')});
 const Page=await Context.newPage();
 Page.on('console',message=>{if(message.type()!=='error')return;const value=message.text();const category=['BotGuard','attestation','TrustedScript','Content Security Policy','WebGL','GPU'].find(v=>value.toLowerCase().includes(v.toLowerCase()));if(category&&Report.console.length<40)Report.console.push(category);});
 Page.on('requestfailed',request=>{const category=Category(request.url());if(category&&Report.failures.length<40)Report.failures.push({category,aborted:request.failure()?.errorText==='net::ERR_ABORTED'});});
 Page.on('response',response=>{
  const category=Category(response.url());if(category&&Report.challenge.length<100)Report.challenge.push({category,status:response.status()});
  const url=new URL(response.url());if(!url.hostname.endsWith('.googlevideo.com')||url.searchParams.get('sabr')!=='1'||Report.responses.length>=100)return;
  const item={status:response.status(),protection:[],media:[]};Report.responses.push(item);
  const promise=(async()=>{try{
   const body=response.request().postDataBuffer();if(body){const request=VideoPlaybackAbrRequest.decode(body),token=request.streamerContext?.poToken;let index=Tokens.findIndex(t=>token&&Buffer.from(token).equals(t));if(index<0&&token){Tokens.push(Buffer.from(token));index=Tokens.length-1;}item.request={tokenBytes:token?.length??0,tokenSequence:index,playbackCookieBytes:request.streamerContext?.playbackCookie?.length??0,contexts:request.streamerContext?.sabrContexts?.map(c=>c.type),selectedVideo:request.selectedVideoFormatIds.map(f=>f.itag),selectedAudio:request.selectedAudioFormatIds.map(f=>f.itag)};}
   if(response.status()!==200)return;
   const payload=await response.body();item.bytes=payload.length;
   const reader=new UmpReader({onPart:(type,data)=>{const b=Buffer.concat(data.chunks.map(c=>Buffer.from(c)));if(type===UMPPartId.MEDIA_HEADER){const h=MediaHeader.decode(b);if(item.media.length<16)item.media.push({videoId:h.videoId,itag:h.itag,segment:h.segmentNum});}if(type===UMPPartId.STREAM_PROTECTION_STATUS)item.protection.push(StreamProtectionStatus.decode(b).status);}});await reader.feed(new CompositeBuffer([new Uint8Array(payload)]));
  }catch{item.bodyUnavailable=true;}})();Pending.add(promise);void promise.finally(()=>Pending.delete(promise));
 });
 if(process.env.MDOWNLOADER_HOME_WARMUP==='1'){await Page.goto('https://www.youtube.com/',{waitUntil:'domcontentloaded',timeout:30000});await Page.waitForTimeout(10000);Report.homeWarmup=true;}
 await Page.goto('https://www.youtube.com/watch?v=-XHx839rSc8',{waitUntil:'domcontentloaded',timeout:30000});
 Report.environment=await Page.evaluate(()=>({webdriver:navigator.webdriver,secureContext:isSecureContext,challengeBootstrap:typeof globalThis.ytAtN,playerResponse:globalThis.ytInitialPlayerResponse?.playabilityStatus?.status,attestationKeys:Object.keys(globalThis.ytcfg?.get()??{}).filter(key=>/BOTGUARD|ATTESTATION/.test(key))}));
 for(let index=0;index<18;index++){
  await Page.waitForTimeout(5000);
  Report.progress.push(await Page.evaluate(()=>{const v=document.querySelector('video'),p=document.querySelector('#movie_player');return{time:v?.currentTime,ready:v?.readyState,paused:v?.paused,error:v?.error?.code,state:p?.getPlayerState?.(),buffered:v?[...Array(v.buffered.length)].slice(0,4).map((_,i)=>[v.buffered.start(i),v.buffered.end(i)]):[]};}));
  if(index===2)await Page.evaluate(()=>{const v=document.querySelector('video');if(v){v.muted=true;void v.play().catch(()=>{});}});
 }
 await Promise.allSettled([...Pending]);Report.tokenVersions=Tokens.length;
}catch{Report.failure='diagnostic-failed';}
finally{await writeFile(Path.join(Artifact,'result.json'),JSON.stringify(Report,null,2));console.log(JSON.stringify({artifact:Artifact,...Report}));await Context.close();}
