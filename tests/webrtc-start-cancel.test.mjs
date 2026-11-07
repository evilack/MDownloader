import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setImmediate as Settle} from 'node:timers/promises';
import {LaunchWebRtc, ControlWebRtc} from '../extension/webrtc-jobs.js';

Test('cancellation during runner startup is accepted before producer creation', async T =>
{
	const Data = {}, Gate = Promise.withResolvers();
	let Starts = 0;
	globalThis.chrome = {runtime: {getURL: Path => 'chrome-extension://ext/' + Path,
		getContexts: async () => { await Gate.promise; return [{}]; }, sendMessage: async () => ({ok: true})},
		storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values), remove: async Key => { delete Data[Key]; }}},
		scripting: {async executeScript({args}) { if (args[0].action === 'start') Starts++; return [{documentId: 'doc', result: args[0].action === 'reserve' ? {reserved: true} : {mimeType: 'video/mp4'}}]; }}};
	T.after(() => { delete globalThis.chrome; });
	const Starting = LaunchWebRtc({requestId: 'request'}, {documentId: 'doc', page: 'https://player.test/live', trackId: 'track', mimeType: 'video/mp4'}, 7).catch(ErrorValue => ErrorValue);
	await Settle();
	Assert.equal(await ControlWebRtc('request', 'cancel'), true);
	Gate.resolve();
	Assert.equal((await Starting).name, 'AbortError');
	Assert.equal(Starts, 0);
});

Test('stop/save force-finishes an already ended producer instead of leaving its job active', async T =>
{
	let Forced = false;
	globalThis.chrome = {storage: {session: {get: async Key => ({[Key]: {requestId: 'r', token: 't', tabId: 7, documentId: 'doc', page: 'https://player.test/live'}})}},
		runtime: {sendMessage: async Message => { if (Message.type === 'webrtcForceFinish') Forced = true; return {ok: true}; }},
		scripting: {executeScript: async () => [{documentId: 'doc', result: {state: 'ended'}}]}};
	T.after(() => { delete globalThis.chrome; });
	await ControlWebRtc('r', 'finish');
	Assert.equal(Forced, true);
});

Test('an occupied recording slot rejects selection before changing the server quality', async T =>
{
	const Data = {}, Actions = [];
	globalThis.chrome = {storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values), remove: async Key => { delete Data[Key]; }}},
		runtime: {sendMessage: async () => ({ok: true})}, scripting: {async executeScript({func, args})
		{
			Actions.push(func.name + ':' + args[0].action);
			return [{documentId: 'doc', result: args[0].action === 'reserve' ? {error: 'webrtc_busy'} : {released: true}}];
		}}};
	T.after(() => { delete globalThis.chrome; });
	await Assert.rejects(LaunchWebRtc({requestId: 'r'}, {documentId: 'doc', page: 'https://player.test/live', trackId: 'track'}, 7,
		{name: '240p', session: 's'}), ErrorValue => ErrorValue.key === 'webrtc_busy');
	Assert.equal(Actions.includes('WebRtcQualityTask:select'), false);
});

Test('cancel during server selection releases its lease and never starts the recorder', async T =>
{
	const Data = {}, Gate = Promise.withResolvers(), Actions = [];
	globalThis.chrome = {storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values), remove: async Key => { delete Data[Key]; }}},
		runtime: {sendMessage: async () => ({ok: true})}, scripting: {async executeScript({func, args, world})
		{
			const Action = args[0].action; Actions.push(Action);
			if (func.name === 'WebRtcQualityTask') Assert.equal(world, 'MAIN');
			if (Action === 'select') { await Gate.promise; return [{documentId: 'doc', result: {quality: {width: 180, height: 240}}}]; }
			return [{documentId: 'doc', result: Action === 'reserve' ? {reserved: true} : {released: true}}];
		}}};
	T.after(() => { delete globalThis.chrome; });
	const Pending = LaunchWebRtc({requestId: 'r'}, {documentId: 'doc', page: 'https://player.test/live', trackId: 'track'}, 7,
		{name: '240p', session: 's'}).catch(ErrorValue => ErrorValue);
	await Settle();
	Assert.equal(Actions.includes('select'), true);
	await ControlWebRtc('r', 'cancel'); Gate.resolve();
	Assert.equal((await Pending).name, 'AbortError');
	Assert.equal(Actions.includes('release'), true);
	Assert.equal(Actions.includes('start'), false);
});
