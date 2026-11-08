import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscoverYoutube,ResolveYoutubeSelection} from '../extension/features/youtube/jobs.js';
test('API context is extension POST only and is released when discovery fails',async()=>{
 const rules=[];
 globalThis.chrome={runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,getContexts:async()=>[{}],sendMessage:async()=>({ok:false,error:{key:'youtube_restricted',args:[]}})},declarativeNetRequest:{updateSessionRules:async r=>rules.push(r)}};
 try{await assert.rejects(DiscoverYoutube({url:'https://www.youtube.com/watch?v=-XHx839rSc8'}),{key:'youtube_restricted'});
  const rule=rules[0].addRules[0];assert.deepEqual(rule.condition.initiatorDomains,['extension']);assert.deepEqual(rule.condition.requestMethods,['post']);assert.equal(rule.condition.urlFilter,'|https://www.youtube.com/youtubei/');
  assert.deepEqual(rules.at(-1).addRules,[]);
  await assert.rejects(ResolveYoutubeSelection({}, {url:'https://www.youtube.com/watch?v=-XHx839rSc8'},{videoId:'other'}),{key:'youtube_session_changed'});
 }finally{delete globalThis.chrome;}
});
test('failed header rule acquisition does not retain a reference for the next discovery',async()=>{
 let fail=true;const rules=[];
 globalThis.chrome={runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,getContexts:async()=>[{}],sendMessage:async()=>({ok:true,data:[]})},declarativeNetRequest:{async updateSessionRules(r){if(fail){fail=false;throw Error('rule-failed');}rules.push(r);}}};
 try{await assert.rejects(DiscoverYoutube({url:'https://www.youtube.com/watch?v=-XHx839rSc8'}));await DiscoverYoutube({url:'https://www.youtube.com/watch?v=-XHx839rSc8'});assert.deepEqual(rules.at(-1).addRules,[]);}
 finally{delete globalThis.chrome;}
});
