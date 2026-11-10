import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadCandidateThumbnail} from '../extension/detection.js';
import {CollectPlayerPreviews} from '../extension/lib/player-previews.js';

const Page='https://www.youtube.com/watch?v=FACJInvEmY8';

test('YouTube list and job thumbnails use the video cover even before playback is ready',async t=>{
 let Players=[];
 globalThis.location={href:Page};
 globalThis.HTMLMediaElement={HAVE_CURRENT_DATA:2};
 globalThis.window={document:{querySelectorAll:()=>Players},performance:{getEntriesByType:()=>[],getEntriesByName:()=>[]},length:0};
 globalThis.chrome={scripting:{executeScript:async({func,args})=>[{documentId:'cover-doc',result:func(...args)}]}};
 t.after(()=>{for(const Key of ['location','HTMLMediaElement','window','chrome'])delete globalThis[Key];});
 const Item={id:0,url:Page,format:'YOUTUBE',page:Page,previewPage:Page,documentId:'cover-doc'};
 const Cover='https://i.ytimg.com/vi/FACJInvEmY8/mqdefault.jpg';
 assert.equal((await ReadCandidateThumbnail(9,Item))?.still,Cover);
 Players=[{currentSrc:'blob:https://www.youtube.com/player',videoWidth:1280,videoHeight:720,
  duration:120,currentTime:45,readyState:4,querySelectorAll:()=>[],closest:()=>null,
  getBoundingClientRect:()=>({width:640,height:360}),
  ownerDocument:{createElement(){assert.fail('official cover must not capture a playback frame');}}}];
 const Preview=await ReadCandidateThumbnail(9,{...Item,documentId:'playing-doc'});
 assert.equal(Preview.still,Cover);
 assert.equal(Preview.duration,120);
 assert.deepEqual(Preview.resolution,{width:1280,height:720});
 location.href='https://www.youtube.com/watch?v=-XHx839rSc8';
 assert.equal(await ReadCandidateThumbnail(9,{...Item,documentId:'navigated-doc'}),undefined);
});

test('the YouTube cover hint does not replace hover frames or cross video identities',async t=>{
 globalThis.location={href:Page};globalThis.window={document:{querySelectorAll:()=>[]},length:0};
 t.after(()=>{delete globalThis.location;delete globalThis.window;});
 // Without a thumbnail-only hint the existing hover collector still needs a player.
 assert.deepEqual(CollectPlayerPreviews([{id:0,url:Page,pagePlayer:true}],{},Page),[]);
 globalThis.chrome={scripting:{executeScript:async({func,args})=>[{documentId:'other-cover-doc',result:func(...args)}]}};
 t.after(()=>delete globalThis.chrome);
 assert.equal(await ReadCandidateThumbnail(9,{id:0,url:'https://www.youtube.com/watch?v=-XHx839rSc8',format:'YOUTUBE',
  page:Page,previewPage:Page,documentId:'other-cover-doc'}),undefined);
});
