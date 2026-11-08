import test from 'node:test';import assert from 'node:assert/strict';
import{SavedMediaMime,SelectedFolderEntries}from'../extension/lib/saved-folder-view.js';
test('only explicit media extensions get a link, including against inherited object keys',()=>{
 assert.equal(SavedMediaMime('saved.MP4'),'video/mp4');assert.equal(SavedMediaMime('sound.m4a'),'audio/mp4');
 for(const name of['saved.html','saved.constructor','saved.__proto__','saved.toString'])assert.equal(SavedMediaMime(name),undefined);
});
test('the selected file stays first and unique even when directory enumeration is truncated',async()=>{
 let read=0;const folder={async *values(){for(let i=0;i<1005;i++){read++;yield{name:'other-'+i,kind:'file'};}yield{name:'saved.mp4',kind:'file'};}};
 const result=await SelectedFolderEntries(folder,'saved.mp4');assert.equal(result.entries[0].name,'saved.mp4');assert.equal(result.entries.length,1000);assert.equal(result.truncated,true);assert.ok(read<=1000);
 const small={async *values(){yield{name:'saved.mp4',kind:'file'};yield{name:'notes.txt',kind:'file'};}};
 assert.deepEqual((await SelectedFolderEntries(small,'saved.mp4')).entries.map(e=>e.name),['saved.mp4','notes.txt']);
});
