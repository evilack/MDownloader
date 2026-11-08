import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {ReadSubtitles, FindHlsSubtitles, FindDashSubtitles, SubtitleLimits} from '../extension/lib/subtitles.js';
test('WebVTT clearing cues with empty payload retain their timing', async () => {
 const [track]=await ReadSubtitles([{language:'ko',text:'WEBVTT\n\n00:00:01.000 --> 00:00:02.000 align:start\n\n00:00:02.000 --> 00:00:03.000\nActual caption\n'}]);
 assert.match(track.content,/00:00:01.000 --> 00:00:02.000 align:start\n/);assert.match(track.content,/Actual caption/);
});
test('space-only WebVTT payload lines are not cue separators',async()=>{
 const [track]=await ReadSubtitles([{text:'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n \nActual caption\n'}]);
 assert.match(track.content,/Actual caption/);
});

const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';
test('all declared languages are retained and SRT/TTML become WebVTT', async () => {
 const tracks = await ReadSubtitles([
  {text: vtt, language:'en', label:'English'},
  {text:'1\n00:00:03,000 --> 00:00:04,250\n안녕\n', language:'ko', format:'srt'},
  {text:'<tt xmlns="http://www.w3.org/ns/ttml"><body><div begin="1s"><p begin="2s" dur="1.5s">A &amp; B<br/>next</p></div></body></tt>', language:'de', format:'ttml'},
 ]);
 assert.deepEqual(tracks.map(t=>t.language), ['en','ko','de']);
 assert.match(tracks[1].content, /00:00:03\.000 --> 00:00:04\.250\n안녕/);
 assert.match(tracks[2].content, /00:00:03\.000 --> 00:00:04\.500\nA &amp; B\nnext/);
});

test('HLS selects declared subtitle group by actual variant URL and preserves every language', () => {
 const text = '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub-a",LANGUAGE="en",NAME="English, CC",URI="en/list.m3u8?sig=1"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub-a",LANGUAGE="es",NAME="Español",URI="/es.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="sub-b",LANGUAGE="fr",NAME="French",URI="fr.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=4,SUBTITLES="sub-a"\nvideo/main.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=8,SUBTITLES="sub-b"\nother.m3u8';
 const found = FindHlsSubtitles(text, 'https://example.test/root/master.m3u8', 'https://example.test/root/video/main.m3u8');
 assert.deepEqual(found.map(t=>[t.url,t.language,t.label]), [['https://example.test/root/en/list.m3u8?sig=1','en','English, CC'],['https://example.test/es.m3u8','es','Español']]);
 assert.equal(FindHlsSubtitles(text, 'https://example.test/root/master.m3u8').length,3);
});

test('DASH resolves hierarchical BaseURLs and exposes segmented unsupported tracks', async () => {
 const text = '<MPD><BaseURL>https://cdn.example.test/assets/</BaseURL><Period><BaseURL>movie/</BaseURL><AdaptationSet mimeType="text/vtt" lang="en"><Label>English CC</Label><Representation id="en"><BaseURL>en.vtt</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="text" mimeType="application/ttml+xml" lang="fr"><SegmentTemplate media="$Number$.m4s"/><Representation id="fr"/></AdaptationSet></Period></MPD>';
 const found = FindDashSubtitles(text,'https://example.test/manifest.mpd');
 assert.equal(found.length,2);
 assert.equal(found[0].url,'https://cdn.example.test/assets/movie/en.vtt');
 assert.equal(found[0].label,'English CC');
 await assert.rejects(ReadSubtitles([found[1]]), {key:'subtitle_unsupported'});
});

async function fixture(handler, run) {
 const server = createServer(handler);
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 try { await run(`http://127.0.0.1:${server.address().port}`); }
 finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}

test('fetch authorizes every resource and maps/deduplicates segmented WebVTT', async () => {
 const requested=[], allowed=[];
 await fixture((req,res)=>{
  requested.push(req.url);
  assert.equal(req.headers.cookie,undefined);
  if(req.url==='/list.m3u8') res.end('#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\none.vtt\n#EXTINF:3,\ntwo.vtt\n#EXT-X-ENDLIST');
  else res.end('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00:01.000 --> 00:00:02.000\nHello\n\n'+(req.url==='/two.vtt'?'00:00:04.000 --> 00:00:05.000\nNext\n':''));
 },async base=>{
  const result = await ReadSubtitles([{url:base+'/list.m3u8',language:'en',format:'hls'}], {authorize:async urls=>allowed.push(...urls)});
  assert.deepEqual(allowed,requested.map(p=>base+p));
  assert.equal(allowed.length,3);
  assert.equal((result[0].content.match(/Hello/g)||[]).length,1);
  assert.match(result[0].content,/00:00:11\.000 --> 00:00:12\.000/);
  assert.match(result[0].content,/00:00:14\.000 --> 00:00:15\.000/);
 });
});

