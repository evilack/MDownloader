import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {CandidatePreviews, PreviewCandidate, ReadCandidateThumbnail} from '../extension/detection.js';
import {ParseMaster} from '../extension/lib/hls.js';
import {ReadStreamThumbnail} from '../extension/lib/stream-thumbnail.js';
import {readFile} from 'node:fs/promises';
import {Enqueue} from '../extension/jobs.js';

const Page = 'https://www.dailymotion.com/video/xbt0e42';
const Master = 'https://cdn.test/video/xbt0e42.m3u8';
const Manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=360x640\nlow.m3u8\n' +
 '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1080x1920\nhigh.m3u8\n';

function Setup(T, Preview = {still:'frame.jpg', resolution:{width:360,height:640}})
{
 const Item = {id:0, supported:true, format:'M3U8', url:Master, documentId:'doc',
  variants:ParseMaster(Manifest,Master).map(Q => Q.url), qualities:ParseMaster(Manifest,Master).reverse()};
 const Saved = {scanId:'scan', documentId:'doc', page:Page, candidates:[Item]};
 globalThis.chrome = {permissions:{contains:async()=>true},
  storage:{session:{get:async Key=>({[Key]:Key==='scan:7'?Saved:[]})}},
  scripting:{executeScript:async ({args})=>args
   ? [{documentId:'doc',result:Preview ? [{id:0,...Preview}] : []}]
   : [{documentId:'doc',result:{page:Page,active:true}}]}};
 T.after(()=>delete globalThis.chrome);
 return {item:Item,saved:Saved};
}

Test('HLS list, hover and job thumbnails report the default download rendition instead of the adaptive player',async T=>
{
 const {item}=Setup(T);
 const Input={tabId:7,scanId:'scan',candidateId:0};
 const Batch=await CandidatePreviews({...Input,candidateIds:[0]});
 const Hover=await PreviewCandidate(Input);
 const Thumbnail=await ReadCandidateThumbnail(7,{...item,page:Page,previewPage:Page});
 for(const Preview of [Batch[0],Hover,Thumbnail])
 {
  Assert.deepEqual(Preview.resolution,{width:1080,height:1920});
  Assert.equal(Preview.still,'frame.jpg');
 }
});

Test('HLS dimensions refresh when the same candidate gains new master quality metadata',async T=>
{
 const {item}=Setup(T);
 const Input={tabId:7,scanId:'scan',candidateIds:[0]};
 item.qualities=item.qualities.slice(1);
 Assert.deepEqual((await CandidatePreviews(Input))[0].resolution,{width:360,height:640});
 item.qualities=ParseMaster(Manifest,Master).reverse();
 Assert.deepEqual((await CandidatePreviews(Input))[0].resolution,{width:1080,height:1920});
});

Test('HLS source dimensions remain available without any page thumbnail or player',async T=>
{
 Setup(T,null);
 Assert.deepEqual(await CandidatePreviews({tabId:7,scanId:'scan',candidateIds:[0]}),
  [{id:0,resolution:{width:1080,height:1920}}]);
});

Test('protected HLS dimensions follow the observed default download rendition',async T=>
{
 const {item}=Setup(T);
 item.observedVariants=[{url:'https://cdn.test/video/low.m3u8',documentId:'doc',
  requestContext:{origin:'https://www.dailymotion.com',serverOrigin:'https://cdn.test'}}];
 Assert.deepEqual((await PreviewCandidate({tabId:7,scanId:'scan',candidateId:0})).resolution,
  {width:360,height:640});
});

Test('job thumbnails use an explicitly selected rendition including a non-default observed quality',async T=>
{
 const {item}=Setup(T,{resolution:{width:1080,height:1920}});
 item.variantUrl='https://cdn.test/video/low.m3u8';
 Assert.deepEqual((await ReadCandidateThumbnail(7,{...item,page:Page})).resolution,{width:360,height:640});
 item.observedVariants=[{url:item.variantUrl},{url:'https://cdn.test/video/high.m3u8'}];
 item.variantUrl='https://cdn.test/video/high.m3u8';
 Assert.deepEqual((await ReadCandidateThumbnail(7,{...item,page:Page})).resolution,{width:1080,height:1920});
});

