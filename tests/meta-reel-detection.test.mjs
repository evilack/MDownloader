import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {ClassifyMediaUrl, ClassifyResponseMedia} from '../extension/lib/media.js';
import {FindMedia, Scan, CandidatePreviews, PreviewCandidate} from '../extension/detection.js';
import {MetaReelIdentity, ReadMetaReelPage, DiscoverMetaReel} from '../extension/lib/meta-reel.js';
import {ObserveResponse, NetworkCandidates} from '../extension/network.js';

const Facebook = 'https://www.facebook.com/reel/1824177091898417?locale=ko_KR';
const Instagram = 'https://www.instagram.com/reels/DfCSasTh1nR/';
let TabId = 990;
const Full = 'https://video.test.fbcdn.net/video.mp4?token=a%2Bb&tag=hd';
const IgFull = 'https://scontent.test.cdninstagram.com/reel.mp4?token=a%2Bb';
const Partial = Full + '&bytestart=940&byteend=17305';
function Setup(T, Page, Roots, Observed = [])
{
 TabId++;
 const Data = {['network:'+TabId]: Observed};
 globalThis.location = {href: Page};
 T.mock.method(globalThis,'fetch',async()=>new Response('',{status:404}));
 globalThis.document = {querySelectorAll: Selector => Selector.startsWith('script') ? Roots.map(Root => ({textContent: JSON.stringify(Root), type:'application/json'})) : []};
 globalThis.chrome = {permissions:{contains:async()=>true}, storage:{session:{get:async Key=>({[Key]:Data[Key]}),set:async Values=>Object.assign(Data,Values)}},
  scripting:{executeScript:async ({func:Func,args:Args=[]}) => [{documentId:'meta-doc',result: Func.name==='CollectVideos'
   ? {page:Page,sources:[],playlists:[],observerReady:true,timeOrigin:1} : await Func(...Args)}]}};
 T.after(()=>{for(const Key of ['chrome','location','document'])delete globalThis[Key];});
 return Data;
}
const FbNode = (Id='1824177091898417') => ({id:Id,videoDeliveryLegacyFields:{browser_native_hd_url:Full,browser_native_sd_url:Full.replace('tag=hd','tag=sd')}});

Test('Meta byte range MP4 responses are fragments, including audio tracks advertised as video/mp4',()=>
{
 for(const Base of [Full,IgFull]) for(const Range of ['&bytestart=0&byteend=939','&bytestart=940&byteend=17305'])
 {
  Assert.equal(ClassifyMediaUrl(Base+Range),null);
  Assert.equal(ClassifyResponseMedia(Base+Range,'video/mp4'),null);
 }
 Assert.equal(ClassifyMediaUrl(Full).url,Full);
 Assert.equal(ClassifyMediaUrl('https://cdn.test/clip.mp4?bytestart=0&byteend=9').supported,true);
 Assert.equal(ClassifyMediaUrl('https://fbcdn.net.evil.test/clip.mp4?bytestart=0&byteend=9').supported,true);
});

Test('Facebook reel chooses one full HD MP4 and discards cached range requests from that document',async T=>
{
 Setup(T,Facebook,[{data:{video:FbNode(),recommendation:FbNode('999')}}],Array.from({length:30},(_,Index)=>({url:Partial+'&n='+Index,
  name:'part.mp4',format:'MP4',supported:true,documentId:'meta-doc',initiator:'https://www.facebook.com'})));
 const Found=await FindMedia(TabId);
 Assert.deepEqual(Found.items.map(Item=>Item.url),[Full]);
 Assert.equal(Found.items[0].name,'Facebook-1824177091898417.mp4');
});

Test('Instagram chooses the largest complete version belonging to the current shortcode',async T=>
{
 Setup(T,Instagram,[{items:[{code:'other',video_url:Full},{code:'DfCSasTh1nR',video_versions:[
  {width:360,height:640,url:IgFull+'&quality=low'},{width:720,height:1280,url:IgFull}]}]}]);
 const Found=await FindMedia(TabId);
 Assert.deepEqual(Found.items.map(Item=>Item.url),[IgFull]);
 Assert.equal(Found.items[0].width,720);
 Assert.equal(Found.items[0].height,1280);
});

Test('unrelated Facebook metadata cannot hide a direct file or another document',async T=>
{
 const Direct={url:'https://cdn.test/movie.mp4',name:'movie.mp4',format:'MP4',supported:true,documentId:'meta-doc',initiator:'https://www.facebook.com'};
 Setup(T,Facebook,[FbNode('999')],[Direct]);
 Assert.deepEqual((await FindMedia(TabId)).items.map(Item=>Item.url),[Direct.url]);
});

Test('Instagram public embed has the same identity as its reel and parses nested ServerJS JSON without eval',async T=>
{
 const Page='https://www.instagram.com/p/DfCSasTh1nR/embed/';
 Assert.deepEqual(MetaReelIdentity(Page),{site:'Instagram',id:'DfCSasTh1nR'});
 Setup(T,Page,[]);
 document.querySelectorAll=()=>[{type:'',textContent:'s.handle({"contextJSON":'+JSON.stringify(JSON.stringify({gql_data:{shortcode_media:{shortcode:'DfCSasTh1nR',video_url:IgFull}}}))+'});'}];
 Assert.deepEqual((await FindMedia(TabId)).items.map(Item=>Item.url),[IgFull]);
});