test('permissions rejection occurs before fetch and redirect never reaches its target', async () => {
 let hits=0;
 await fixture((req,res)=>{ hits++; if(req.url==='/redirect'){res.writeHead(302,{location:'/target'});res.end();} else res.end(vtt); },async base=>{
  await assert.rejects(ReadSubtitles([{url:base+'/no'}],{authorize:async()=>{throw new Error('denied');}}),/denied/);
  assert.equal(hits,0);
  await assert.rejects(ReadSubtitles([{url:base+'/redirect'}],{authorize:async()=>{}}),{key:'subtitle_download_failed'});
  assert.equal(hits,1);
 });
});

test('malformed, encrypted, live, or oversized subtitles fail explicitly and abort propagates', async () => {
 for(const descriptor of [{text:'not subtitles'}, {text:'WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nbad'}, {text:'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:1,\na.vtt\n#EXT-X-ENDLIST',format:'hls',url:'https://example.test/subs'}, {text:'#EXTM3U\n#EXTINF:1,\na.vtt',format:'hls',url:'https://example.test/subs'}]) {
  await assert.rejects(ReadSubtitles([descriptor],{authorize:async()=>{}}), error=>['subtitle_invalid','subtitle_unsupported'].includes(error.key));
 }
 await assert.rejects(ReadSubtitles([{text:'a'.repeat(SubtitleLimits.resourceBytes+1)}]), {key:'subtitle_limit'});
 const controller = new AbortController(); controller.abort();
 await assert.rejects(ReadSubtitles([{text:vtt}],{signal:controller.signal}),{name:'AbortError'});
});

test('incomplete WebVTT header and timed TTML spans never silently discard cues', async () => {
 await assert.rejects(ReadSubtitles([{text:'WEBVTT\n00:00:01.000 --> 00:00:02.000\nMissing separator'}]),{key:'subtitle_invalid'});
 await assert.rejects(ReadSubtitles([{text:'<tt><body><p begin="1s" end="4s">A<span begin="1s">B</span></p></body></tt>',format:'ttml'}]),{key:'subtitle_unsupported'});
});

test('network concurrency is bounded and streamed response byte limits cancel reads', async () => {
 let active=0,peak=0;
 await fixture((req,res)=>{
  active++; peak=Math.max(peak,active);
  setTimeout(()=>{active--;res.end(vtt);},15);
 },async base=>{
  const tracks=await ReadSubtitles(Array.from({length:12},(_,i)=>({url:base+'/'+i,language:String(i)})),{authorize:async()=>{}});
  assert.equal(tracks.length,12);
  assert.ok(peak<=SubtitleLimits.concurrency && peak>1);
 });
 await fixture((req,res)=>{res.writeHead(200,{'content-type':'text/vtt'});res.end('a'.repeat(SubtitleLimits.resourceBytes+1));},async base=>{
  await assert.rejects(ReadSubtitles([{url:base+'/large'}],{authorize:async()=>{}}),{key:'subtitle_limit'});
 });
});

test('DASH multiple periods retain their declared presentation offset', async () => {
 const text='<MPD><Period><AdaptationSet mimeType="text/vtt" lang="en"><BaseURL>a.vtt</BaseURL></AdaptationSet></Period><Period start="PT60S"><AdaptationSet mimeType="text/vtt" lang="en"><BaseURL>b.vtt</BaseURL></AdaptationSet></Period></MPD>';
 const tracks=FindDashSubtitles(text,'https://example.test/main.mpd');
 assert.equal(tracks.length,2);
 assert.equal(tracks[0].url,'https://example.test/a.vtt');
 assert.equal(tracks[1].segments[0].url,'https://example.test/b.vtt');
 assert.equal(tracks[1].segments[0].offset,60);
});

