import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CaptureVisiblePlayerThumbnail, ValidateVisiblePlayerCrop} from '../extension/lib/visible-player-thumbnail.js';
const Crop={source:'https://video.test.fbcdn.net/player.mp4',x:10,y:20,width:400,height:200,viewportWidth:800,viewportHeight:600};
function setup(t){
 let current=true,captures=0,decodes=0,closed=0;const draws=[];
 globalThis.chrome={tabs:{get:async()=>({id:7,windowId:1,active:true}),query:async()=>[{id:7}],captureVisibleTab:async()=>{captures++;return'data:image/jpeg;base64,AQID';}},scripting:{executeScript:async()=>[{documentId:'doc',result:current}]}};
 globalThis.createImageBitmap=async()=>{decodes++;return{width:1600,height:1200,close(){closed++;}};};
 globalThis.OffscreenCanvas=class{constructor(width,height){this.width=width;this.height=height;}getContext(){return{drawImage:(...args)=>draws.push(args.slice(1))};}async convertToBlob(){return new Blob([new Uint8Array([1,2])],{type:'image/jpeg'});}};
 t.after(()=>{for(const k of ['chrome','createImageBitmap','OffscreenCanvas'])delete globalThis[k];});
 return{draws,change(){current=false;},counts:()=>({captures,decodes,closed})};
}
test('captures only the validated active player crop and scales CSS coordinates to device pixels',async t=>{
 const e=setup(t);
 assert.equal(await CaptureVisiblePlayerThumbnail(7,'doc','https://www.instagram.com/reels/post/',Crop,{maxWidth:112,maxHeight:63,jpegQuality:0.75}),'data:image/jpeg;base64,AQI=');
 assert.deepEqual(e.draws,[[20,40,800,400,0,0,112,56]]);
 assert.deepEqual(e.counts(),{captures:1,decodes:1,closed:1});
});
test('navigation or active-tab changes cannot return pixels from another page',async t=>{
 const e=setup(t);chrome.tabs.captureVisibleTab=async()=>{e.change();return'data:image/jpeg;base64,AQID';};
 assert.equal(await CaptureVisiblePlayerThumbnail(7,'doc','https://www.facebook.com/reel/1/',Crop,{maxWidth:112,maxHeight:63}),null);
 assert.equal(e.counts().decodes,0);
 chrome.tabs.get=async()=>({id:7,windowId:1,active:false});
 assert.equal(await CaptureVisiblePlayerThumbnail(7,'doc','https://www.facebook.com/reel/1/',Crop,{}),null);
});
test('invalid or out-of-viewport crops never invoke native tab capture',async t=>{
 const e=setup(t);
 for(const Extra of [{width:0},{x:-1},{width:801},{viewportHeight:0},{x:NaN}])assert.equal(await CaptureVisiblePlayerThumbnail(7,'doc','https://www.instagram.com/reels/post/',{...Crop,...Extra},{}),null);
 assert.equal(e.counts().captures,0);
});

test('the injected validator rejects UI overlays, source changes and extra visible players',t=>{
 const Page='https://www.instagram.com/reels/post/';
 const Bounds={left:10,top:20,right:410,bottom:220,width:400,height:200};
 const Player={currentSrc:Crop.source,videoWidth:720,readyState:4,parentElement:null,getBoundingClientRect:()=>Bounds,contains:()=>false};
 const Players=[Player];let Hit=Player;
 globalThis.location={href:Page};globalThis.innerWidth=800;globalThis.innerHeight=600;
 globalThis.document={visibilityState:'visible',querySelectorAll:()=>Players,elementFromPoint:()=>Hit};
 globalThis.getComputedStyle=()=>({visibility:'visible',opacity:'1'});
 t.after(()=>{for(const K of ['location','innerWidth','innerHeight','document','getComputedStyle'])delete globalThis[K];});
 assert.equal(ValidateVisiblePlayerCrop(Page,Crop),true);
 Hit={closest:()=>({}),contains:()=>false};
 assert.equal(ValidateVisiblePlayerCrop(Page,Crop),false,'a covering dialog is not a video frame');
 Hit={closest:()=>null,contains:()=>false};
 assert.equal(ValidateVisiblePlayerCrop(Page,Crop),false,'an unrelated comments panel is not video chrome');
 const Controls={closest:Selector=>Selector.includes('button')?Controls:null,contains:()=>false};
 const MediaBox={parentElement:null,getBoundingClientRect:()=>({width:420,height:210}),contains:Node=>Node===Controls};
 Player.parentElement={parentElement:MediaBox,getBoundingClientRect:()=>({width:420,height:210}),contains:()=>false};
 Hit=Controls;assert.equal(ValidateVisiblePlayerCrop(Page,Crop),true,'nearby button chrome inside the bounded media wrapper is allowed');
 Player.parentElement=null;
 Hit=Player;Player.currentSrc+='?changed';assert.equal(ValidateVisiblePlayerCrop(Page,Crop),false);
 Player.currentSrc=Crop.source;Players.push({...Player});assert.equal(ValidateVisiblePlayerCrop(Page,Crop),false);
});
