import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setImmediate as Settle} from 'node:timers/promises';
import {LaunchWebRtc, ControlWebRtc} from '../extension/webrtc-jobs.js';
import {Connection, MockSourceProviders} from './helpers/webrtc-connection.mjs';

Test('cancellation during offscreen startup is accepted before creating a receiver', async T =>
{
	MockSourceProviders(T);
	const Data = {}, Gate = Promise.withResolvers();
	let Starts = 0;
	globalThis.chrome = {runtime: {getURL: Path => 'chrome-extension://ext/' + Path,
		getContexts: async () => { await Gate.promise; return [{}]; }, sendMessage: async Message =>
		{ if (Message.type === 'webrtcReceive') Starts++; return {ok: true, started: {mimeType: 'video/mp4'}}; }},
		storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values), remove: async Key => { delete Data[Key]; }}},
		scripting: {async executeScript() { return [{documentId: 'doc', result: {connection: Connection()}}]; }}};
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

Test('independent quality selection never changes the source player or starts a page recorder', async T =>
{
	MockSourceProviders(T);
	const Data = {}, Actions = [], Messages = [];
	globalThis.chrome = {storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values), remove: async Key => { delete Data[Key]; }}},
		runtime: {getURL: Path => 'chrome-extension://ext/' + Path, getContexts: async () => [{}],
			sendMessage: async Message => { Messages.push(Message); return {ok: true, started: {mimeType: 'video/mp4'}}; }},
		scripting: {async executeScript({func, args, world})
		{
			Actions.push(func.name + ':' + args[0].action);
			Assert.equal(world, 'MAIN');
			return [{documentId: 'doc', result: {connection: Connection(args[0].quality?.name)}}];
		}}};
	T.after(() => { delete globalThis.chrome; });
	await LaunchWebRtc({requestId: 'r'}, {documentId: 'doc', page: 'https://player.test/live', trackId: 'track'}, 7,
		{name: '240p', session: 's'});
	Assert.deepEqual(Actions, ['WebRtcQualityTask:connection']);
	Assert.equal(Messages.find(Message => Message.type === 'webrtcReceive').connection.quality, '240p');
});

Test('cancel during descriptor extraction prevents a delayed receiver from starting', async T =>
{
	MockSourceProviders(T);
	const Data = {}, Gate = Promise.withResolvers(), Actions = [], Messages = [];
	globalThis.chrome = {storage: {session: {get: async Key => ({[Key]: Data[Key]}), set: async Values => Object.assign(Data, Values), remove: async Key => { delete Data[Key]; }}},
		runtime: {getURL: Path => 'chrome-extension://ext/' + Path, sendMessage: async Message => { Messages.push(Message); return {ok: true}; }}, scripting: {async executeScript({func, args, world})
		{
			const Action = args[0].action; Actions.push(Action);
			if (func.name === 'WebRtcQualityTask') Assert.equal(world, 'MAIN');
			if (Action === 'connection') { await Gate.promise; return [{documentId: 'doc', result: {connection: Connection()}}]; }
			return [{documentId: 'doc', result: Action === 'reserve' ? {reserved: true} : {released: true}}];
		}}};
	T.after(() => { delete globalThis.chrome; });
	const Pending = LaunchWebRtc({requestId: 'r'}, {documentId: 'doc', page: 'https://player.test/live', trackId: 'track'}, 7,
		{name: '240p', session: 's'}).catch(ErrorValue => ErrorValue);
	await Settle();
	Assert.equal(Actions.includes('connection'), true);
	await ControlWebRtc('r', 'cancel'); Gate.resolve();
	Assert.equal((await Pending).name, 'AbortError');
	Assert.equal(Messages.some(Message => Message.type === 'webrtcReceive'), false);
});