test('static DASH duration templates expand every Number and authorize each text resource with PTO offset', async () => {
 const allowed=[];
 await fixture((req,res)=>{
  const n=Number(/(\d+)\.vtt/.exec(req.url)[1]);
  const t=10+(n-7)*2;
  res.end(`WEBVTT\n\n00:00:${String(t).padStart(2,'0')}.000 --> 00:00:${String(t+1).padStart(2,'0')}.000\nSegment ${n}\n`);
 },async base=>{
  const mpd='<MPD type="static" mediaPresentationDuration="PT9S"><Period start="PT5S" duration="PT4S"><AdaptationSet mimeType="text/vtt" lang="en"><SegmentTemplate media="sub-$RepresentationID$-$Number%03d$.vtt" timescale="10" duration="20" startNumber="7" presentationTimeOffset="100"/><Representation id="eng"/></AdaptationSet></Period></MPD>';
  const [descriptor]=FindDashSubtitles(mpd,base+'/manifest.mpd');
  assert.deepEqual(descriptor.segments.map(s=>[s.url,s.offset]),[[base+'/sub-eng-007.vtt',-5],[base+'/sub-eng-008.vtt',-5]]);
  const [track]=await ReadSubtitles([descriptor],{authorize:async urls=>allowed.push(...urls)});
  assert.deepEqual(allowed,descriptor.segments.map(s=>s.url));
  assert.match(track.content,/00:00:05\.000 --> 00:00:06\.000\nSegment 7/);
  assert.match(track.content,/00:00:07\.000 --> 00:00:08\.000\nSegment 8/);
 });
});

test('DASH timeline Time templates expand bounded repeats and TTML clocks merge on presentation timeline', async () => {
 await fixture((req,res)=>{
  const t=Number(/(\d+)\.xml/.exec(req.url)[1])/10;
  res.end(`<tt><body><p begin="${t}s" dur="1s">Caption ${t}</p></body></tt>`);
 },async base=>{
  const mpd='<MPD mediaPresentationDuration="PT10S"><Period start="PT2S" duration="PT8S"><AdaptationSet mimeType="application/ttml+xml" lang="fr"><SegmentTemplate timescale="10" presentationTimeOffset="50" media="fr-$Time$.xml"><SegmentTimeline><S t="50" d="20" r="1"/><S d="20" r="-1"/></SegmentTimeline></SegmentTemplate><Representation id="fr"/></AdaptationSet></Period></MPD>';
  const [descriptor]=FindDashSubtitles(mpd,base+'/main.mpd');
  assert.deepEqual(descriptor.segments.map(s=>s.url),[50,70,90,110].map(t=>base+`/fr-${t}.xml`));
  const [track]=await ReadSubtitles([descriptor],{authorize:async()=>{}});
  assert.match(track.content,/00:00:02\.000 --> 00:00:03\.000\nCaption 5/);
  assert.match(track.content,/00:00:08\.000 --> 00:00:09\.000\nCaption 11/);
 });
});

test('DASH SegmentList resolves inherited addressing and deduplicates repeated cues', async () => {
 await fixture((req,res)=>res.end('WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nShared\n'),async base=>{
  const mpd='<MPD><Period><AdaptationSet mimeType="text/vtt" lang="es"><BaseURL>subs/</BaseURL><SegmentList timescale="1000" presentationTimeOffset="10000"><SegmentURL media="a.vtt"/><SegmentURL media="b.vtt"/></SegmentList><Representation id="es"/></AdaptationSet></Period></MPD>';
  const [descriptor]=FindDashSubtitles(mpd,base+'/main.mpd');
  assert.deepEqual(descriptor.segments.map(s=>[s.url,s.offset]),[[base+'/subs/a.vtt',-10],[base+'/subs/b.vtt',-10]]);
  const [track]=await ReadSubtitles([descriptor],{authorize:async()=>{}});
  assert.equal((track.content.match(/Shared/g)||[]).length,1);
  assert.match(track.content,/00:00:00\.000 --> 00:00:02\.000/);
 });
});

