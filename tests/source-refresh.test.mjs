import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {StartVisibleSourceRefresh} from '../extension/lib/source-refresh.js';
import {RuntimePolicy} from '../extension/lib/runtime-policy.js';
Test('rechecks visible source ownership without a seek or network event and stops when disposed', T =>
{
	let Reads = 0, Notify;
	globalThis.document = {hidden: false, addEventListener(Type, Listener)
		{
			Notify = Listener;
		}, removeEventListener()
		{
			Notify = undefined;
		}};
	T.mock.timers.enable({apis: ['setTimeout']});
	T.after(() =>
	{
		delete globalThis.document;
	});
	const Stop = StartVisibleSourceRefresh(() => Reads++);
	T.mock.timers.tick(RuntimePolicy.Detection.SourceRefreshMs);
	Assert.equal(Reads, 1);
	document.hidden = true;
	Notify();
	T.mock.timers.tick(RuntimePolicy.Detection.SourceRefreshMs);
	Assert.equal(Reads, 1);
	document.hidden = false;
	Notify();
	T.mock.timers.tick(RuntimePolicy.Detection.SourceRefreshMs);
	Assert.equal(Reads, 2);
	Stop();
	T.mock.timers.tick(RuntimePolicy.Detection.SourceRefreshMs);
	Assert.equal(Reads, 2);
	Assert.equal(Notify, undefined, 'disposing removes the visibility subscription');
});
