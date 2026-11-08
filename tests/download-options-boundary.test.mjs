import test from 'node:test';import assert from 'node:assert/strict';
import{Enqueue}from'../extension/jobs.js';import{HlsQualities}from'../extension/hls-jobs.js';
import{DescribeSubtitleTracks}from'../extension/lib/download-options-selection.js';
test('manifest-only subtitle choices reach the runner before filtering against its complete source set',async t=>{
 const Page='https://player.test/watch',Doc='manifest-doc',url='https://cdn.test/master.m3u8',local={usePageTitle:false,useDownloadDateTime:false},session={'scan:3':{scanId:'scan',documentId:Doc,page:Page,candidates:[{id:0,name:'master.m3u8',url,format:'M3U8',supported:true,documentId:Doc}]}},sent=[];
 const storage=data=>({get:async key=>Object.fromEntries((key==null?Object.keys(data):Array.isArray(key)?key:[key]).map(k=>[k,data[k]])),set:async value=>Object.assign(data,value)});
 globalThis.chrome={storage:{local:storage(local),session:storage(session)},permissions:{contains:async()=>true},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,getContexts:async()=>[{}],sendMessage:async message=>{sent.push(message);return{ok:true};}},scripting:{executeScript:async({func})=>[{documentId:Doc,result:func.name==='ReadPageSubtitles'?[]:{page:Page,active:true,pageTitle:'Fixture'}}]},downloads:{search:async()=>[]}};
 t.after(()=>delete globalThis.chrome);t.mock.method(globalThis,'fetch',async()=>new Response('#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360,SUBTITLES="subs"\nlow.m3u8\n'));
 const input={tabId:3,scanId:'scan',candidateId:0};const options=await HlsQualities(input);assert.equal(options[0].subtitles.length,1);assert.equal(session['scan:3'].candidates[0].qualities,undefined);
 const[caption]=await DescribeSubtitleTracks(options[0].subtitles);const subtitleOptions={trackIds:[caption.id],translation:{enabled:false,targetLanguage:'ko',sourceLanguage:'auto',provider:'google',model:'',effort:''}};
 await Enqueue({...input,variantUrl:options[0].url,requestId:'55555555-5555-4555-8555-555555555555',subtitleOptions});
 const run=sent.find(m=>m.type==='hlsRun');assert.deepEqual(run.job.subtitleOptions,subtitleOptions);assert.equal(JSON.stringify(local).includes('en.m3u8'),false);
});
