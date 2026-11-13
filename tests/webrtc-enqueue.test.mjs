import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Enqueue, ControlJob, ListJobs} from '../extension/jobs.js';
import {Connection, MockSourceProviders} from './helpers/webrtc-connection.mjs';

Test('the existing enqueue registers WebRTC before receiving and controls it from the manager without opening a tab', async T =>
{
	MockSourceProviders(T);
	const Id = 'a47bd6c7-dd85-4aec-a5de-02157fa036ae', Page = 'https://player.test/live', Doc = 'doc';
	const Session = {'scan:18': {scanId: 'scan', documentId: Doc, page: Page, candidates: [{id: 0, format: 'WEBRTC',
		name: 'WebRTC-720x960.mp4', mimeType: 'video/mp4', supported: true, live: true, documentId: Doc, trackId: 'track',
		url: 'webrtc:track', mediaKey: 'media', page: Page}]}};
	const Local = {debugDownloads: false}, Controls = [];
	let Prepared = false, TabsOpened = 0, SiteAllowed = false;
	const Captions=[{language:'en',label:'English',url:'https://captions.test/en.vtt?token=ephemeral-caption'}];
	const Storage = Data => ({async get(Keys)
	{
		const Wanted = Keys == null ? Object.keys(Data) : Array.isArray(Keys) ? Keys : [Keys];
		return Object.fromEntries(Wanted.filter(Key => Key in Data).map(Key => [Key, Data[Key]]));
	}, async set(Values) { Object.assign(Data, Values); }, async remove(Key) { delete Data[Key]; }});
	globalThis.chrome = {storage: {local: Storage(Local), session: Storage(Session)}, permissions: {
		contains: async ({origins}) => !origins.includes('https://player.test/*') || SiteAllowed,
	},
		tabs: {async create() { TabsOpened++; }}, downloads: {search: async () => []},
		runtime: {id: 'extension', getURL: Path => 'chrome-extension://extension/' + Path, getContexts: async () => [{}],
			async sendMessage(Message)
			{
				if (Message.type === 'webrtcReceive')
				{
					Prepared = true;
					Assert.equal(Local['job:' + Id].state, 'active');
					Assert.equal(Message.job.background, true);
					Assert.deepEqual(Message.job.subtitles,Captions);
					Assert.match(Message.job.filename, /^player_test_방송_제목_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/);
					Assert.doesNotMatch(Message.job.filename, /WebRTC|playback|MDownloader/);
					return {ok: true, started: {mimeType: 'video/mp4'}};
				}
				if (Message.type === 'webrtcReceiverControl') { Controls.push(Message); return {ok: true}; }
				if (Message.type === 'webrtcCancel') return {ok: true};
				if (Message.type === 'hlsActive') return {recordingIds: [Id]};
				return null;
			}},
		scripting: {async executeScript({func, args, target})
		{
			if(func.name==='ReadPageSubtitles')return[{documentId:Doc,result:Captions}];
			if (func.name === 'WebRtcQualityTask') return [{documentId: Doc, result: {connection: Connection()}}];
			if (func.name === 'WebRtcPageTask')
			{
				Assert.deepEqual(target.documentIds, [Doc]);
				if (args[0].action === 'probe') return [{documentId: Doc, result: {page: Page, streams: [{trackId: 'track'}]}}];
				if (args[0].action === 'reserve') return [{documentId: Doc, result: {reserved: true}}];
				if (args[0].action === 'start')
				{
					Assert.equal(Prepared, true);
					Assert.equal(Local['job:' + Id].state, 'active');
					Assert.equal(Local['job:' + Id].recording, true);
					Assert.equal(args[0].trackId, 'track');
					return [{documentId: Doc, result: {mimeType: 'video/mp4'}}];
				}
				Controls.push(args[0]);
				return [{documentId: Doc, result: {state: 'stopping'}}];
			}
			return [{documentId: Doc, result: {page: Page, active: true, pageTitle: '방송 제목'}}];
		}}};
	T.after(() => { delete globalThis.chrome; });
	await Assert.rejects(Enqueue({tabId: 18, scanId: 'scan', candidateId: 0, requestId: Id}),
		{key: 'view_site_access_needed', args: ['https://player.test']});
	Assert.equal(Local['job:' + Id], undefined);
	Assert.equal(Prepared, false);
	SiteAllowed = true;
	Assert.equal((await Enqueue({tabId: 18, scanId: 'scan', candidateId: 0, requestId: Id})).state, 'started');
	const [Job] = await ListJobs([Id]);
	Assert.equal(Job.state, 'active');
	Assert.equal(Job.live, true);
	Assert.equal(Job.hls, undefined);
	Assert.equal(Prepared, true);
	Assert.equal(JSON.stringify(Session).includes('fixture-only-authorization'), false);
	Assert.equal(JSON.stringify(Local).includes('ephemeral-caption'),false);
	await ControlJob(Id, 'finish');
	Assert.equal(Controls.at(-1).action, 'finish');
	await ControlJob(Id, 'cancel');
	Assert.equal(Controls.at(-1).action, 'cancel');
	Assert.equal(TabsOpened, 0);
});
