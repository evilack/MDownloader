import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {SetHlsRequestRules} from '../extension/lib/hls-request-context.js';
import {SummarizeJob} from '../extension/lib/browser-job-state.js';
Test('keeps both active stream jobs visible in the manager', () =>
{
	for (const RequestId of ['first', 'second'])
	{
		const Job = {requestId: RequestId, hls: true, state: 'active'};
		Assert.equal(SummarizeJob(Job, undefined, {requestIds: ['first', 'second']}).state, 'active');
	}
});
Test('updates and releases only the owning stream header rules, including concurrent updates', async T =>
{
	const Data = {};
	let Rules = [];
	globalThis.chrome = {runtime: {id: 'extension'}, storage: {session: {
				get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values),
			}}, declarativeNetRequest: {getSessionRules: async() => structuredClone(Rules), updateSessionRules: async({removeRuleIds: RemoveRuleIds, addRules: AddRules}) =>
			{
				await Promise.resolve();
				Rules = Rules.filter(Rule => !RemoveRuleIds.includes(Rule.id)).concat(AddRules);
			}}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Context = {serverOrigin: 'https://cdn.test', origin: 'https://site.test', referer: 'https://site.test/first'};
	await Promise.all([
		SetHlsRequestRules(Context, ['https://cdn.test/first.m3u8'], 'first'),
		SetHlsRequestRules({...Context, referer: 'https://site.test/second'}, ['https://cdn.test/second.m3u8'], 'second'),
	]);
	Assert.deepEqual(Rules.map(Rule => Rule.condition.urlFilter).sort(), ['|https://cdn.test/first.m3u8|', '|https://cdn.test/second.m3u8|']);
	await SetHlsRequestRules(undefined, [], 'first');
	Assert.deepEqual(Rules.map(Rule => Rule.condition.urlFilter), ['|https://cdn.test/second.m3u8|']);
	Assert.equal(Rules[0].action.requestHeaders[0].value, 'https://site.test/second');
});