Test('enqueue pins the selected HLS rendition in the job thumbnail and preview source',async T=>
{
 const {saved}=Setup(T);
 saved.candidates[0].name='master.m3u8';
 const Local={},Session={'scan:7':saved},Frames=new Map(),Messages=[],Ready=Promise.withResolvers();
 const Storage=Data=>({get:async Keys=>Object.fromEntries((Keys==null?Object.keys(Data):Array.isArray(Keys)?Keys:[Keys]).map(Key=>[Key,Data[Key]])),set:async Values=>Object.assign(Data,Values)});
 chrome.storage={local:Storage(Local),session:Storage(Session)};
 chrome.runtime={id:'test',getURL:Path=>'chrome-extension://test/'+Path,getContexts:async()=>[{}],sendMessage:async Message=>
 {
  Messages.push(Message);if(Message.type==='jobPreviewReady')Ready.resolve();return {ok:true};
 }};
 chrome.scripting.executeScript=async ({func,args})=>[{documentId:'doc',result:func.name==='ReadPageSubtitles'?[]:
  args?[{id:0,resolution:{width:1080,height:1920}}]:{page:Page,active:true}}];
 globalThis.caches={open:async()=>({put:async(Key,Response)=>Frames.set(Key,await Response.json()),keys:async()=>[]})};
 T.after(()=>delete globalThis.caches);
 const Id='77777777-7777-7777-7777-777777777777',Variant='https://cdn.test/video/low.m3u8';
 Assert.equal((await Enqueue({tabId:7,scanId:'scan',candidateId:0,requestId:Id,variantUrl:Variant})).state,'started');
 await Promise.race([Ready.promise,new Promise((_,Reject)=>{const Timer=setTimeout(()=>Reject(Error('job preview timed out')),1000);Timer.unref();})]);
 Assert.equal(Messages.find(M=>M.type==='hlsRun').job.variantUrl,Variant);
 Assert.equal(Session['job-preview-source:'+Id].url,Variant);
 Assert.deepEqual([...Frames.values()][0].resolution,{width:360,height:640});
});

Test('provider file dimensions retain precedence and invalid master dimensions never invent a size',async T=>
{
 const {item}=Setup(T);
 item.width=720;item.height=1280;
 Assert.deepEqual((await CandidatePreviews({tabId:7,scanId:'scan',candidateIds:[0]}))[0].resolution,
  {width:720,height:1280});
 delete item.width;delete item.height;
 item.qualities[0].resolution='0x1920';
 Assert.deepEqual((await CandidatePreviews({tabId:7,scanId:'scan',candidateIds:[0]}))[0].resolution,
  {width:360,height:640});
});

Test('a small decoded preview sample cannot replace the master download resolution',async T=>
{
 Setup(T);
 const Media=await readFile(new URL('../website/sample/media/sample-film.mp4',import.meta.url));
 const Playlist='#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsample.mp4\n#EXT-X-ENDLIST\n';
 const Requests=[];
 T.mock.method(globalThis,'fetch',async Url=>
 {
  Requests.push(Url);
  return new Response(Url===Master ? Manifest : Url.endsWith('.m3u8') ? Playlist : Media);
 });
 class Video extends EventTarget
 {
  videoWidth=360;videoHeight=640;
  set src(Value){queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')));}
  pause(){} removeAttribute(){} load(){}
 }
 globalThis.document={createElement:Tag=>Tag==='video' ? new Video() :
  {getContext:()=>({drawImage(){}}),toDataURL:()=> 'data:image/jpeg;base64,frame'}};
 T.after(()=>delete globalThis.document);
 const Result=await ReadStreamThumbnail({url:Master,format:'M3U8'},new AbortController().signal);
 Assert.ok(Requests.includes('https://cdn.test/video/low.m3u8'),'the preview sample may stay small');
 Assert.deepEqual(Result.resolution,{width:1080,height:1920});
 Assert.equal(Result.still,'data:image/jpeg;base64,frame');
});
