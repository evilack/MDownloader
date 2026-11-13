import Assert from 'node:assert/strict';
import { test as Test } from 'node:test';
import { CandidatePreviews, CaptureCandidatePreview, ClearScan, FindMedia, PreviewCandidate, ResolveCandidate, Scan } from '../extension/detection.js';
import { CollectPlayerPreviews } from '../extension/lib/player-previews.js';
import { ReadPagePreviewResource } from '../extension/lib/page-preview.js';
import { HlsReloadParameters } from '../extension/lib/media.js';
Test('YouTube capture passes a page-bound player hint only after current document validation',async T=>{
	const Page='https://www.youtube.com/watch?v=FACJInvEmY8',Saved={scanId:'scan',documentId:'doc',page:Page,candidates:[{id:0,url:Page,format:'YOUTUBE',supported:true}]};let Capture;
	globalThis.chrome={storage:{session:{get:async Key=>({[Key]:Saved})}},scripting:{executeScript:async({func,args})=>{if(func===CollectPlayerPreviews){Capture=args;return[{documentId:'doc',result:'data:video/webm;base64,clip'}];}return[{documentId:'doc',result:{page:Page,active:true}}];}}};T.after(()=>delete globalThis.chrome);
	Assert.equal(await CaptureCandidatePreview({tabId:7,scanId:'scan',candidateId:0}),'data:video/webm;base64,clip');Assert.equal(Capture[0][0].pagePlayer,true);Assert.equal(Capture[2],Page);Assert.equal(Capture[3].format,'YOUTUBE');
	Saved.candidates[0].url='https://www.youtube.com/watch?v=-XHx839rSc8';await Assert.rejects(CaptureCandidatePreview({tabId:7,scanId:'scan',candidateId:0}),{key:'candidate_changed'});
});
Test('document-bound opaque previews never borrow a different frame or ambiguous visible player',async T=>{
	const Page='https://www.youtube.com/watch?v=FACJInvEmY8';let Attempts=0;
	const Player={currentSrc:'blob:https://www.youtube.com/player',currentTime:5,paused:false,ended:false,videoWidth:640,videoHeight:360,readyState:4,querySelectorAll:()=>[],getBoundingClientRect:()=>({width:640,height:360}),requestVideoFrameCallback:()=>1,cancelVideoFrameCallback(){},captureStream(){Assert.fail('must not capture primary tracks');},
		ownerDocument:{createElement:()=>({getContext:()=>({drawImage(){}}),captureStream(){Attempts++;throw Error('capture boundary');}})}};
	let Players=[Player];globalThis.HTMLMediaElement={HAVE_CURRENT_DATA:2};globalThis.location={href:Page};globalThis.window={document:{querySelectorAll:()=>Players},location:globalThis.location,performance:{getEntriesByType:()=>[],getEntriesByName:()=>[]},length:0};T.after(()=>{for(const k of['window','location','HTMLMediaElement'])delete globalThis[k];});
	const Candidate=[{id:0,url:Page,pagePlayer:true}],Options={format:'YOUTUBE'};
	await CollectPlayerPreviews(Candidate,{},Page,Options);Assert.equal(Attempts,1);
	Players=[Player,{...Player,currentSrc:'blob:https://www.youtube.com/other'}];await CollectPlayerPreviews(Candidate,{},Page,Options);Assert.equal(Attempts,1);
	Players=[Player];await CollectPlayerPreviews(Candidate,{},Page+'&different=1',Options);Assert.equal(Attempts,1);
	await CollectPlayerPreviews([{id:0,url:Page}],{},Page,Options);Assert.equal(Attempts,1);
	Players=[];window.length=1;window.frames=[{...window,document:{querySelectorAll:()=>[Player]},length:0}];await CollectPlayerPreviews(Candidate,{},Page,Options);Assert.equal(Attempts,1,'a child player is not the validated top-level page player');
});
Test('recording rejects even transient page/source/object/owner/ambiguity changes and stops only canvas tracks',async T=>{
	const Page='https://www.youtube.com/watch?v=FACJInvEmY8';let OwnStops=0,RecorderStops=0,Frame;
	const Owner={page:Page},Player={currentSrc:'blob:https://www.youtube.com/source',srcObject:undefined,currentTime:5,paused:false,ended:false,readyState:4,videoWidth:640,videoHeight:360,isConnected:true,
		querySelectorAll:()=>[],getBoundingClientRect:()=>({width:640,height:360}),requestVideoFrameCallback:Callback=>(Frame=Callback,1),cancelVideoFrameCallback(){},captureStream(){Assert.fail('primary stream must not be captured');}};
	const Track={muted:false,readyState:'live',stop(){OwnStops++;}};let Players=[Player],Mutate,Restore;
	Player.ownerDocument={createElement:()=>({getContext:()=>({drawImage(){}}),captureStream:()=>({getVideoTracks:()=>[Track],getTracks:()=>[Track]})})};
	globalThis.location={href:Page};globalThis.HTMLMediaElement={HAVE_CURRENT_DATA:2};globalThis.window={location,document:{querySelectorAll:()=>Players},performance:{getEntriesByType:()=>[],getEntriesByName:()=>[]},MDownloaderMediaPage:{players:new Map([[Player,Owner]])},length:0};
	globalThis.MediaStream=class{};globalThis.MediaRecorder=class extends EventTarget{
		state='inactive';start(){this.state='recording';queueMicrotask(()=>{Mutate();Frame();Restore();});}
		stop(){if(this.state==='inactive')return;this.state='inactive';RecorderStops++;queueMicrotask(()=>{Player.currentTime++;this.dispatchEvent(Object.assign(new Event('dataavailable'),{data:new Blob(['fixture frame'])}));this.dispatchEvent(new Event('stop'));});}
	};globalThis.FileReader=class{readAsDataURL(){this.result='data:video/webm;base64,fixture';queueMicrotask(()=>this.onload());}};
	T.after(()=>{for(const Key of['window','location','HTMLMediaElement','MediaStream','MediaRecorder','FileReader'])delete globalThis[Key];});
	const Cases=[
		[()=>location.href=Page+'&changed=1',()=>location.href=Page],
		[()=>Player.currentSrc='blob:https://www.youtube.com/changed',()=>Player.currentSrc='blob:https://www.youtube.com/source'],
		[()=>Player.srcObject={},()=>Player.srcObject=undefined],
		[()=>Owner.page=Page+'&changed=1',()=>Owner.page=Page],
		[()=>Players=[Player,{...Player}],()=>Players=[Player]],
	];
	for([Mutate,Restore]of Cases)Assert.equal(await CollectPlayerPreviews([{id:0,url:Page,pagePlayer:true}],{maxWidth:480,maxHeight:270},Page,{durationMs:10,timeoutMs:100,maxBytes:1024,format:'YOUTUBE'}),null);
	Assert.equal(OwnStops,Cases.length);Assert.equal(RecorderStops,Cases.length);
});
Test('resolves the current page title together with standard media session broadcast metadata', async T =>
{
	const Page = 'https://player.test/channel';
	const Saved = { scanId: 'scan', documentId: 'top', page: Page,
		candidates: [{ id: 0, supported: true, url: 'https://cdn.test/clip.mp4', name: 'clip.mp4' },
			{ id: 1, supported: true, url: 'https://cdn.test/unrelated.mp4', name: 'unrelated.mp4' }] };
	globalThis.document = { title: 'Channel - Player', visibilityState: 'visible' };
	const Metadata = { title: 'Tonight’s broadcast' };
	const Players = [{ currentSrc: 'https://cdn.test/clip.mp4', paused: false, ended: false, readyState: 2, closest: () => null }];
	globalThis.window = { document: { querySelectorAll: () => Players }, navigator: { mediaSession: { metadata: Metadata } }, length: 0 };
	globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 };
	globalThis.chrome = {
		storage: { session: { get: async Key => ({ [Key]: Key.startsWith('scan:') ? Saved : [] }) } },
		scripting: { executeScript: async ({ func: Func, args: Args = [] }) => [{ documentId: 'top', result: Func(...Args) }] },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
		delete globalThis.document;
		delete globalThis.location;
		delete globalThis.window;
		delete globalThis.HTMLMediaElement;
	});
	globalThis.location = { href: Page };
	Assert.equal((await ResolveCandidate(7, 'scan', 0)).pageTitle, 'Channel - Player_Tonight’s broadcast');
	Assert.equal((await ResolveCandidate(7, 'scan', 1)).pageTitle, 'Channel - Player', 'unrelated media must not inherit the active broadcast title');
	Players.push({ ...Players[0], currentSrc: 'https://cdn.test/another.mp4' });
	Assert.equal((await ResolveCandidate(7, 'scan', 0)).pageTitle, 'Channel - Player', 'ambiguous document-wide metadata is omitted');
	Players.pop();
	Metadata.title = 'Channel - Player';
	Assert.equal((await ResolveCandidate(7, 'scan', 0)).pageTitle, 'Channel - Player');
	Metadata.title = '';
	Assert.equal((await ResolveCandidate(7, 'scan', 0)).pageTitle, 'Channel - Player');
});
Test('keeps the popup and side panel scans usable independently in the same tab', async T =>
{
	const Page = 'https://example.test/watch';
	const TabId = 7;
	const Saved = {};
	let Source = 'https://example.test/popup.mp4';
	globalThis.chrome = {
		storage: { session: {
				async get(Key)
				{
					return { [Key]: Saved[Key] };
				},
				async set(Values)
				{
					Object.assign(Saved, Values);
				},
				async remove(Keys)
				{
					for (const Key of Keys)
					{
						delete Saved[Key];
					}
				},
			} },
		scripting: { executeScript: async ({ target: Target }) => Target.documentIds
			? [{ result: { page: Page, active: true } }]
			: [{ documentId: 'top', result: { page: Page, sources: [Source], playlists: [] } }] },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Popup = await Scan(TabId);
	Source = 'https://example.test/panel.mp4';
	const Panel = await Scan(TabId, 'sidepanel');
	Assert.equal((await ResolveCandidate(TabId, Popup.scanId, 0)).name, 'popup.mp4');
	Assert.equal((await ResolveCandidate(TabId, Panel.scanId, 0, 'sidepanel')).name, 'panel.mp4');
	await Assert.rejects(ResolveCandidate(TabId, Panel.scanId, 0), /candidate_changed/);
	await ClearScan(TabId);
	Assert.deepEqual(Saved, {});
});
Test('an empty scan reports ungranted player and CDN origins without requesting unrelated frames', async T =>
{
	const Page = 'https://watch.test/video';
	const Player = 'https://player.test/embed';
	const Cdn = 'https://cdn.test';
	const State = {};
	const Allowed = new Set(['https://watch.test/*', 'https://player.test/*']);
	globalThis.chrome = {
		permissions: { contains: async ({origins}) => origins.every(Origin => Allowed.has(Origin)) },
		storage: {session: {get: async Key => ({[Key]: State[Key]}), set: async Data => Object.assign(State, Data)}},
		scripting: {executeScript: async ({target}) => {
			if (target.allFrames) return [
				{frameId: 0, result: {page: Page, mediaOrigins: []}},
				...(Allowed.has('https://player.test/*') ? [{frameId: 1, result: {page: Player, mediaOrigins: [Cdn]}}] : []),
				{frameId: 2, result: {page: 'https://ads.test/frame', mediaOrigins: ['https://ad-cdn.test']}},
			];
			if (target.documentIds) return [{result: {page: Page, active: true}}];
			return [{documentId:'doc', result:{page: Page, sources: [], playlists: [], observerReady: true, playerFrames: [Player]}}];
		}},
	};
	T.after(() => delete globalThis.chrome);
	Assert.deepEqual((await Scan(7)).missingOrigins, ['https://cdn.test/*']);
	Allowed.delete('https://player.test/*');
	Assert.deepEqual((await Scan(7)).missingOrigins, ['https://player.test/*']);
	Allowed.add('https://player.test/*').add('https://cdn.test/*');
	Assert.equal((await Scan(7)).missingOrigins, undefined);
});
Test('reports missing persistent site access even when a WebRTC video was detected', async T =>
{
	const Page = 'https://player.test/live';
	const State = {};
	let Allowed = false;
	globalThis.chrome = {
		permissions: {contains: async () => Allowed},
		storage: {session: {get: async Key => ({[Key]: State[Key]}), set: async Data => Object.assign(State, Data)}},
		scripting: {executeScript: async ({target, func}) => {
			if (func.name === 'WebRtcPageTask') return [{documentId: 'doc', result: {page: Page,
				mimeType: 'video/mp4', streams: [{trackId: 'track', width: 1280, height: 720}]}}];
			if (target.documentIds) return [{result: {page: Page, active: true}}];
			return [{documentId: 'doc', result: {page: Page, sources: [], playlists: [], observerReady: true, liveStream: true}}];
		}},
	};
	T.after(() => delete globalThis.chrome);
	const Restricted = await Scan(7);
	Assert.equal(Restricted.candidates[0].format, 'WEBRTC');
	Assert.deepEqual(Restricted.missingOrigins, ['https://player.test/*']);
	Assert.equal(Restricted.candidates[0].sitePermission, 'https://player.test/*');
	Allowed = true;
	const Granted = await Scan(7);
	Assert.equal(Granted.candidates[0].sitePermission, undefined);
	Assert.equal(Granted.missingOrigins, undefined);
});
Test('shows one HLS master while keeping its qualities and unrelated media available', async T =>
{
	const Page = 'https://player.test/watch';
	const Master = 'https://cdn.test/playlist.m3u8';
	const Variant = 'https://cdn.test/480p/video.m3u8';
	const Separate = 'https://cdn.test/other/video.m3u8';
	const Observed = [Master, Variant, Separate].map(Url => ({
		url: Url, name: Url.split('/').at(-1), format: 'M3U8', supported: true,
		documentId: 'doc', initiator: 'https://player.test',
	}));
	Observed[0].variants = [Variant];
	Observed[0].qualities = [{ url: Variant, bandwidth: 1200000, resolution: '854x480' }];
	Observed[1].live = true;
	globalThis.chrome = {
		permissions: { contains: async () => true },
		storage: { session: { get: async Key => ({ [Key]: Key === 'network:7' ? Observed : [] }) } },
		scripting: { executeScript: async () => [{ documentId: 'doc', result: {
						page: Page, sources: [], timeOrigin: 100, playlists: [[Variant, 100], [Master, 100]], observerReady: true,
					} }] },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Result = await FindMedia(7);
	Assert.deepEqual(Result.items.map(Item => Item.url), [Master, Separate]);
	Assert.deepEqual(Result.items[0].qualities, Observed[0].qualities);
	Assert.equal(Result.observed.length, 3, 'hidden variants remain available to the transfer resolver');
	Assert.equal(Result.items[0].live, true, 'the visible master inherits the observed media playlist live state');
	Observed[1].live = false;
	Assert.equal((await FindMedia(7)).items[0].live, false, 'a completed playlist removes the live indication');
	Assert.equal(Result.items[1].live, undefined, 'an unknown stream must not be guessed to be live');
});
Test('requests thumbnails only for supported items in the current scan, one batch per document', async T =>
{
	const Page = 'https://example.test/watch';
	const scan = {
		scanId: 'scan', documentId: 'top', page: Page,
		candidates: [
			{ id: 0, supported: true, format: 'MP4', url: 'https://example.test/first.mp4' },
			{ id: 1, supported: true, format: 'M3U8', url: 'https://example.test/index.m3u8' },
			{ id: 2, supported: false, url: 'https://example.test/other' },
			{ id: 3, supported: true, url: 'https://example.test/remaining.mp4' },
		],
	};
	const Calls = [];
	globalThis.chrome = {
		storage: { session: { get: async Key => ({ [Key]: scan }) } },
		scripting: { executeScript: async ({ target: Target, args: Args }) =>
			{
				Assert.deepEqual(Target, { tabId: 7, documentIds: ['top'] });
				if (!Args)
				{
					return [{ result: { page: Page, active: true } }];
				}
				Calls.push(Args[0]);
				return [{ result: Args[0].map(({ id: Id }) => ({ id: Id, duration: 79 })) }];
			} },
	};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	Assert.deepEqual(await CandidatePreviews({ tabId: 7, scanId: 'stale', candidateIds: [0] }), []);
	const Result = await CandidatePreviews({ tabId: 7, scanId: 'scan', candidateIds: [1, 0, 1, 2] });
	Assert.deepEqual(Result, [{ id: 0, duration: 79 }, { id: 1, duration: 79 }]);
	Assert.deepEqual(Calls, [[
			{ id: 0, url: 'https://example.test/first.mp4', singleStream: false },
			{ id: 1, url: 'https://example.test/index.m3u8', singleStream: true },
		]]);
	scan.candidates.push({ id: 4, supported: true, format: 'M3U8', url: 'https://example.test/other.m3u8' });
	await CandidatePreviews({ tabId: 7, scanId: 'scan', candidateIds: [1] });
	Assert.equal(Calls.at(-1)[0].singleStream, false, 'an offscreen stream still makes the document ambiguous');
});
Test('validates the parent scan while binding protected previews to the actual iframe URL', async T =>
{
	const Parent = 'https://site.test/watch', Child = 'https://player.test/frame', Url = 'https://cdn.test/live.m3u8';
	const Context = {origin: 'https://player.test', referer: Child, serverOrigin: 'https://cdn.test'};
	const scan = {scanId: 'scan', documentId: 'parent', page: Parent, candidates: [{id: 0, supported: true, url: Url, format: 'M3U8',
				frameId: 3, parentDocumentId: 'parent', documentId: 'child', initiator: Context.origin, requestContext: Context}]};
	let PreviewPage;
	globalThis.chrome = {permissions: {contains: async() => true}, storage: {session: {get: async Key => ({[Key]: Key === 'scan:7' ? scan: []})}},
		scripting: {executeScript: async({target: Target, args: Args}) =>
			{
				if (Target.frameIds)
				{
					return [{documentId: 'child'}];
				}
				if (Target.documentIds[0] === 'parent')
				{
					return [{result: {page: Parent, active: true}}];
				}
				if (!Args)
				{
					return [{documentId: 'child', result: Child}];
				}
				PreviewPage = Args[2];
				return [{documentId: 'child', result: [{id: 0, still: 'frame.jpg'}]}];
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Result = await PreviewCandidate({tabId: 7, scanId: 'scan', candidateId: 0});
	Assert.equal(PreviewPage, Child);
	Assert.equal(Result.pageStream.page, Child);
	Assert.equal(Result.still, 'frame.jpg');
});
Test('uses a poster at the start and avoids assigning it to an unrelated playlist', T =>
{
	const DirectUrl = 'https://example.test/clip.mp4';
	const PlaylistUrl = 'https://example.test/index.m3u8';
	const Poster = 'https://example.test/poster.jpg';
	const Player = { currentSrc: DirectUrl, currentTime: 0, duration: 79, poster: Poster };
	globalThis.window = {
		document: { querySelectorAll: () => [Player] },
		performance: { getEntriesByName: () => [{}], getEntriesByType: () => [{name: PlaylistUrl, initiatorType: 'fetch', responseStatus: 200}] },
		length: 0,
	};
	T.after(() =>
	{
		delete globalThis.window;
	});
	Assert.deepEqual(CollectPlayerPreviews([{ id: 0, url: DirectUrl }, { id: 1, url: PlaylistUrl }], {}), [
		{ id: 0, still: Poster, duration: 79 },
	]);
	Player.currentSrc = 'blob:https://example.test/player';
	Assert.deepEqual(CollectPlayerPreviews([{ id: 1, url: PlaylistUrl }], {}), [{ id: 1, still: Poster, duration: 79 }]);
});
Test('does not reuse the current player thumbnail for an older playlist in resource timings', T =>
{
	const Old = 'https://cdn.test/a.m3u8', Current = 'https://cdn.test/b.m3u8';
	const Entries = [Old, Current].map(Name => ({name: Name, initiatorType: 'fetch', responseStatus: 200}));
	const Player = {currentSrc: 'blob:https://page.test/player', currentTime: 0, duration: 79, poster: 'https://page.test/b.jpg'};
	globalThis.window = {document: {querySelectorAll: () => [Player]}, length: 0,
		performance: {getEntriesByName: Url => Entries.filter(Entry => Entry.name === Url), getEntriesByType: () => Entries}};
	T.after(() =>
	{
		delete globalThis.window;
	});
	Assert.deepEqual(CollectPlayerPreviews([{id: 0, url: Old}, {id: 1, url: Current}], {}), [
		{id: 1, still: Player.poster, duration: 79},
	]);
});
Test('captures only the current blob-backed stream when older playlist timings remain', async T =>
{
	const Old = 'https://cdn.test/2000kb/hls/index.m3u8?token=old';
	const Current = 'https://cdn.test/2000kb/hls/index.m3u8?token=new';
	const Entries = [
		{ name: Old, responseStatus: 200, initiatorType: 'fetch' },
		{ name: Current, responseStatus: 0, initiatorType: 'fetch' },
	];
	let Attempts = 0;
	const Player = {
		currentSrc: 'blob:https://example.test/player',
		currentTime: 5, paused: false, ended: false, videoWidth: 640, videoHeight: 360,
		captureStream()
		{
			Assert.fail('The original player stream must not be captured');
		},
		requestVideoFrameCallback: () => 1, cancelVideoFrameCallback()
		{
		},
		ownerDocument: { createElement: () => ({
				getContext: () => ({ drawImage()
					{
					} }),
				captureStream()
				{
					Attempts++;
					throw new Error('Stop at the canvas capture boundary');
				},
			}) },
	};
	globalThis.window = {
		document: { querySelectorAll: () => [Player] },
		performance: { getEntriesByName: Name => Entries.filter(Entry => Entry.name === Name), getEntriesByType: () => Entries },
		length: 0,
	};
	T.after(() =>
	{
		delete globalThis.window;
	});
	const Capture = { format: 'M3U8', variants: [] };
	Assert.equal(await CollectPlayerPreviews([{ id: 0, url: Old }], {}, null, Capture), null);
	Assert.equal(Attempts, 0);
	Assert.equal(await CollectPlayerPreviews([{ id: 1, url: Current }], {}, null, Capture), null);
	Assert.equal(Attempts, 1);
	Entries.push({ name: Current + '&_HLS_msn=42&_HLS_part=2', responseStatus: 200, initiatorType: 'fetch' });
	await CollectPlayerPreviews([{ id: 1, url: Current }], {}, null, { ...Capture, reloadParameters: HlsReloadParameters });
	Assert.equal(Attempts, 2, 'the canvas preview must remain associated after a standard LL-HLS reload');
});
Test('returns the source dimensions even when the browser cannot export a thumbnail', T =>
{
	const Url = 'https://example.test/video.mp4';
	const Player = {
		currentSrc: Url, duration: 80, readyState: 2, videoWidth: 1920, videoHeight: 1080,
		ownerDocument: { createElement()
			{
				throw new Error('Unreadable frame');
			} },
	};
	globalThis.window = { document: { querySelectorAll: () => [Player] }, length: 0 };
	globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 };
	T.after(() =>
	{
		delete globalThis.window;
		delete globalThis.HTMLMediaElement;
	});
	Assert.deepEqual(CollectPlayerPreviews([{ id: 0, url: Url }], { maxWidth: 112, maxHeight: 63 }), [{
			id: 0, duration: 80, still: undefined, resolution: { width: 1920, height: 1080 },
		}]);
});
Test('reads worker-loaded broadcast metadata only for an unambiguous stream without capturing frames', T =>
{
	const Url = 'https://cdn.test/worker.m3u8';
	const Player = { currentSrc: 'blob:https://example.test/player', paused: false, ended: false, readyState: 2 };
	globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 };
	globalThis.window = { document: { querySelectorAll: () => [Player] },
		navigator: { mediaSession: { metadata: { title: 'Worker broadcast' } } },
		performance: { getEntriesByType: () => [], getEntriesByName: () => [] }, length: 0 };
	T.after(() =>
	{
		delete globalThis.window;
		delete globalThis.HTMLMediaElement;
	});
	Assert.deepEqual(CollectPlayerPreviews([{ id: 0, url: Url }], { metadataOnly: true, singleStream: true }),
	[{ id: 0, mediaTitle: 'Worker broadcast' }]);
	Assert.deepEqual(CollectPlayerPreviews([{ id: 0, url: Url }], { metadataOnly: true, singleStream: false }), []);
	const Entries = [{ name: Url, initiatorType: 'fetch', responseStatus: 200 },
		{ name: 'https://cdn.test/current.m3u8', initiatorType: 'fetch', responseStatus: 200 }];
	window.performance = { getEntriesByType: () => Entries, getEntriesByName: Name => Entries.filter(Entry => Entry.name === Name) };
	Assert.deepEqual(CollectPlayerPreviews([{ id: 0, url: Url }], { metadataOnly: true, singleStream: true }), [],
	'contradictory current-playlist timings must prevent the worker fallback');
	const Child = { ...window, performance: { getEntriesByType: () => [], getEntriesByName: () => [] } };
	window.document = { querySelectorAll: () => [] };
	window.length = 1;
	window.frames = [Child];
	Assert.deepEqual(CollectPlayerPreviews([{ id: 0, url: Url }], { metadataOnly: true, singleStream: true }), [],
	'document-scoped title lookup must not inherit metadata from a child player');
});
Test('reads live frames from a worker MediaSourceHandle only for the single stream in its own document', T =>
{
	const Player = {currentSrc: '', src: '', srcObject: {}, paused: false, ended: false, duration: Infinity, currentTime: 12, readyState: 4,
		videoWidth: 1280, videoHeight: 720, querySelectorAll: () => [], ownerDocument: {createElement: () => ({
				getContext: () => ({drawImage()
					{
					}}), toDataURL: () => 'data:image/jpeg;base64,frame',
			})}};
	globalThis.window = {document: {querySelectorAll: () => [Player]}, performance: {getEntriesByType: () => [], getEntriesByName: () => []}, length: 0};
	globalThis.HTMLMediaElement = {HAVE_CURRENT_DATA: 2};
	T.after(() =>
	{
		delete globalThis.window;
		delete globalThis.HTMLMediaElement;
	});
	Assert.deepEqual(CollectPlayerPreviews([{id: 0, url: 'https://cdn.test/worker.m3u8'}], {singleStream: true}), [
		{id: 0, still: 'data:image/jpeg;base64,frame', duration: undefined, live: true, resolution: {width: 1280, height: 720}},
	]);
	Assert.deepEqual(CollectPlayerPreviews([{id: 0, url: 'https://cdn.test/worker.m3u8'}], {}), [],
	'ambiguous worker playlists must not all borrow the current player image');
});
Test('a hidden auxiliary player does not prevent a single worker stream thumbnail', T =>
{
	const Main = {currentSrc: '', src: '', srcObject: {}, paused: false, ended: false, duration: Infinity, currentTime: 12, readyState: 4, closest: () => null,
		videoWidth: 1280, videoHeight: 720, querySelectorAll: () => [], ownerDocument: {createElement: () => ({getContext: () => ({drawImage()
					{
					}}), toDataURL: () => 'data:image/jpeg;base64,main'})}};
	const bHidden = {...Main, currentSrc: 'https://cdn.test/placeholder.mp4', paused: true, closest: () => ({})};
	globalThis.window = {document: {querySelectorAll: () => [Main, bHidden]}, performance: {getEntriesByType: () => [], getEntriesByName: () => []}, length: 0};
	globalThis.HTMLMediaElement = {HAVE_CURRENT_DATA: 2};
	T.after(() =>
	{
		delete globalThis.window;
		delete globalThis.HTMLMediaElement;
	});
	const Result = CollectPlayerPreviews([{id: 0, url: 'https://cdn.test/master.m3u8'}], {singleStream: true, excludedSelector: '[aria-hidden="true"]'});
	Assert.equal(Result[0]?.still, 'data:image/jpeg;base64,main');
});
Test('a verified selected worker source survives old signed playlist timings', T =>
{
	const Player = {currentSrc: '', src: '', paused: false, ended: false, duration: Infinity, currentTime: 12, readyState: 4,
		videoWidth: 1280, videoHeight: 720, querySelectorAll: () => [], ownerDocument: {createElement: () => ({
				getContext: () => ({drawImage()
					{
					}}), toDataURL: () => 'data:image/jpeg;base64,current',
			})}};
	const Entries = [{name: 'https://cdn.test/old.m3u8', initiatorType: 'fetch', responseStatus: 200}];
	globalThis.window = {document: {querySelectorAll: () => [Player]}, performance: {getEntriesByType: () => Entries, getEntriesByName: () => []}, length: 0};
	globalThis.HTMLMediaElement = {HAVE_CURRENT_DATA: 2};
	T.after(() =>
	{
		delete globalThis.window;
		delete globalThis.HTMLMediaElement;
	});
	const Candidate = {id: 0, url: 'https://cdn.test/renewed.m3u8', singleStream: true};
	Assert.deepEqual(CollectPlayerPreviews([Candidate], {}), []);
	Assert.equal(CollectPlayerPreviews([{...Candidate, selectedSource: true}], {})[0]?.still, 'data:image/jpeg;base64,current');
});
Test('associates the playlist with the only visible blob player that has decoded video', async T =>
{
	const Url = 'https://cdn.test/v.m3u8';
	const Entry = { name: Url, responseStatus: 0, initiatorType: 'xmlhttprequest' };
	let Attempts = 0;
	const Player = {
		currentSrc: 'blob:https://example.test/player',
		duration: 120, currentTime: 5, readyState: 2, videoWidth: 1280, videoHeight: 720,
		getBoundingClientRect: () => ({ width: 640, height: 360 }),
		captureStream()
		{
			Assert.fail('The original player stream must not be captured');
		},
		requestVideoFrameCallback: () => 1, cancelVideoFrameCallback()
		{
		},
		ownerDocument: { createElement: () => ({
				getContext: () => ({ drawImage()
					{
					} }),
				captureStream()
				{
					Attempts++;
					throw new Error('Stop at the canvas capture boundary');
				},
			}) },
	};
	const Players = [
		{ ...Player, currentSrc: 'https://example.test/teaser.mp4' },
		{ ...Player, readyState: 0 },
		{ ...Player, getBoundingClientRect: () => ({ width: 0, height: 0 }) },
		Player,
	];
	globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 };
	globalThis.window = {
		document: { querySelectorAll: () => Players },
		performance: { getEntriesByName: Name => Name === Url ? [Entry] : [], getEntriesByType: () => [Entry] },
		length: 0,
	};
	T.after(() =>
	{
		delete globalThis.window;
		delete globalThis.HTMLMediaElement;
	});
	const Candidates = [{ id: 1, url: Url }];
	Assert.deepEqual(CollectPlayerPreviews(Candidates, {}), [{
			id: 1, duration: 120, still: undefined, resolution: { width: 1280, height: 720 },
		}]);
	await CollectPlayerPreviews(Candidates, {}, null, { format: 'M3U8', variants: [] });
	Assert.equal(Attempts, 1);
	Players.push({ ...Player, currentSrc: 'blob:https://example.test/other' });
	Assert.deepEqual(CollectPlayerPreviews(Candidates, {}), []);
	Assert.equal(CollectPlayerPreviews(Candidates, {}, null, { format: 'M3U8', variants: [] }), null);
	Assert.equal(Attempts, 1);
});
Test('reads a protected preview only from the observed document and CDN', async T =>
{
	const Context = {
		origin: 'https://en.xsz-av.com',
		referer: 'https://en.xsz-av.com/',
		serverOrigin: 'https://v1.xsz2-cdn.com',
	};
	const Source = { tabId: 7, documentId: 'current', context: Context };
	const Signal = new AbortController().signal;
	const Calls = [];
	globalThis.chrome = { scripting: { executeScript: async Request =>
			{
				Calls.push(Request);
				return [{ result: 'AAH/' }];
			} } };
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	await Assert.rejects(ReadPagePreviewResource(Source, { url: 'https://v2.xsz2-cdn.com/part' }, 3, Signal),
	{ key: 'stream_preview_host_permission' });
	Assert.equal(Calls.length, 0);
	const Url = Context.serverOrigin + '/part';
	const Bytes = await ReadPagePreviewResource(Source, { url: Url }, 3, Signal);
	Assert.deepEqual(Bytes, new Uint8Array([0, 1, 255]));
	Assert.deepEqual(Calls[0].target, { tabId: 7, documentIds: ['current'] });
	Assert.deepEqual(Calls[0].args.slice(0, 4), [Context.origin, Url, null, 3]);
});
