import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { ParseMediaPlaylist } from '../extension/lib/hls.js';
import { DownloadTracks } from '../extension/lib/stream-transfer.js';
import { RuntimePolicy } from '../extension/lib/runtime-policy.js';
import {setImmediate as Turn} from 'node:timers/promises';
const Address = 'https://video.test/live.m3u8';
const Playlist = (Sequence, ...Parts) => '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:' +
Sequence + '\n' + Parts.map(Part => '#EXTINF:1,\n' + Part + '\n').join('');

Test('encrypted segment bytes update transfer progress before the whole segment can be decrypted',async T=>
{
	const Plain=new Uint8Array(376);Plain[0]=Plain[188]=0x47;
	const Key=new Uint8Array(16),Iv=new Uint8Array(16);
	const Cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv:Iv},await crypto.subtle.importKey('raw',Key,'AES-CBC',false,['encrypt']),Plain));
	const Controller=new AbortController(),States=[],Target=Workspace();let Body;
	T.mock.method(globalThis,'fetch',async Url=>Url.endsWith('/key')?new Response(Key.slice()):new Response(new ReadableStream({start(C){Body=C;C.enqueue(Cipher.slice(0,32));}})));
	const Text=Playlist(0,'part.ts').replace('#EXTINF','#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x0\n#EXTINF')+'#EXT-X-ENDLIST';
	const Pending=DownloadTracks([{playlist:ParseMediaPlaylist(Text,Address)}],{workspace:Target,controller:Controller,finishSignal:new AbortController().signal,authorize:async()=>{},progress:async S=>States.push(S)});
	const Settled=Pending.then(Value=>({Value}),Error=>({Error}));
	T.after(async()=>{Controller.abort();try{Body?.error(new DOMException('test ended','AbortError'));}catch{}await Settled;});
	for(let I=0;I<10;I++)await Turn();
	Assert.ok(States.some(S=>S.received===32&&S.finished===0),'received ciphertext must be visible before the pending body finishes');
	Assert.equal(Target.files.size,0,'unvalidated ciphertext must not reach the output');
	Body.enqueue(Cipher.slice(32));Body.close();
	const Result=await Pending;
	Assert.equal(Result.progress.received,376,'final accounting includes plaintext once, with no ciphertext duplication');
	Assert.deepEqual(Target.files.get('segment-0.ts'),Plain);
});

