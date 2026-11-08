import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateYoutubeRunner} from '../extension/features/youtube/runner.js';
const Id='11111111-1111-1111-1111-111111111111',Child='22222222-2222-2222-2222-222222222222';
const wait=()=>new Promise(r=>setTimeout(r,0));
test('init-only committed bytes with declared endpoints cannot stop or snapshot the receiving parent',async()=>{
 const events=[];let opts;
 const dir={async getFileHandle(){return{async createWritable(){return{write:async()=>{},close:async()=>{},abort:async()=>{}};},async getFile(){return new Blob([new Uint8Array([0,0,0,8,102,116,121,112])]);}};}};
 const runner=CreateYoutubeRunner({client:{async ResolveYoutubeSelection(){return{config:{},selection:{}};}},workspaces:{async create(){return dir;},async release(){}},receiveCaptions:async()=>({tracks:[],receipt:{count:0}}),
  async receive(_c,_s,o){opts=o;for(const k of ['video','audio'])await(await o.createWriter(k)).write(new Uint8Array([1]));o.report({stage:'sabr-bytes',video:8,audio:8,videoEndMs:740000,audioEndMs:740000});await new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));}});
 await runner({type:'youtubeRun',job:{requestId:Id},quality:{}},{report:async(...args)=>events.push(args),saveFile:async()=>assert.fail('init-only save')});
 while(!events.some(e=>e[1]==='progress'))await wait();assert.equal(events.find(e=>e[1]==='progress')[2].snapshotAvailable,false);
 assert.equal(await runner({type:'youtubeFinish',requestId:Id}),false);assert.equal(opts.stopSignal.aborted,false);
 await assert.rejects(runner({type:'youtubeSnapshot',requestId:Id,job:{requestId:Child,youtube:true,snapshot:true,snapshotParent:Id}}));
 await runner({type:'youtubeCancel',requestId:Id});await wait();assert.deepEqual(await runner({type:'youtubeActive'}),[]);
});
test('snapshot owns its save independently; parent continues then finish clips captions and releases both',async()=>{
 const reports=[],saves=[],muxes=[],releases=[];let opts,releaseSave;
 const pendingSave=new Promise(r=>releaseSave=r);
 const dir={async getFileHandle(){return{async createWritable(){return{write:async()=>{},close:async()=>{},abort:async()=>{}};},async getFile(){return new Blob(['committed']);}};}};
 const runner=CreateYoutubeRunner({prefixReady:async()=>true,client:{async ResolveYoutubeSelection(){return{config:{},selection:{}};}},workspaces:{async create(){return dir;},async release(id){releases.push(id);}},receiveCaptions:async()=>({tracks:[{language:'ko',content:'vtt'}],receipt:{count:1,phase:'ready'}}),
  async receive(_c,_s,o){opts=o;const v=await o.createWriter('video'),a=await o.createWriter('audio');await v.write(new Uint8Array([1]));await a.write(new Uint8Array([2]));o.report({stage:'sabr-bytes',video:1,audio:1,videoEndMs:10000,audioEndMs:10000});await new Promise(r=>o.stopSignal.addEventListener('abort',r,{once:true}));return{partial:true,bytes:{video:2,audio:2}};},
  async remux(_v,_a,_w,_s,options){muxes.push(options);return{duration:8,start:0};},async muxCaptions(_f,tracks){assert.equal(tracks[0].allowEmptyAfterClip,true);assert.equal(tracks[0].offset,0);}});
 const deps={report:async(...args)=>{reports.push(args);if(args[1]==='youtubePartial')return 'movie_partial.mp4';},async saveFile(job){assert.equal(job.filename,'movie_partial.mp4');saves.push(job.requestId);if(job.requestId===Child)await pendingSave;}};
 await runner({type:'youtubeRun',job:{requestId:Id,pickedDownloadFolder:'folder-id',filename:'movie.mp4'},quality:{}},deps);await wait();await wait();
 const snapshot=runner({type:'youtubeSnapshot',requestId:Id,job:{requestId:Child,snapshot:true,youtube:true,snapshotParent:Id}},deps);await wait();await wait();
 assert.ok(saves.includes(Child));assert.equal(opts.signal.aborted,false);assert.equal(opts.stopSignal.aborted,false);
 assert.ok((await runner({type:'youtubeActive'})).includes(Child));
 await assert.rejects(runner({type:'youtubeSnapshot',requestId:Id,job:{requestId:Child,snapshot:true,youtube:true,snapshotParent:Id}},deps));
 assert.equal(await runner({type:'youtubeFinish',requestId:Id},deps),true);await wait();await wait();assert.ok(saves.includes(Id));assert.equal(releases.includes(Id),false);
 releaseSave();await snapshot;await wait();assert.deepEqual((await runner({type:'youtubeActive'})),[]);assert.ok(releases.includes(Id));
 assert.ok(muxes.every(o=>o.preserveTrackEnds===false));assert.ok(reports.some(e=>e[1]==='youtubePartial'&&e[2].receipt.duration===8));
});
test('canceling a child save leaves parent receiving, and late finish after parent cancel is rejected',async()=>{
 let receiveOptions,childSaving=false;const events=[],released=[];
 const dir={async getFileHandle(){return{async createWritable(){return{write:async()=>{},close:async()=>{},abort:async()=>{}};},async getFile(){return new Blob(['media']);}};}};
 const runner=CreateYoutubeRunner({prefixReady:async()=>true,client:{async ResolveYoutubeSelection(){return{config:{},selection:{}};}},workspaces:{async create(){return dir;},async release(id){released.push(id);}},receiveCaptions:async()=>({tracks:[],receipt:{count:0,phase:'unavailable'}}),
  async receive(_c,_s,o){receiveOptions=o;for(const kind of ['video','audio'])await(await o.createWriter(kind)).write(new Uint8Array([1]));o.report({stage:'sabr-bytes',video:1,audio:1,videoEndMs:10,audioEndMs:10});await new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));},
  remux:async()=>({duration:1,start:0})});
 const deps={report:async(...args)=>events.push(args),async saveFile(_job,_file,signal){childSaving=true;await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
 await runner({type:'youtubeRun',job:{requestId:Id},quality:{}},deps);await wait();await wait();
 const snapshot=runner({type:'youtubeSnapshot',requestId:Id,job:{requestId:Child,youtube:true,snapshot:true,snapshotParent:Id}},deps);void snapshot.catch(()=>{});
 while(!childSaving)await wait();assert.equal(await runner({type:'youtubeCancel',requestId:Child}),true);await assert.rejects(snapshot);
 assert.equal(receiveOptions.signal.aborted,false);assert.equal(receiveOptions.stopSignal.aborted,false);assert.ok((await runner({type:'youtubeActive'})).includes(Id));assert.ok(!released.includes(Id));
 assert.equal(await runner({type:'youtubeCancel',requestId:Id}),true);assert.equal(await runner({type:'youtubeFinish',requestId:Id}),false);await wait();
 assert.equal(events.filter(e=>e[1]==='failure'&&e[2].canceled).length,2);assert.deepEqual(await runner({type:'youtubeActive'}),[]);
});
