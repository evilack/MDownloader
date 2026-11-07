import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {DebugLog} from '../extension/lib/debug-log.js';
Test('offscreen accepts debug configuration only from the extension without using storage or creating a document', async T =>
{
	let Listener, Responses = 0;
	globalThis.chrome = {runtime: {id: 'extension', onMessage: {addListener: Value =>
				{
					Listener = Value;
				}}}};
	T.after(() =>
	{
		DebugLog.SetEnabled(false);
		delete globalThis.chrome;
	});
	await import('../extension/hls-runner.js');
	Listener({type: 'debugConfiguration', debugLogging: true}, {id: 'untrusted'}, () => Responses++);
	Assert.equal(DebugLog.IsEnabled(), false);
	Listener({type: 'debugConfiguration', debugLogging: true}, {id: 'extension'}, () => Responses++);
	Assert.equal(DebugLog.IsEnabled(), true);
	Listener({type: 'debugConfiguration', debugLogging: false}, {id: 'extension'}, () => Responses++);
	Assert.equal(DebugLog.IsEnabled(), false);
	Assert.equal(Responses, 2);
});
