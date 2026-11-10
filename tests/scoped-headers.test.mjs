import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {SetScopedHlsRequestRules} from '../extension/lib/hls-request-context.js';
Test('does not spread a full page Referer to unobserved segment CDNs', async T =>
{
	const Stored = {}, Updates = [];
	globalThis.chrome = {runtime: {id: 'test'}, storage: {session: {get: async Key => ({[Key]: Stored[Key]}), set: async Values => Object.assign(Stored, Values)}},
		declarativeNetRequest: {getSessionRules: async() => [], updateSessionRules: async Update => Updates.push(Update)}};
	T.after(() =>
	{
		delete globalThis.chrome;
	});
	const Context = {serverOrigin: 'https://playlist.test', origin: 'https://page.test', referer: 'https://page.test/watch?private=token'};
	await SetScopedHlsRequestRules(Context, ['https://playlist.test/live.m3u8', 'https://segment.test/1.ts'], 'job');
	Assert.equal(Updates[0].addRules.length, 1);
	Assert.equal(Updates[0].addRules[0].condition.urlFilter, '|https://playlist.test/live.m3u8|');
	await SetScopedHlsRequestRules(Context, ['https://segment.test/2.ts'], 'job');
	Assert.deepEqual(Stored['hls-header-owners'], {});
});