test('DASH segmented text rejects dynamic, initialization, byte ranges, unknown bounds and excessive expansion explicitly', async () => {
 for(const [attrs,segment] of [
  ['type="dynamic"','<SegmentTemplate media="$Number$.vtt" duration="1" endNumber="2"/>'],
  ['','<SegmentTemplate media="$Number$.vtt" initialization="init" duration="1" endNumber="2"/>'],
  ['','<SegmentList><SegmentURL media="a.vtt" mediaRange="0-100"/></SegmentList>'],
  ['','<SegmentTemplate media="$Number$.vtt" duration="1"/>'],
 ]) {
  const [descriptor]=FindDashSubtitles(`<MPD ${attrs}><Period><AdaptationSet mimeType="text/vtt" lang="en">${segment}<Representation/></AdaptationSet></Period></MPD>`,'https://example.test/main.mpd');
  await assert.rejects(ReadSubtitles([descriptor]),{key:'subtitle_unsupported'});
 }
 assert.throws(()=>FindDashSubtitles(`<MPD><Period><AdaptationSet mimeType="text/vtt"><SegmentTemplate media="$Time$.vtt"><SegmentTimeline><S d="1" r="${SubtitleLimits.segments}"/></SegmentTimeline></SegmentTemplate><Representation/></AdaptationSet></Period></MPD>`,'https://example.test/main.mpd'),{key:'subtitle_limit'});
});

test('HLS timestamp rollover is unwrapped and absent maps still identify a media timeline', async () => {
 const wrap=2**33;
 await fixture((req,res)=>{
  if(req.url==='/mapped') res.end('#EXTM3U\n#EXTINF:1,\na\n#EXTINF:1,\nb\n#EXT-X-ENDLIST');
  else if(req.url==='/plain') res.end('#EXTM3U\n#EXTINF:1,\nplain.vtt\n#EXT-X-ENDLIST');
  else if(req.url==='/plain.vtt') res.end(vtt);
  else res.end(`WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:${req.url==='/a'?wrap-90000:0}\n\n00:00:00.000 --> 00:00:00.500\n${req.url}\n`);
 },async base=>{
  const [mapped,plain]=await ReadSubtitles([{url:base+'/mapped'},{url:base+'/plain'}],{authorize:async()=>{}});
  assert.equal(mapped.timeBase,'media');
  assert.equal(plain.timeBase,'media');
  assert.match(mapped.content,/26:30:43\.718 --> 26:30:44\.218/);
 });
});

test('a failed declared language aborts the operation instead of returning remaining successes', async () => {
 await fixture((req,res)=>{
  if(req.url==='/missing') {res.writeHead(404);res.end();}
  else res.end(vtt);
 },async base=>{
  await assert.rejects(ReadSubtitles([{url:base+'/en',language:'en'},{url:base+'/missing',language:'es'}],{authorize:async()=>{}}),{key:'subtitle_download_failed'});
 });
});

test('TTML frame clock and parent duration are resolved, while XML entity declarations are rejected', async () => {
 const [track]=await ReadSubtitles([{format:'ttml',text:'<tt xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25"><body><div begin="1s" dur="4s"><p begin="00:00:01:12">Frame caption</p></div></body></tt>'}]);
 assert.match(track.content,/00:00:02\.480 --> 00:00:05\.000\nFrame caption/);
 await assert.rejects(ReadSubtitles([{format:'ttml',text:'<!DOCTYPE tt [<!ENTITY caption SYSTEM "https://example.test/x">]><tt><body><p begin="0s" end="1s">&caption;</p></body></tt>'}]),{key:'subtitle_unsupported'});
});

test('DASH language inherits from Period and MPD xml:lang', () => {
 const found=FindDashSubtitles('<MPD xml:lang="en"><Period><AdaptationSet mimeType="text/vtt"><Representation><BaseURL>en.vtt</BaseURL></Representation></AdaptationSet></Period></MPD>','https://example.test/main.mpd');
 assert.equal(found[0].language,'en');
});

test('recording source clock survives conversion and malformed clocks fail explicitly', async () => {
 const recordingClock={time:123.5,sampledAt:1794098000000,rate:1};
 const [track]=await ReadSubtitles([{text:vtt,language:'en',recordingClock}]);
 assert.deepEqual(track.recordingClock,recordingClock);
 assert.match(track.content,/00:00:01\.000 --> 00:00:02\.000/);
 for(const clock of [{time:-1,sampledAt:0,rate:1},{time:0,sampledAt:NaN,rate:1},{time:0,sampledAt:1,rate:2},null]) {
  await assert.rejects(ReadSubtitles([{text:vtt,recordingClock:clock}]),{key:'subtitle_invalid'});
 }
});