Test('observed multi-CDN transfers start four bounded requests instead of leaving fast CDNs waiting behind two slow ones',async T=>
{
	const Requested=[],Bodies=[],Controller=new AbortController();
	T.mock.method(globalThis,'fetch',async Url=>{Requested.push(Url);return new Response(new ReadableStream({start(C){Bodies.push(C);}}));});
	const Text=Playlist(0,...['https://a.test/0.ts','https://b.test/1.ts','https://c.test/2.ts','https://d.test/3.ts','https://e.test/4.ts'])+'#EXT-X-ENDLIST';
	const Pending=DownloadTracks([{playlist:ParseMediaPlaylist(Text,Address)}],{workspace:Workspace(),controller:Controller,finishSignal:new AbortController().signal,
		observedContext:{origin:'https://player.test',referer:'https://player.test/',serverOrigin:'https://video.test'},authorize:async()=>{},progress:async()=>{}});
	const Settled=Pending.catch(E=>E);
	T.after(async()=>{Controller.abort();for(const Body of Bodies)try{Body.error(new DOMException('ended','AbortError'));}catch{}await Settled;});
	for(let I=0;I<10;I++)await Turn();
	Assert.equal(Requested.length,4,'four requests may run; the fifth must stay queued');
});
Test('live playlist HTTP 403 saves the committed prefix without aborting the output signal', async T =>
{
	const Controller = new AbortController();
	const Bytes = new Uint8Array(376);
	Bytes[0] = Bytes[188] = 0x47;
	T.mock.method(globalThis, 'fetch', async Url => Url === Address
		? new Response(null, {status: 403}) : new Response(Bytes));
	const Result = await DownloadTracks([{url: Address, playlist: ParseMediaPlaylist(Playlist(0, '0.ts'), Address)}],
		{workspace: Workspace(), controller: Controller, finishSignal: new AbortController().signal,
			authorize: async () => {}, progress: async () => {}});
	Assert.equal(Result.partial, true);
	Assert.equal(Result.progress.finished, 1);
	Assert.match(Result.video, /segment-0\.ts\n#EXT-X-ENDLIST/);
	Assert.equal(Controller.signal.aborted, false);
});

Test('running live jobs acquire DVR capability when a refreshed window provides history',async T=>
{
	const Stop=new AbortController(),Ts=new Uint8Array(376),States=[];Ts[0]=Ts[188]=0x47;
	T.mock.method(globalThis,'fetch',async U=>new Response(U===Address?Playlist(0,...Array.from({length:120},(_,I)=>I+'.ts')):Ts));
	await DownloadTracks([{url:Address,playlist:ParseMediaPlaylist(Playlist(0,'0.ts','1.ts','2.ts'),Address)}],
		{workspace:Workspace(),controller:new AbortController(),finishSignal:Stop.signal,authorize:async()=>{},progress:async S=>{States.push(S);if(S.dvr===true||S.finished>=120)Stop.abort();}});
	Assert.ok(States.some(S=>S.dvr===true),'a refreshed DVR playlist must update the registered job display');
});
Test('current live start skips DVR history once and continues every newly published segment', async T =>
{
	const Requested = [], Ts = new Uint8Array(376); Ts[0] = Ts[188] = 0x47;
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Requested.push(Url);
		return new Response(Url === Address ? Playlist(1, ...Array.from({length: 10}, (_, I) => I + 1 + '.ts')) + '#EXT-X-ENDLIST' : Ts);
	});
	const Initial = ParseMediaPlaylist(Playlist(1, ...Array.from({length: 8}, (_, I) => I + 1 + '.ts')), Address);
	const Result = await DownloadTracks([{url: Address, playlist: Initial}], {liveStart: 'current', workspace: Workspace(),
		controller: new AbortController(), finishSignal: new AbortController().signal, authorize: async () => {}, progress: async () => {}});
	Assert.deepEqual(Requested.filter(U => U !== Address).map(U => new URL(U).pathname), ['/6.ts', '/7.ts', '/8.ts', '/9.ts', '/10.ts']);
	Assert.equal(Result.progress.finished, 5);
	Assert.equal(Initial.segments.length, 8, 'source playlist is preserved');
});

Test('beginning remains the live default and current never trims finite media', async T =>
{
	const Ts = new Uint8Array(376); Ts[0] = Ts[188] = 0x47;
	for (const [Mode, Ended] of [[undefined, false], ['beginning', false], ['current', true]])
	{
		const Requested = [], Stop = new AbortController();
		T.mock.method(globalThis, 'fetch', async Url => {Requested.push(new URL(Url).pathname); return new Response(Ts);});
		await DownloadTracks([{url: Address, playlist: ParseMediaPlaylist(Playlist(1, '1.ts', '2.ts', '3.ts', '4.ts') + (Ended ? '#EXT-X-ENDLIST' : ''), Address)}],
			{liveStart: Mode, workspace: Workspace(), controller: new AbortController(), finishSignal: Stop.signal,
				authorize: async () => {}, progress: async S => {if (S.finished === 4) Stop.abort();}});
		Assert.deepEqual(Requested.sort(), ['/1.ts', '/2.ts', '/3.ts', '/4.ts']);
	}
});

Test('current start uses the same live duration for separate tracks with different sequence bases and segment sizes', async T =>
{
	const Requested = [], Stop = new AbortController(), Ts = new Uint8Array(376); Ts[0] = Ts[188] = 0x47;
	T.mock.method(globalThis, 'fetch', async Url => {Requested.push(new URL(Url).pathname); return new Response(Ts);});
	const Video = Playlist(100, ...Array.from({length: 10}, (_, I) => 'v' + I + '.ts')).replace('TARGETDURATION:1', 'TARGETDURATION:2').replaceAll('#EXTINF:1', '#EXTINF:2');
	const Audio = Playlist(700, ...Array.from({length: 20}, (_, I) => 'a' + I + '.aac'));
	await DownloadTracks([{url: Address, playlist: ParseMediaPlaylist(Video, Address)}, {url: Address, audio: true, playlist: ParseMediaPlaylist(Audio, Address)}],
		{liveStart: 'current', workspace: Workspace(), controller: new AbortController(), finishSignal: Stop.signal,
			authorize: async () => {}, progress: async S => {if (S.finished === 9) Stop.abort();}});
	Assert.deepEqual(Requested.filter(U => U.endsWith('.ts')).sort(), ['/v7.ts', '/v8.ts', '/v9.ts']);
	Assert.deepEqual(Requested.filter(U => U.endsWith('.aac')).sort(), ['/a14.aac', '/a15.aac', '/a16.aac', '/a17.aac', '/a18.aac', '/a19.aac']);
});

