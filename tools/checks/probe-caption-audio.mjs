import {createRequire} from 'node:module';import {writeFile} from 'node:fs/promises';
import {CreatePreviewServer} from '../../website/serve.mjs';import {ProjectPath} from '../lib/tool-config.mjs';
const Playwright=createRequire(import.meta.url)(process.env.MDOWNLOADER_PLAYWRIGHT_MODULE||'playwright');
const Server=CreatePreviewServer({root:ProjectPath()});await new Promise(R=>Server.listen(0,'127.0.0.1',R));
const Browser=await Playwright.chromium.launch({headless:true,executablePath:process.env.MDOWNLOADER_BROWSER_PATH});
try{
 const Page=await Browser.newPage();Page.setDefaultTimeout(15000);await Page.route('**/*.mjs',async R=>{const X=await R.fetch();await R.fulfill({response:X,contentType:'application/javascript'});});
 await Page.goto('http://127.0.0.1:'+Server.address().port+'/tools/dev/local-captions-preview.html');
 const Result=await Page.evaluate(async()=>{
  const {RemuxHls,RemuxCaptionAudio}=await import('/extension/lib/hls-remux.js');const {Input,BlobSource,ALL_FORMATS,EncodedPacketSink}=await import('/extension/vendor/mediabunny-1.65.2.mjs');
  const Root='/artifacts/caption-engine-smoke/hls/',Video=await(await fetch(Root+'v.m3u8')).text(),Audio=await(await fetch(Root+'a.m3u8')).text(),Get=async P=>(await fetch(Root+P)).blob(),Signal=new AbortController().signal;
  const Dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('caption-audio-probe-'+crypto.randomUUID(),{create:true}),FH=await Dir.getFileHandle('final.mp4',{create:true}),PH=await Dir.getFileHandle('prepared.m4a',{create:true});
  const A=await RemuxCaptionAudio(Audio,Get,await PH.createWritable(),Signal,Video),V=await RemuxHls(Video,Get,await FH.createWritable(),Signal,Audio);
  async function First(Handle){const I=new Input({formats:ALL_FORMATS,source:new BlobSource(await Handle.getFile())});try{return (await new EncodedPacketSink(await I.getPrimaryAudioTrack()).getFirstPacket()).timestamp;}finally{I.dispose();}}
  const Final=await First(FH),Prepared=await First(PH),Offset=A.start-V.start;
  return {audioOrigin:A.start,outputOrigin:V.start,offset:Offset,finalAudioStart:Final,preparedAudioStart:Prepared,difference:Math.abs(Prepared+Offset-Final)};
 });
 if(Result.difference>0.001)throw Error('Caption audio clock mismatch: '+JSON.stringify(Result));
 await writeFile(ProjectPath('artifacts/caption-engine-smoke/hls/sync-evidence.json'),JSON.stringify(Result,null,2));console.log(JSON.stringify(Result));
}finally{await Browser.close();await new Promise(R=>Server.close(R));}
