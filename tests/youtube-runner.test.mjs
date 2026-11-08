import test from 'node:test';
import assert from 'node:assert/strict';
import {CreateYoutubeRunner} from '../extension/features/youtube/runner.js';
import {LocalizedError} from '../extension/lib/i18n.js';
const Id='11111111-1111-1111-1111-111111111111';
const wait=()=>new Promise(r=>setTimeout(r,0));
test('receive cancellation waits for an earlier progress write before terminal state',async()=>{
 let releaseProgress,enteredProgress;const entered=new Promise(r=>enteredProgress=r),pending=new Promise(r=>releaseProgress=r);
 let state='active';const events=[];
 const handle=CreateYoutubeRunner({client:{async ResolveYoutubeCaptions(){return[];},async ResolveYoutubeSelection(){return{config:{},selection:{}};}},workspaces:{async create(){return{};},async release(){}},
  receive(_config,_selection,options){options.report({stage:'sabr-bytes',video:12,audio:8});return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}});
 await handle({type:'youtubeRun',job:{requestId:Id},quality:{}},{saveFile:async()=>assert.fail('must not save'),report:async(_id,action,fields)=>{if(action==='progress'){enteredProgress();await pending;state='active';}else if(action==='failure'){state=fields.canceled?'canceled':'failed';}events.push(action);}});
 await entered;await handle({type:'youtubeCancel',requestId:Id});await wait();
 const terminalBeforeProgress=events.includes('failure');releaseProgress();await wait();
 assert.equal(terminalBeforeProgress,false);assert.deepEqual(events.filter(e=>e!=='youtubeCaptions'),['progress','failure']);assert.equal(state,'canceled');
});
test('YouTube cancel aborts pending resolution, reports canceled, and releases its active ID',async()=>{
 const events=[];let saves=0;
 const handle=CreateYoutubeRunner({client:{async ResolveYoutubeCaptions(){return[];},ResolveYoutubeSelection(_quality,signal){return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}}});
 const deps={report:async(...a)=>events.push(a),saveFile:async()=>saves++};
 await handle({type:'youtubeRun',job:{requestId:Id},quality:{}},deps);
 assert.deepEqual(await handle({type:'youtubeActive'}),[Id]);
 assert.equal(await handle({type:'youtubeCancel',requestId:Id}),true);await wait();
 assert.deepEqual(await handle({type:'youtubeActive'}),[]);assert.equal(saves,0);
 assert.equal(events[0][1],'failure');assert.equal(events[0][2].canceled,true);
});
test('YouTube revoked permission fails without saving or exposing the resolved config',async()=>{
 const events=[];let saves=0;
 const handle=CreateYoutubeRunner({client:{async ResolveYoutubeCaptions(){return[];},async ResolveYoutubeSelection(){throw new LocalizedError('youtube_permission_denied');}}});
 await handle({type:'youtubeRun',job:{requestId:Id},quality:{}},{report:async(...a)=>events.push(a),saveFile:async()=>saves++});await wait();
 assert.equal(events[0][2].error.key,'youtube_permission_denied');assert.equal(saves,0);assert.deepEqual(await handle({type:'youtubeActive'}),[]);
});
test('YouTube keeps scratch and active ownership until native save finishes',async()=>{
 const events=[];let release=0,muxOptions,finishSave;
 const saved=new Promise(r=>finishSave=r);
 const directory={async getFileHandle(){return{async getFile(){return new Blob(['media']);},async createWritable(){return{abort:async()=>{}};}};}};
 const handle=CreateYoutubeRunner({client:{async ResolveYoutubeCaptions(){return[];},async ResolveYoutubeSelection(){return{config:{secret:'session'},selection:{}};}},
  workspaces:{async create(){return directory;},async release(){release++;}},
  async receive(_config,_selection,options){options.report({stage:'sabr-bytes',video:12,audio:8});return{bytes:{video:12,audio:8},videoEndMs:622567,audioEndMs:622853};},
  async remux(_v,_a,_writer,_signal,options){muxOptions=options;}});
 const deps={report:async(...a)=>events.push(a),saveFile:async()=>saved};
 await handle({type:'youtubeRun',job:{requestId:Id},quality:{}},deps);await wait();
 assert.equal(release,0);assert.deepEqual(await handle({type:'youtubeActive'}),[Id]);
 assert.deepEqual(muxOptions,{preserveTrackEnds:true});assert.equal(events.find(e=>e[1]==='progress'&&e[2].muxing)[2].received,20);
 assert.equal(JSON.stringify(events).includes('secret'),false);
 finishSave();await wait();assert.equal(release,1);assert.deepEqual(await handle({type:'youtubeActive'}),[]);
});
test('YouTube received captions are muxed before save and caption failure cannot save an AV-only success',async()=>{
 for(const fail of [false,true]){
  const calls=[],events=[];const directory={async getFileHandle(name){return{async getFile(){return new Blob([name]);},async createWritable(){return{abort:async()=>{}};}};}};
  const handle=CreateYoutubeRunner({client:{async ResolveYoutubeCaptions(){return[];},async ResolveYoutubeSelection(){return{config:{},selection:{}};}},workspaces:{async create(){return directory;},async release(){calls.push('release');}},
   async receiveCaptions(){calls.push('captions');if(fail)throw new LocalizedError('subtitle_download_failed');return{tracks:[{language:'ko',content:'source-vtt'}],receipt:{count:1,phase:'ready'}};},
   async receive(){calls.push('av');return{bytes:{video:2,audio:1},videoEndMs:1000,audioEndMs:1000};},async remux(){calls.push('av-mux');},
   async muxCaptions(_file,tracks){calls.push('caption-mux');assert.equal(tracks[0].content,'source-vtt');}});
  await handle({type:'youtubeRun',job:{requestId:Id},quality:{}},{report:async(...args)=>events.push(args),saveFile:async(_job,file)=>{calls.push('save');assert.equal(await file.text(),'subtitled.mp4');}});await wait();await wait();
  if(fail){assert.equal(calls.includes('save'),false);assert.equal(events.at(-1)[2].error.key,'subtitle_download_failed');}
  else{assert.deepEqual(calls,['captions','av','av-mux','caption-mux','save','release']);assert.equal(events.find(e=>e[1]==='youtubeCaptions')[2].receipt.count,1);}
 }
});
test('YouTube subtitle mux failure aborts output and releases ownership without native save',async()=>{
 let aborted=0,released=0,saved=0;const reports=[];
 const directory={async getFileHandle(){return{async getFile(){return new Blob(['media']);},async createWritable(){return{async abort(){aborted++;}};}};}};
 const handle=CreateYoutubeRunner({client:{async ResolveYoutubeSelection(){return{config:{},selection:{}};}},workspaces:{async create(){return directory;},async release(){released++;}},
  receiveCaptions:async()=>({tracks:[{language:'ko',content:'vtt'}],receipt:{phase:'ready',count:1,completed:1}}),receive:async()=>({bytes:{video:2,audio:1}}),remux:async()=>{},muxCaptions:async()=>{throw Error('destination-failed');}});
 await handle({type:'youtubeRun',job:{requestId:Id},quality:{}},{report:async(...a)=>reports.push(a),saveFile:async()=>saved++});await wait();await wait();
 assert.equal(saved,0);assert.equal(aborted,1);assert.equal(released,1);assert.deepEqual(await handle({type:'youtubeActive'}),[]);assert.equal(reports.at(-1)[2].error.key,'subtitle_mux_failed');
});