Test('current start preserves the initialization map of the retained tail and rejects invalid modes before requests', async T =>
{
	const Requested = [], Stop = new AbortController();
	T.mock.method(globalThis, 'fetch', async Url => {Requested.push(new URL(Url).pathname); return new Response(new Uint8Array(32));});
	const Text = Playlist(1, '1.m4s', '2.m4s', '3.m4s', '4.m4s', '5.m4s').replace('#EXTINF', '#EXT-X-MAP:URI="old-init.mp4"\n#EXTINF')
		.replace('#EXTINF:1,\n3.m4s', '#EXT-X-DISCONTINUITY\n#EXT-X-MAP:URI="tail-init.mp4"\n#EXTINF:1,\n3.m4s');
	const Sources = [{url: Address, playlist: ParseMediaPlaylist(Text, Address)}];
	const Options = {workspace: Workspace(), controller: new AbortController(), finishSignal: Stop.signal,
		authorize: async () => {}, progress: async S => {if (S.finished === 3) Stop.abort();}};
	await Assert.rejects(DownloadTracks(Sources, {...Options, liveStart: 'invalid'}), {key: 'job_invalid_request'});
	Assert.deepEqual(Requested, []);
	const Result = await DownloadTracks(Sources, {...Options, liveStart: 'current'});
	Assert.deepEqual(Requested.sort(), ['/3.m4s', '/4.m4s', '/5.m4s', '/tail-init.mp4']);
	Assert.match(Result.video, /#EXT-X-MAP:URI="init-0.mp4"/);
});
Test('finite separated audio is offered for preparation while video is still downloading',async T=>{
 let ReleaseVideo,Prepared=false;const VideoBody=new Uint8Array(376);VideoBody[0]=VideoBody[188]=0x47;
 T.mock.method(globalThis,'fetch',async Url=>Url.endsWith('video2.ts')?new Promise(R=>{ReleaseVideo=()=>R(new Response(VideoBody));}):new Response(Url.endsWith('.ts')?VideoBody:new Uint8Array([1,2,3])));
 const Target=Workspace(),End='#EXT-X-ENDLIST';
 await DownloadTracks([{url:Address,playlist:ParseMediaPlaylist(Playlist(0,'video.ts','video2.ts')+End,Address)},{url:Address,audio:true,playlist:ParseMediaPlaylist(Playlist(0,'audio.aac')+End,Address)}],{
  workspace:Target,controller:new AbortController(),finishSignal:new AbortController().signal,authorize:async()=>{},progress:async()=>{},
  audioReady:Text=>{Prepared=true;Assert.match(Text,/segment-2.aac/);Assert.ok(Target.files.has('segment-2.aac'));Assert.ok(Target.files.has('segment-0.ts'));Assert.ok(!Target.files.has('segment-1.ts'));ReleaseVideo();}
 });Assert.equal(Prepared,true);
});
Test('encrypted live refresh uses new keys at the same URI and commits only plaintext', async T =>
{
	const Plain = new Uint8Array(376);
	Plain[0] = Plain[188] = 0x47;
	const RawKeys = [crypto.getRandomValues(new Uint8Array(16)), crypto.getRandomValues(new Uint8Array(16))];
	const Cipher = await Promise.all(RawKeys.map(async (Raw, Index) =>
	{
		const Iv = new Uint8Array(16);
		Iv[15] = 20 + Index;
		return new Uint8Array(await crypto.subtle.encrypt({name: 'AES-CBC', iv: Iv}, await crypto.subtle.importKey('raw', Raw, 'AES-CBC', false, ['encrypt']), Plain));
	}));
	const EncryptedPlaylist = (Sequence, Name) => Playlist(Sequence, Name).replace('#EXTINF', '#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF');
	let KeyLoads = 0;
	const Authorizations = [];
	T.mock.method(globalThis, 'fetch', async (Url, Options) =>
	{
		Assert.equal(Options.credentials, 'omit');
		if (Url === Address)
		{
			return new Response(EncryptedPlaylist(21, 'b.ts') + '#EXT-X-ENDLIST');
		}
		if (Url.endsWith('/key'))
		{
			Assert.equal(Options.cache, 'no-store');
			return new Response(RawKeys[KeyLoads++]);
		}
		return new Response(Cipher[Url.endsWith('a.ts') ? 0 : 1]);
	});
	const Target = Workspace();
	let ReadSnapshot;
	const Result = await DownloadTracks([{url: Address, playlist: ParseMediaPlaylist(EncryptedPlaylist(20, 'a.ts'), Address)}], {
		workspace: Target, controller: new AbortController(), finishSignal: new AbortController().signal, observedContext: true,
		authorize: async Urls => Authorizations.push(Urls), progress: async () =>
		{
		}, snapshot: Read =>
		{
			ReadSnapshot = Read;
		},
	});
	Assert.equal(KeyLoads, 2);
	Assert.equal(Authorizations.filter(Urls => Urls.includes('https://video.test/key')).length, 2);
	Assert.deepEqual([...Target.files.values()], [Plain, Plain]);
	Assert.equal(Result.progress.received, Plain.length * 2);
	Assert.equal(ReadSnapshot().video.length, 2);
	Assert.doesNotMatch(Result.video, /EXT-X-KEY|\/key/);
});
Test('encrypted resources wait for host authorization and failed keys commit no media', async T =>
{
	const Parsed = ParseMediaPlaylist(Playlist(0, 'a.ts').replace('#EXTINF', '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.test/key"\n#EXTINF') + '#EXT-X-ENDLIST', Address);
	const Options = {workspace: Workspace(), controller: new AbortController(), finishSignal: new AbortController().signal, progress: async () =>
		{
		}};
	T.mock.method(globalThis, 'fetch', () => Assert.fail('unauthorized request'));
	await Assert.rejects(DownloadTracks([{playlist: Parsed}], {...Options, authorize: async Urls =>
		{
			Assert.ok(Urls.includes('https://keys.test/key'));
			throw new Error('access denied');
		}}), /access denied/);
	T.mock.method(globalThis, 'fetch', async Url => new Response(Url.startsWith('https://keys.test') ? new Uint8Array(15) : new Uint8Array(16)));
	const Target = Workspace();
	await Assert.rejects(DownloadTracks([{playlist: Parsed}], {...Options, workspace: Target, authorize: async () =>
		{
		}}), {key: 'stream_hls_invalid_key'});
	Assert.equal(Target.files.size, 0);
});
function Workspace()
{
	const Files = new Map();
	return { files: Files, async getFileHandle(Path)
		{
			return { async getFile(){return new Blob([Files.get(Path)||new Uint8Array()]);}, async createWritable()
				{
					let Content = new Uint8Array();
					return {
						async write(Bytes)
						{
							const Next = new Uint8Array(Content.length + Bytes.length);
							Next.set(Content);
							Next.set(Bytes, Content.length);
							Content = Next;
							Files.set(Path, Content);
						},
						async close()
						{
						},
						async abort()
						{
							Files.delete(Path);
						},
					};
				} };
		} };
}

Test('stop/save bounds the drain of a trickling segment and preserves only closed contiguous files', async T =>
{
	T.mock.timers.enable({apis: ['setTimeout']});
	const Stop = new AbortController(), Controller = new AbortController(), Target = Workspace();
	const Ts = new Uint8Array(376); Ts[0] = Ts[188] = 0x47;
	const Requested = [], Bodies = [];
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Requested.push(Url);
		if (Url.endsWith('/0.ts')) return new Response(Ts);
		return new Response(new ReadableStream({start(Body) { Bodies.push(Body); Body.enqueue(Ts); }}));
	});
	const Pending = DownloadTracks([{playlist: ParseMediaPlaylist(Playlist(0, '0.ts', '1.ts', '2.ts', '3.ts', '4.ts') + '#EXT-X-ENDLIST', Address)}], {
		workspace: Target, controller: Controller, finishSignal: Stop.signal, authorize: async () => {},
		progress: async State => { if (State.finished) Stop.abort(); },
	});
	let Settled;
	const Observed = Pending.then(Value => { Settled = {Value}; }, Error => { Settled = {Error}; });
	T.after(async () => { for (const Body of Bodies) { try { Body.close(); } catch {} } await Observed; });
	for (let I = 0; I < 10; I++) await Turn();
	Assert.equal(Stop.signal.aborted, true);
	Assert.equal(Settled, undefined, 'allow in-flight segments a short grace period');
	T.mock.timers.tick(2000);
	for (const Body of Bodies) Body.enqueue(Ts);
	for (let I = 0; I < 5; I++) await Turn();
	T.mock.timers.tick(3001);
	for (let I = 0; I < 10; I++) await Turn();
	Assert.ok(Settled, 'stop/save must finish draining within five seconds even while bytes keep arriving');
	Assert.equal(Settled.Error, undefined);
	Assert.equal(Controller.signal.aborted, false, 'output mux/save must retain its live cancellation signal');
	Assert.equal(Settled.Value.partial, true);
	Assert.equal(Settled.Value.progress.finished, 1);
	Assert.equal(Settled.Value.progress.received, Ts.length);
	Assert.equal(Target.files.size, 1, 'unfinished writers must roll back before output starts');
	Assert.doesNotMatch(Settled.Value.video, /segment-[1-4]\.ts/);
	Assert.equal(Requested.length, 4, 'queued fifth segment must never start');
	Assert.equal(RuntimePolicy.Transfer.FinishGraceMs, 5000);
});

