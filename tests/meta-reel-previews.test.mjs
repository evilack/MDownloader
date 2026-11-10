import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {CandidatePreviews, PreviewCandidate, ReadCandidateThumbnail} from '../extension/detection.js';

function Setup(T, Site='Facebook')
{
 const Page=Site==='Facebook'?'https://www.facebook.com/reel/1824177091898417?locale=ko_KR':'https://www.instagram.com/reels/DfCSasTh1nR/';
 const Id=Site==='Facebook'?'1824177091898417':'DfCSasTh1nR';
 const Item={id:0,url:'https://video.test.fbcdn.net/full.mp4',format:'MP4',supported:true,documentId:'meta-preview-doc',
  sourceIdentity:Site+':'+Id,page:Page,previewPage:Page};
 const Saved={scanId:'meta-preview-scan',documentId:Item.documentId,page:Page,candidates:[Item]};
 let Time=2;
 const Player={currentSrc:'blob:'+Page,videoWidth:720,videoHeight:1280,readyState:4,currentTime:2,duration:12,
  paused:false,ended:false,poster:'',closest:Selector=>Selector.includes('article')?{}:null,
  getBoundingClientRect:()=>({width:360,height:640,top:0,left:0,right:360,bottom:640}),querySelectorAll:()=>[],
  ownerDocument:{createElement:()=>({getContext:()=>({drawImage(){}}),toDataURL:()=>'data:image/jpeg;base64,frame-'+Time})}};
 const Players=[Player], Document={visibilityState:'visible',title:Site,querySelectorAll:()=>Players};
 globalThis.location={href:Page};globalThis.document=Document;
 globalThis.HTMLMediaElement={HAVE_CURRENT_DATA:2};
 globalThis.window={document:Document,location:globalThis.location,innerWidth:1200,innerHeight:800,length:0,
  performance:{getEntriesByType:()=>[],getEntriesByName:()=>[]}};
 globalThis.chrome={runtime:{id:'test'},permissions:{contains:async()=>true},storage:{session:{get:async Key=>({[Key]:Key.startsWith('scan:')?Saved:[]})}},
  scripting:{executeScript:async({func:Func,args:Args=[]})=>[{documentId:Item.documentId,result:await Func(...Args)}]}};
 T.after(()=>{for(const Key of ['chrome','window','document','location','HTMLMediaElement'])delete globalThis[Key];});
 return{item:Item,players:Players,player:Player,page:Page,input:{tabId:760,scanId:Saved.scanId,candidateId:0},
  advance(Value){Time=Value;Player.currentTime=Value;}};
}

for(const Site of ['Facebook','Instagram']) Test(Site+' binds its own full-file candidate to the visible Blob reel inside article and refreshes the frame',async T=>
{
 const E=Setup(T,Site);
 const [First]=await CandidatePreviews({...E.input,candidateIds:[0]});
 Assert.equal(First?.still,'data:image/jpeg;base64,frame-2');
 Assert.deepEqual(First.resolution,{width:720,height:1280});
 E.advance(5);
 const Hover=await PreviewCandidate(E.input);
 Assert.equal(Hover.still,'data:image/jpeg;base64,frame-5');
 Assert.deepEqual(Hover.resolution,{width:720,height:1280});
});

Test('the job thumbnail path also binds the exact Meta page player',async T=>
{
 const E=Setup(T);
 Assert.equal((await ReadCandidateThumbnail(E.input.tabId,E.item))?.still,'data:image/jpeg;base64,frame-2');
});

Test('Meta page binding excludes offscreen prefetch players but rejects two visible decoded players',async T=>
{
 const E=Setup(T);
 E.players.push({...E.player,currentSrc:'blob:https://www.facebook.com/other',getBoundingClientRect:()=>({width:360,height:640,top:2000,left:0,right:360,bottom:2640})});
 Assert.equal((await PreviewCandidate(E.input)).still,'data:image/jpeg;base64,frame-2');
 E.players[1].getBoundingClientRect=E.player.getBoundingClientRect;
 Assert.equal((await PreviewCandidate(E.input)).still,undefined);
});

Test('a different source identity, hidden player or stale page cannot borrow the current reel frame',async T=>
{
 const E=Setup(T);E.item.sourceIdentity='Facebook:other';
 Assert.equal((await PreviewCandidate(E.input)).still,undefined);
 E.item.sourceIdentity='Facebook:1824177091898417';E.player.closest=()=>({});
 Assert.equal((await PreviewCandidate(E.input)).still,undefined);
 location.href=E.page+'&changed=1';
 Assert.deepEqual(await CandidatePreviews({...E.input,candidateIds:[0]}),[]);
});

Test('the periodic candidate thumbnail reads a newer frame after its shared cache expires',async T=>
{
 const E=Setup(T,'Instagram');E.item.url+='?cache-expiry';
 let Clock=0;T.mock.method(performance,'now',()=>Clock);
 const Read=async()=>(await CandidatePreviews({...E.input,candidateIds:[0]}))[0];
 Assert.equal((await Read()).still,'data:image/jpeg;base64,frame-2');
 E.advance(8);Clock=16_000;
 Assert.equal((await Read()).still,'data:image/jpeg;base64,frame-8');
});

Test('a visibly rendered reel is not hidden merely by an aria-hidden accessibility wrapper',async T=>
{
 const E=Setup(T);E.item.url+='?aria-wrapper';
 E.player.closest=Selector=>Selector.includes('[aria-hidden="true"]')?{}:null;
 Assert.equal((await PreviewCandidate(E.input)).still,'data:image/jpeg;base64,frame-2');
});

Test('transparent ancestor wrappers do not count as a visible Meta reel',async T=>
{
 const E=Setup(T);E.item.url+='?transparent-wrapper';
 const Wrapper={parentElement:null},Hidden={...E.player,currentSrc:'blob:https://www.facebook.com/prefetch',parentElement:Wrapper};
 window.getComputedStyle=Node=>({visibility:'visible',opacity:Node===Wrapper?'0':'1'});
 E.players.push(Hidden);
 Assert.equal((await PreviewCandidate(E.input)).still,'data:image/jpeg;base64,frame-2');
 E.players.shift();
 Assert.equal((await PreviewCandidate(E.input)).still,undefined);
});