Test('Instagram SPA fallback reads only the same-origin embed of the exact current post',async T=>
{
 Setup(T,Instagram,[{shortcode:'other',video_url:IgFull}]);
 const Reads=[];
 T.mock.method(globalThis,'fetch',async(Url,Options)=>{
  Reads.push(Url);Assert.equal(Options.credentials,'same-origin');
  return new Response('embed response');
 });
 globalThis.DOMParser=class {parseFromString(Text){Assert.equal(Text,'embed response');return {querySelectorAll:()=>[{type:'application/json',textContent:JSON.stringify({shortcode:'DfCSasTh1nR',video_url:IgFull})}]};}};
 T.after(()=>delete globalThis.DOMParser);
 Assert.deepEqual((await FindMedia(TabId)).items.map(Item=>Item.url),[IgFull]);
 Assert.deepEqual(Reads,['https://www.instagram.com/p/DfCSasTh1nR/embed/']);
 location.href=Instagram+'?changed=1';
 Assert.equal(await ReadMetaReelPage(Instagram,{site:'Instagram',id:'DfCSasTh1nR'},{maxBytes:4096,maxNodes:100,timeoutMs:100}),null);
 Assert.equal(Reads.length,1,'stale scans cannot fetch or expose a previous post');
});

Test('a valid full source does not suppress another document or accept a foreign CDN',async T=>
{
 const Other={url:Full+'&other=1',name:'other.mp4',format:'MP4',supported:true,documentId:'another-doc',initiator:'https://www.facebook.com',frameId:4,parentDocumentId:'meta-doc'};
 Setup(T,Facebook,[FbNode()],[Other]);
 chrome.scripting.executeScript=async({func:Func,args:Args=[],target:Target})=> Target.frameIds ? [{documentId:'another-doc'}]
  : [{documentId:'meta-doc',result:Func.name==='CollectVideos'?{page:Facebook,sources:[],playlists:[],observerReady:true,timeOrigin:1}:await Func(...Args)}];
 Assert.deepEqual((await FindMedia(TabId)).items.map(Item=>Item.url),[Full,Other.url]);
 document.querySelectorAll=()=>[{type:'application/json',textContent:JSON.stringify({id:'1824177091898417',videoDeliveryLegacyFields:{browser_native_hd_url:'https://fbcdn.net.evil.test/video.mp4',browser_native_sd_url:Full}})}];
 Assert.equal((await FindMedia(TabId)).items[0].url,Full);
});

Test('repeated Meta range responses do not exhaust the per-tab observation cache',async T=>
{
 Setup(T,Facebook,[]);
 const Request={tabId:TabId,frameId:0,documentId:'meta-doc',initiator:'https://www.facebook.com',method:'GET',statusCode:200,
  responseHeaders:[{name:'Content-Type',value:'video/mp4'}]};
 await ObserveResponse({...Request,url:'https://cdn.test/keep.mp4'});
 for(let Index=0;Index<100;Index++) await ObserveResponse({...Request,url:Full+'&bytestart='+Index+'&byteend='+(Index+1)});
 Assert.deepEqual((await NetworkCandidates(TabId,'meta-doc')).map(Item=>Item.url),['https://cdn.test/keep.mp4']);
});

Test('oversized or stale Instagram fallback responses cannot produce a candidate',async T=>
{
 Setup(T,Instagram,[]);
 const Policy={maxBytes:32,maxNodes:100,timeoutMs:100};
 let Canceled=false;
 T.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(Controller){Controller.enqueue(new Uint8Array(33));},cancel(){Canceled=true;}})));
 Assert.equal(await ReadMetaReelPage(Instagram,{site:'Instagram',id:'DfCSasTh1nR'},Policy),null);
 Assert.equal(Canceled,true);
 T.mock.method(globalThis,'fetch',async()=>{location.href=Instagram+'?next';return new Response('embed');});
 globalThis.DOMParser=class {parseFromString(){return {querySelectorAll:()=>[{type:'application/json',textContent:JSON.stringify({code:'DfCSasTh1nR',video_url:IgFull})}]};}};
 T.after(()=>delete globalThis.DOMParser);
 Assert.equal(await ReadMetaReelPage(Instagram,{site:'Instagram',id:'DfCSasTh1nR'},{...Policy,maxBytes:4096}),null);
});

Test('the current reel never suppresses a child-frame playlist identified only by its timeOrigin',async T=>
{
 Setup(T,Facebook,[FbNode()]);
 const Child='https://video.test.fbcdn.net/child.mpd';
 chrome.scripting.executeScript=async({func:Func,args:Args=[]})=>[{documentId:'meta-doc',result:Func.name==='CollectVideos'
  ? {page:Facebook,sources:[],playlists:[[Child,222]],observerReady:true,timeOrigin:111}:await Func(...Args)}];
 Assert.deepEqual((await FindMedia(TabId)).items.map(Item=>Item.url),[Full,Child]);
});

