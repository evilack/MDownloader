import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {CreateDebugLogger} from '../extension/lib/debug-log.js';
import {CreateSettingsCache} from '../extension/lib/settings.js';
import {ControlJob} from '../extension/jobs.js';
import {DebugLog} from '../extension/lib/debug-log.js';
Test('disabled diagnostics never evaluate data, inspect clocks, write or emit', () =>
{
	let Evaluations = 0, Clocks = 0, Outputs = 0;
	const Log = CreateDebugLogger({clock: () =>
		{
			Clocks++;
			return 0;
		}, sink: () => Outputs++});
	for (let Index = 0; Index < 10000; Index++)
	{
		Log.Record('RequestStarted', () =>
		{
			Evaluations++;
			throw new Error('secret');
		});
	}
	Assert.equal(Evaluations, 0);
	Assert.equal(Clocks, 0);
	Assert.equal(Outputs, 0);
	Assert.deepEqual(Log.Snapshot(), []);
});
Test('diagnostics allow only catalog events and numeric or declared fields, throttle and bound memory', () =>
{
	let Now = 0, Evaluations = 0;
	const Output = [];
	const Log = CreateDebugLogger({clock: () => Now, sink: Entry => Output.push(Entry), limit: 3, intervalMs: 10});
	Log.SetEnabled(true);
	Log.Record('RequestStarted', () => ({count: 2, url: 'https://secret/?token=secret', token: 'secret', ip: '127.0.0.1', error: new Error('secret'), stage: 'master-request', requestId: '01234567-89ab-cdef-0123-456789abcdef'}));
	Log.Record('https://secret', () =>
	{
		throw new Error('unknown event evaluated');
	});
	Log.Record('RequestStarted', () =>
	{
		Evaluations++;
		return {};
	});
	Assert.equal(Evaluations, 0);
	Assert.equal(Output.length, 1);
	Assert.equal(JSON.stringify(Output).includes('secret'), false);
	Assert.equal(Output[0].count, 2);
	Assert.equal(Output[0].stage, 'master-request');
	for (let Index = 0; Index < 5; Index++)
	{
		Now += 11;
		Log.Record('RequestStarted', () => ({count: Index}));
	}
	Assert.equal(Log.Snapshot().length, 3);
	Log.SetEnabled(false);
	Assert.deepEqual(Log.Snapshot(), [], 'turning off releases retained diagnostics');
	Log.Record('RequestFailed', () =>
	{
		throw new Error('off');
	});
});
Test('a broken diagnostic sink or lazy producer never changes application behavior', () =>
{
	const Log = CreateDebugLogger({sink: () =>
		{
			throw new Error('sink');
		}});
	Log.SetEnabled(true);
	Assert.doesNotThrow(() => Log.Record('RequestStarted', () =>
	{
		throw new Error('producer');
	}));
	Assert.doesNotThrow(() => Log.Record('RequestFailed', () => ({status: 403})));
});
Test('settings cache subscribes before reading and rejects a stale initial read', async () =>
{
	let Notify, Resolve, Reads = 0;
	const Storage = {local: {get: () =>
			{
				Reads++;
				return new Promise(Done =>
				{
					Resolve = Done;
				});
			}}, onChanged: {
			addListener: Listener =>
			{
				Notify = Listener;
			}, removeListener: Listener =>
			{
				Assert.equal(Listener, Notify);
			},
		}};
	const Cache = CreateSettingsCache(['debugLogging'], Storage);
	Notify({debugLogging: {newValue: true}}, 'local');
	Resolve({debugLogging: false});
	await Cache.Ready;
	for (let Index = 0; Index < 1000; Index++)
	{
		Assert.equal(Cache.Get('debugLogging'), true);
	}
	Assert.equal(Reads, 1);
	Notify({debugLogging: {oldValue: true}}, 'local');
	Assert.equal(Cache.Get('debugLogging'), false);
	Cache.Dispose();
});
Test('job control diagnostics distinguish a pause request from a completed cancellation', async T =>
{
	globalThis.chrome = {storage: {local: {get: async () => ({})}}};
	T.mock.method(console, 'debug', () =>
	{
	});
	T.after(() =>
	{
		DebugLog.SetEnabled(false);
		delete globalThis.chrome;
	});
	DebugLog.SetEnabled(true);
	await Assert.rejects(ControlJob('01234567-89ab-cdef-0123-456789abcdef', 'pause'));
	const Entries = DebugLog.Snapshot();
	Assert.equal(Entries[0].event, 'JobControlRequested');
	Assert.equal(Entries[0].action, 'pause');
	Assert.ok(Entries.every(Entry => Entry.event !== 'TransferCanceled'));
});
