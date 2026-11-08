import test from 'node:test';
import assert from 'node:assert/strict';
import {YoutubeQualities} from '../extension/features/youtube/qualities.js';
import {SummarizeJob} from '../extension/lib/browser-job-state.js';
import {readFile} from 'node:fs/promises';

test('YouTube quality pairs retain exact format identity and exclude unsupported codecs', () => {
 const info={sessionKey:'session',videoId:'-XHx839rSc8',formats:[
  {id:'137:0',kind:'video',codecs:['avc1.640028'],height:1080,width:1920,bitrate:1000},
  {id:'18:1',kind:'video',codecs:['avc1.42001e'],height:360,width:640,bitrate:500},
  {id:'140:2',kind:'audio',codecs:['mp4a.40.2'],bitrate:128000},
  {id:'140:3',kind:'audio',codecs:['mp4a.40.2'],bitrate:64000},
  {id:'248:4',kind:'video',codecs:['vp09'],height:1080}]};
 const result=YoutubeQualities(info);
 assert.equal(result.length,2);assert.equal(result[0].resolution,'1920x1080');
 assert.deepEqual(result[0].quality,{sessionKey:'session',videoId:'-XHx839rSc8',selection:{videoFormatId:'137:0',audioFormatId:'140:2'}});
 assert.equal(JSON.stringify(result).includes('googlevideo'),false);
});
test('YouTube transfer is active through its own runner and fails after runner loss',()=>{
 const job={requestId:'yt',youtube:true,state:'active',bytesReceived:120};
 assert.equal(SummarizeJob(job,null,{youtubeIds:['yt']}).state,'active');
 assert.equal(SummarizeJob(job,null,{youtubeIds:[]}).state,'failed');
 assert.equal(SummarizeJob({...job,state:'canceled'},null).state,'canceled');
});
test('service-worker provider entry uses static imports for worker operations',async()=>{
 const source=await readFile(new URL('../extension/features/youtube/entry.js',import.meta.url),'utf8');
 assert.match(source,/export\s*\{[^}]*DiscoverYoutube[^}]*ResolveYoutubeSelection[^}]*CancelYoutube[^}]*\}\s*from\s*['"]\.\/jobs.js['"]/);
});