Test('concurrent and repeated post metadata reads are shared only within the same tab, document and page',async T=>
{
 Setup(T,Facebook,[FbNode()]);
 let Reads=0;
 const Original=chrome.scripting.executeScript;
 chrome.scripting.executeScript=async Input=>{Reads++;return Original(Input);};
 const Results=await Promise.all(Array.from({length:8},()=>DiscoverMetaReel(TabId,'meta-doc',Facebook)));
 Assert.ok(Results.every(Item=>Item?.url===Full));
 await DiscoverMetaReel(TabId,'meta-doc',Facebook);
 Assert.equal(Reads,1);
 await DiscoverMetaReel(TabId+1000,'meta-doc',Facebook);
 Assert.equal(Reads,2,'another tab cannot share cached metadata');
 await DiscoverMetaReel(TabId,'another-doc',Facebook);
 Assert.equal(Reads,3,'another document cannot share cached metadata');
 location.href=Facebook+'&next=1';
 await DiscoverMetaReel(TabId,'meta-doc',location.href);
 Assert.equal(Reads,4,'another page in the same document cannot share cached metadata');
 location.href=Facebook;
 const Later=Date.now()+31_000;
 T.mock.method(Date,'now',()=>Later);
 await DiscoverMetaReel(TabId,'meta-doc',Facebook);
 Assert.equal(Reads,5,'successful metadata must be refreshed after its TTL');
});

Test('Facebook SPA recovers the exact reel from its same-origin public embed when bootstrap data is absent',async T=>
{
 Setup(T,Facebook,[FbNode('999')]);
 const Reads=[];
 T.mock.method(globalThis,'fetch',async(Url,Options)=>{
  Reads.push(Url);Assert.equal(Options.credentials,'same-origin');return new Response('facebook response');
 });
 globalThis.DOMParser=class {parseFromString(Text){Assert.equal(Text,'facebook response');return {querySelectorAll:()=>[{type:'application/json',textContent:JSON.stringify(FbNode())}]};}};
 T.after(()=>delete globalThis.DOMParser);
 Assert.deepEqual((await FindMedia(TabId)).items.map(Item=>Item.url),[Full]);
 Assert.deepEqual(Reads,['https://www.facebook.com/plugins/video.php?href='+encodeURIComponent('https://www.facebook.com/reel/1824177091898417/')]);
});

Test('Facebook accepts a matching standalone legacy record and ignores irrelevant scripts before its data',async T=>
{
 Setup(T,Facebook,[]);
 document.querySelectorAll=()=>[{type:'',textContent:'x'.repeat(5000)},
  {type:'application/json',textContent:JSON.stringify({id:'1824177091898417',browser_native_hd_url:Full})}];
 const Result=await ReadMetaReelPage(Facebook,{site:'Facebook',id:'1824177091898417'},{maxBytes:4096,maxNodes:100,timeoutMs:100});
 Assert.equal(Result?.url,Full);
});

Test('Instagram native video dimensions survive extraction when only video_url is declared',async T=>
{
 Setup(T,Instagram,[{shortcode:'DfCSasTh1nR',video_url:IgFull,dimensions:{width:720,height:1280}}]);
 const [Item]=(await FindMedia(TabId)).items;
 Assert.deepEqual([Item.width,Item.height],[720,1280]);
});

Test('Instagram preview APIs expose native source dimensions even when the Blob player cannot be matched',async T=>
{
 Setup(T,Instagram,[{shortcode:'DfCSasTh1nR',video_url:IgFull,dimensions:{width:720,height:1280}}]);
 document.visibilityState='visible';
 const Result=await Scan(TabId), Input={tabId:TabId,scanId:Result.scanId,candidateId:0};
 Assert.equal(Result.candidates?.length,1);
 const [Thumbnail]=await CandidatePreviews({...Input,candidateIds:[0]});
 Assert.deepEqual(Thumbnail.resolution,{width:720,height:1280});
 Assert.deepEqual((await PreviewCandidate(Input)).resolution,{width:720,height:1280});
});

Test('Facebook public embed VideoConfig is read as JSON and bound to its own video_id',async T=>
{
 Setup(T,Facebook,[]);
 const Records=[{video_id:'999',hd_src:Full+'&other=1'},{video_id:'1824177091898417',hd_src:Full,sd_src:Full+'&sd=1',dash_manifest:'brackets } ] and escaped " quotes'}];
 document.querySelectorAll=()=>[{type:'',textContent:'s.handle({"instances":[["VideoConfig",{"videoData":'+JSON.stringify(Records)+'}]]});evil();'}];
 const Result=await ReadMetaReelPage(Facebook,{site:'Facebook',id:'1824177091898417'},{maxBytes:4096,maxNodes:100,timeoutMs:100});
 Assert.equal(Result?.url,Full);
});
