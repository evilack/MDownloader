import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {Enqueue, UpdateHls, ListJobs} from '../extension/jobs.js';
import {SummarizeJob} from '../extension/lib/browser-job-state.js';
import {CandidateSubtitleStatuses} from '../extension/detection.js';

Test('captioned direct files and HLS send all tracks to the offscreen runner without persisting signed URLs', async T =>
{
	const Page = 'https://www.player.test/watch', Doc = 'caption-doc';
	const Captions = ['en', 'ja'].map(Language => ({url: `https://captions.test/${Language}.vtt?token=private`, language: Language, label: Language}));
	const Local = {useDownloadDateTime: false, usePageTitle: false}, Messages = [];
	const Session = {'scan:57': {scanId: 'scan', documentId: Doc, page: Page, candidates: [
		{id: 0, supported: true, name: 'clip.mp4', format: 'MP4', url: 'https://cdn.test/clip.mp4', documentId: Doc},
		{id: 1, supported: true, name: 'master.m3u8', format: 'M3U8', url: 'https://cdn.test/master.m3u8', documentId: Doc},
	]}};
	const Storage = Data => ({get: async Keys => Object.fromEntries((Array.isArray(Keys) ? Keys : Keys === null ? Object.keys(Data) : [Keys]).map(Key => [Key, Data[Key]])),
		set: async Values => Object.assign(Data, Values)});
	globalThis.chrome = {storage: {local: Storage(Local), session: Storage(Session)}, permissions: {contains: async() => true},
		runtime: {id: 'test', getURL: Path => 'chrome-extension://test/' + Path, getContexts: async() => [{}], sendMessage: async Message =>
		{
			Messages.push(Message);
			if (Message.type === 'hlsActive') return {directIds: ['00000000-0000-0000-0000-000000000007']};
			return {ok: true};
		}},
		scripting: {executeScript: async({func: Func}) => [{documentId: Doc, result: Func.name === 'ReadPageSubtitles' ? Captions : {page: Page, active: true, pageTitle: 'Title'}}]},
		downloads: {search: async() => [], download: () => Assert.fail('raw browser download would omit captions')}};
	T.after(() => delete globalThis.chrome);
	Local.subtitleTranslation = {enabled:true,provider:'google',targetLanguage:'ko',providers:{google:{key:'private-key'}}};
	const Statuses = await CandidateSubtitleStatuses({tabId:57,scanId:'scan',candidateIds:[0,1]});
	Assert.equal(Statuses[0].status.count,2);
	Assert.equal(Statuses[0].status.translation,'pending');
	Assert.equal(JSON.stringify(Statuses).includes('private-key'),false);
	for (const Candidate of [0, 1])
	{
		const Id = `00000000-0000-0000-0000-00000000000${Candidate + 7}`;
		await Enqueue({tabId: 57, scanId: 'scan', candidateId: Candidate, requestId: Id});
		const Sent = Messages.find(Message => Message.job?.requestId === Id && ['hlsRun', 'folderRun'].includes(Message.type));
		Assert.deepEqual(Sent?.job.subtitles, Captions);
		Assert.equal(Local['job:' + Id].subtitleCount, 2);
		Assert.equal(Local['job:' + Id].subtitleStatus.translation, 'pending');
		Assert.equal(JSON.stringify(Local).includes('token=private'), false);
		if (Candidate === 0)
		{
			Assert.equal(SummarizeJob(Local['job:' + Id], undefined, {directIds: [Id]}).state, 'active');
			Local['job:' + Id].bytesReceived = 120000;
			Session['job-preview-source:' + Id] = {url: 'https://cdn.test/clip.mp4', format: 'MP4'};
			Assert.equal((await ListJobs([Id]))[0].snapshotAvailable, true, 'captioned direct jobs retain the current-save button');
			await UpdateHls({requestId: Id, action: 'subtitleReady', count: 2});
			const Status = {...Local['job:' + Id].subtitleStatus, phase:'ready', translation:'translating'};
			await UpdateHls({requestId:Id,action:'subtitleStatus',status:Status});
			Assert.deepEqual((await ListJobs([Id]))[0].subtitleStatus,Status);
			await Assert.rejects(UpdateHls({requestId:Id,action:'subtitleStatus',status:{...Status,key:'secret'}}));
			Assert.equal(Local['job:' + Id].subtitleCount, 2);
		}
	}
});