Test('stop/save seals a finite stream prefix without requesting the rest or canceling the output signal', async T =>
{
	const Stop = new AbortController();
	const Controller = new AbortController();
	const Ts = new Uint8Array(376);
	Ts[0] = Ts[188] = 0x47;
	const Requested = [];
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Requested.push(Url);
		return new Response(Ts);
	});
	const Target = Workspace();
	const Parsed = ParseMediaPlaylist(Playlist(0, ...Array.from({length: 20}, (_, Index) => Index + '.ts')) + '#EXT-X-ENDLIST', Address);
	const Result = await DownloadTracks([{playlist: Parsed}], {
		workspace: Target, controller: Controller, finishSignal: Stop.signal, authorize: async () =>
		{
		}, progress: async State =>
		{
			if (State.finished > 0)
			{
				Stop.abort();
			}
		},
	});
	Assert.equal(Controller.signal.aborted, false);
	Assert.equal(Result.partial, true);
	Assert.ok(Requested.length <= 4);
	Assert.equal(Result.progress.finished, Requested.length);
	Assert.equal(Result.progress.count, Requested.length);
	Assert.equal(Result.progress.received, Requested.length * Ts.length);
	Assert.equal(Target.files.size, Requested.length);
	Assert.match(Result.video, /#EXT-X-ENDLIST\n$/);
});
Test('separate audio starts alongside video so stop/save can keep a playable paired prefix', async T =>
{
	const Stop = new AbortController();
	const Requested = [];
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Requested.push(new URL(Url).pathname);
		return new Response(new Uint8Array(32));
	});
	const Sources = ['video', 'audio'].map((Name, Index) => ({audio: Index === 1,
		playlist: ParseMediaPlaylist(Playlist(0, ...Array.from({length: 20}, (_, Number) => Name + Number + '.m4s')).replace('#EXTINF', '#EXT-X-MAP:URI="' + Name + '-init.mp4"\n#EXTINF') + '#EXT-X-ENDLIST', Address)}));
	const Result = await DownloadTracks(Sources, {workspace: Workspace(), controller: new AbortController(), finishSignal: Stop.signal,
		authorize: async () =>
		{
		}, snapshot: () =>
		{
		}, progress: async State =>
		{
			if (State.snapshotAvailable)
			{
				Stop.abort();
			}
		}});
	Assert.ok(Requested.indexOf('/audio0.m4s') < Requested.indexOf('/video4.m4s') || !Requested.includes('/video4.m4s'));
	Assert.ok(Result.progress.finished < 40);
	Assert.equal(Result.partial, true);
	Assert.match(Result.video, /segment-0\.m4s/);
	Assert.match(Result.audio, /segment-20\.m4s/);
});
Test('stop/save excludes completed later segments beyond a gap and never retries the unfinished segment', async T =>
{
	const Stop = new AbortController();
	const Controller = new AbortController();
	const Gap = Promise.withResolvers();
	const Ts = new Uint8Array(376);
	Ts[0] = Ts[188] = 0x47;
	let Attempts = 0;
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		if (Url.endsWith('/1.ts'))
		{
			Attempts++;
			await Gap.promise;
			throw new TypeError('network');
		}
		return new Response(Ts);
	});
	const Parsed = ParseMediaPlaylist(Playlist(0, '0.ts', '1.ts', '2.ts', '3.ts', '4.ts') + '#EXT-X-ENDLIST', Address);
	const Result = await DownloadTracks([{playlist: Parsed}], {workspace: Workspace(), controller: Controller, finishSignal: Stop.signal,
		authorize: async () =>
		{
		}, progress: async State =>
		{
			if (State.finished > 0)
			{
				Stop.abort();
				Gap.resolve();
			}
		}});
	Assert.equal(Attempts, 1);
	Assert.equal(Controller.signal.aborted, false);
	Assert.equal(Result.progress.finished, 1);
	Assert.equal(Result.progress.received, Ts.length);
	Assert.match(Result.video, /segment-0\.ts/);
	Assert.doesNotMatch(Result.video, /segment-[1-4]\.ts/);
});
Test('stop/save waits until short audio segments cover the first long video segment', async T =>
{
	const Stop = new AbortController();
	T.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(32)));
	const Sources = ['video', 'audio'].map((Name, Index) =>
	{
		let Text = Playlist(0, ...Array.from({length: 20}, (_, Number) => Name + Number + '.m4s'));
		if (Index === 0)
		{
			Text = Text.replaceAll('#EXTINF:1,', '#EXTINF:10,');
		}
		return {audio: Index === 1, playlist: ParseMediaPlaylist(Text.replace('#EXTINF', '#EXT-X-MAP:URI="' + Name + '-init.mp4"\n#EXTINF') + '#EXT-X-ENDLIST', Address)};
	});
	let Read;
	const Result = await DownloadTracks(Sources, {workspace: Workspace(), controller: new AbortController(), finishSignal: Stop.signal,
		authorize: async () =>
		{
		}, snapshot: Value =>
		{
			Read = Value;
		}, progress: async State =>
		{
			if (State.snapshotAvailable)
			{
				Assert.ok(Read(), 'enabled stop/save must have a usable common prefix');
				Stop.abort();
			}
		}});
	Assert.equal(Result.partial, true);
	Assert.ok(Result.progress.finished > 10);
	Assert.match(Result.video, /segment-0\.m4s/);
	Assert.match(Result.audio, /segment-20\.m4s/);
});
Test('records new live sequences once and seals a finite playlist on stop', async T =>
{
	const Requests = [];
	const Stop = new AbortController();
	const Ts = new Uint8Array(376);
	Ts[0] = Ts[188] = 0x47;
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Requests.push(new URL(Url).pathname);
		if (Url === Address)
		{
			return new Response(Playlist(10, 'a.ts', 'b.ts'));
		}
		return new Response(new ReadableStream({
			start(Stream)
			{
				// 앞 패킷 일부가 남은 청크 안에 두 번째 패킷의 동기 바이트가 오도록 구성합니다.
				Stream.enqueue(Ts.subarray(0, 100));
				Stream.enqueue(Ts.subarray(100));
				Stream.close();
			},
		}));
	});
	const Target = Workspace();
	const Result = await DownloadTracks([{ url: Address, playlist: ParseMediaPlaylist(Playlist(10, 'a.ts'), Address) }], {
		workspace: Target, controller: new AbortController(), finishSignal: Stop.signal,
		async authorize()
		{
		},
		async progress({ finished: Finished })
		{
			if (Finished === 2)
			{
				Stop.abort();
			}
		},
	});
	Assert.deepEqual(Requests, ['/a.ts', '/live.m3u8', '/b.ts']);
	Assert.equal(Target.files.size, 2);
	Assert.match(Result.video, /segment-0\.ts\n#EXTINF:1,\nsegment-1\.ts\n#EXT-X-ENDLIST\n$/);
	Assert.deepEqual(Result.progress, { live: false, count: 2, received: 752, finished: 2 });
});
Test('reports partial segment bytes without advancing the finished segment count', async T =>
{
	let Now = 0;
	T.mock.method(performance, 'now', () => Now);
	const Packet = new Uint8Array(188);
	Packet[0] = 0x47;
	T.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
		start(Stream)
		{
			Stream.enqueue(Packet);
			Stream.enqueue(Packet);
			Stream.close();
		},
	})));
	const Target = { async getFileHandle()
		{
			return { async getFile(){return new Blob([Packet,Packet]);}, async createWritable()
				{
					return { async write()
						{
							Now += 800;
						}, async close()
						{
						}, async abort()
						{
						} };
				} };
		} };
	const Progress = [];
	const List = ParseMediaPlaylist(Playlist(0, 'a.ts') + '#EXT-X-ENDLIST\n', Address);
	const Result = await DownloadTracks([{ playlist: List }], {
		workspace: Target, controller: new AbortController(), finishSignal: new AbortController().signal,
		async authorize()
		{
		}, async progress(Snapshot)
		{
			Progress.push(Snapshot);
		},
	});
	Assert.ok(Progress.some(Snapshot => Snapshot.received === 188 && Snapshot.finished === 0));
	Assert.deepEqual(Result.progress, { live: false, count: 1, received: 376, finished: 1 });
});
Test('saves ranged initialization once and resolves each media range separately', async T =>
{
	const RequestedRanges = [];
	const Previews = [];
	T.mock.method(globalThis, 'fetch', async (_url, Options) =>
	{
		const Range = Options.headers.Range;
		RequestedRanges.push(Range);
		return new Response(new Uint8Array(2), { status: 206,
			headers: { 'Content-Range': Range.replace('=', ' ') + '/6' } });
	});
	const Url = new URL('combined.mp4', Address).href;
	const Init = { url: Url, range: { start: 0, end: 1 } };
	const Target = Workspace();
	const Result = await DownloadTracks([{ playlist: { ended: true, segments: [
					{ url: Url, init: Init, range: { start: 2, end: 3 }, sequence: 0, duration: 1 },
					{ url: Url, init: Init, range: { start: 4, end: 5 }, sequence: 1, duration: 1 },
				] } }], {
		workspace: Target, controller: new AbortController(), finishSignal: new AbortController().signal,
		async authorize()
		{
		}, async progress()
		{
		},
		preview(Sample)
		{
			Assert.ok(Target.files.has('init-0.mp4'));
			Assert.ok(Target.files.has('segment-0.m4s'));
			Previews.push(Sample);
		},
	});
	Assert.deepEqual(RequestedRanges.sort(), ['bytes=0-1', 'bytes=2-3', 'bytes=4-5']);
	Assert.deepEqual([...Target.files.keys()].sort(), ['init-0.mp4', 'segment-0.m4s', 'segment-1.m4s']);
	Assert.equal(Result.video.match(/#EXT-X-MAP:/g).length, 1);
	Assert.equal(Result.progress.finished, 2);
	Assert.equal(Previews.length, 1);
	Assert.match(Previews[0], /#EXT-X-MAP:URI="init-0\.mp4"\n#EXTINF:1,\nsegment-0\.m4s\n#EXT-X-ENDLIST/);
});
Test('writes each completed LL-HLS group once by concatenating its actual parts', async T =>
{
	const Requests = [];
	const Stop = new AbortController();
	const Text = Sequence => '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:5\n#EXT-X-MAP:URI="init.mp4"\n' +
	Array.from({ length: Sequence }, (_, I) => '#EXT-X-PART:DURATION=0.5,URI="a' + I + '.mp4"\n' +
	'#EXT-X-PART:DURATION=0.5,URI="b' + I + '.mp4"\n#EXTINF:1,\nwhole.mp4\n').join('');
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Requests.push(new URL(Url).pathname);
		return new Response(Url === Address ? Text(2) : new Uint8Array([1, 2]));
	});
	const Target = Workspace();
	const Result = await DownloadTracks([{ url: Address, playlist: ParseMediaPlaylist(Text(1), Address) }], {
		workspace: Target, controller: new AbortController(), finishSignal: Stop.signal,
		async authorize()
		{
		}, async progress({ finished: Finished })
		{
			if (Finished === 2)
			{
				Stop.abort();
			}
		},
	});
	Assert.deepEqual(Requests, ['/init.mp4', '/a0.mp4', '/b0.mp4', '/live.m3u8', '/a1.mp4', '/b1.mp4']);
	Assert.equal(Result.progress.finished, 2);
	Assert.equal(Target.files.get('segment-0.m4s').byteLength, 4);
});
