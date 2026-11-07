import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setImmediate as Settle} from 'node:timers/promises';
import {ObserveCandidateThumbnails} from '../extension/media-thumbnails.js';
import {RuntimePolicy} from '../extension/lib/runtime-policy.js';
Test('keeps thumbnail retries independent from hover playback failure status', async T =>
{
	let Intersect, Now = 0, Reads = 0, Samples = 0, bDisconnected = false;
	const Shown = [], Stale = [];
	globalThis.document = {hidden: false, addEventListener()
		{
		}, removeEventListener()
		{
		}};
	globalThis.IntersectionObserver = class
	{
		constructor(Callback)
		{
			Intersect = Callback;
		} observe()
		{
		} unobserve()
		{
		} disconnect()
		{
			bDisconnected = true;
		}
	};
	globalThis.chrome = {runtime: {sendMessage: async() => ({ok: true, data: ++Reads === 2 ? []: [{id: 0, still: 'frame-' + Reads, live: true}]})}};
	T.mock.method(performance, 'now', () => Now);
	T.mock.timers.enable({apis: ['setTimeout']});
	T.after(() =>
	{
		delete globalThis.document;
		delete globalThis.IntersectionObserver;
		delete globalThis.chrome;
	});
	const Tile = {control: {}, show: Value => Shown.push(Value.still), setStale: Value => Stale.push(Value), readThumbnail: async() =>
		{
			Samples++;
			throw new Error('Not updated');
		}};
	const Stop = ObserveCandidateThumbnails(null, {tabId: 1, scanId: 'scan'}, new Map([[0, Tile]]));
	Intersect([{target: Tile.control, isIntersecting: true}]);
	T.mock.timers.tick(0);
	await Settle();
	Assert.deepEqual(Shown, ['frame-1']);
	Now += RuntimePolicy.Preview.ThumbnailRefreshMs;
	T.mock.timers.tick(RuntimePolicy.Preview.ThumbnailRefreshMs);
	await Settle();
	Assert.deepEqual(Stale, [], 'a failed thumbnail refresh must not mark hover playback failed');
	Now += RuntimePolicy.Preview.ThumbnailRefreshMs;
	T.mock.timers.tick(RuntimePolicy.Preview.ThumbnailRefreshMs);
	await Settle();
	Assert.deepEqual(Shown, ['frame-1', 'frame-3'], 'a later successful refresh restores the existing tile');
	Assert.deepEqual(Stale, []);
	Assert.equal(Samples, 1, 'an available player frame must avoid another stream sample');
	Stop();
	Now += 60000;
	T.mock.timers.tick(60000);
	await Settle();
	Assert.equal(Reads, 3);
	Assert.equal(bDisconnected, true);
});
Test('gives later visible streams a sample slot even when the first streams keep failing', async T =>
{
	let Intersect, Now = 0, Stop;
	const Samples = [0, 0, 0];
	globalThis.document = {hidden: false, addEventListener()
		{
		}, removeEventListener()
		{
		}};
	globalThis.IntersectionObserver = class
	{
		constructor(Callback)
		{
			Intersect = Callback;
		}observe()
		{
		}unobserve()
		{
		}disconnect()
		{
		}
	};
	globalThis.chrome = {runtime: {sendMessage: async() => ({ok: true, data: []})}};
	T.mock.method(performance, 'now', () => Now);
	T.mock.timers.enable({apis: ['setTimeout']});
	T.after(() =>
	{
		Stop?.();
		delete globalThis.document;
		delete globalThis.IntersectionObserver;
		delete globalThis.chrome;
	});
	const Tiles = Samples.map((_, Id) => ({control: {}, show()
		{
		}, readThumbnail: async() =>
		{
			Samples[Id]++;
			if (Id < 2)
			{
				throw new Error('Expired');
			}
			return{still: 'third'};
		}}));
	Stop = ObserveCandidateThumbnails(null, {tabId: 1, scanId: 'scan'}, new Map(Tiles.map((Tile, Id) => [Id, Tile])));
	Intersect(Tiles.map(Tile => ({target: Tile.control, isIntersecting: true})));
	T.mock.timers.tick(0);
	await Settle();
	Now = 1000;
	T.mock.timers.tick(1000);
	await Settle();
	Assert.equal(Samples[2], 1, 'failure in an earlier stream must not starve a later thumbnail');
});
Test('refreshes a visible VOD after its first image instead of removing it permanently', async T =>
{
	let Intersect, Now = 0, Reads = 0, Stop;
	const Shown = [];
	globalThis.document = {hidden: false, addEventListener()
		{
		}, removeEventListener()
		{
		}};
	globalThis.IntersectionObserver = class
	{
		constructor(Callback)
		{
			Intersect = Callback;
		}observe()
		{
		}unobserve()
		{
		}disconnect()
		{
		}
	};
	globalThis.chrome = {runtime: {sendMessage: async() => ({ok: true, data: [{id: 0, still: 'frame-' + (++Reads), live: false}]})}};
	T.mock.method(performance, 'now', () => Now);
	T.mock.timers.enable({apis: ['setTimeout']});
	T.after(() =>
	{
		Stop?.();
		delete globalThis.document;
		delete globalThis.IntersectionObserver;
		delete globalThis.chrome;
	});
	const Tile = {control: {}, show: P => Shown.push(P.still)};
	Stop = ObserveCandidateThumbnails(null, {tabId: 1, scanId: 'scan'}, new Map([[0, Tile]]));
	Intersect([{target: Tile.control, isIntersecting: true}]);
	T.mock.timers.tick(0);
	await Settle();
	Now += 15000;
	T.mock.timers.tick(15000);
	await Settle();
	Assert.deepEqual(Shown, ['frame-1', 'frame-2']);
});
Test('retries an image that could not be decoded rather than treating its URL as success', async T =>
{
	let Intersect, Now = 0, Reads = 0, Stop;
	const Shown = [];
	globalThis.document = {hidden: false, addEventListener()
		{
		}, removeEventListener()
		{
		}};
	globalThis.IntersectionObserver = class
	{
		constructor(Callback)
		{
			Intersect = Callback;
		}observe()
		{
		}unobserve()
		{
		}disconnect()
		{
		}
	};
	globalThis.chrome = {runtime: {sendMessage: async() => ({ok: true, data: [{id: 0, still: 'frame', live: false}]})}};
	T.mock.method(performance, 'now', () => Now);
	T.mock.timers.enable({apis: ['setTimeout']});
	T.after(() =>
	{
		Stop?.();
		delete globalThis.document;
		delete globalThis.IntersectionObserver;
		delete globalThis.chrome;
	});
	const Tile = {control: {}, show: async P =>
		{
			Shown.push(P.still);
			return ++Reads > 1;
		}};
	Stop = ObserveCandidateThumbnails(null, {tabId: 1, scanId: 'scan'}, new Map([[0, Tile]]));
	Intersect([{target: Tile.control, isIntersecting: true}]);
	T.mock.timers.tick(0);
	await Settle();
	Now += 250;
	T.mock.timers.tick(250);
	await Settle();
	Assert.equal(Reads, 2);
});
Test('a stalled batch response does not lock subsequent thumbnail reads', async T =>
{
	let Intersect, Now = 0, Reads = 0, Stop;
	globalThis.document = {hidden: false, addEventListener()
		{
		}, removeEventListener()
		{
		}};
	globalThis.IntersectionObserver = class
	{
		constructor(Callback)
		{
			Intersect = Callback;
		}observe()
		{
		}unobserve()
		{
		}disconnect()
		{
		}
	};
	globalThis.chrome = {runtime: {sendMessage: async() => ++Reads === 1 ? new Promise(() =>
			{
			}): ({ok: true, data: []})}};
	T.mock.method(performance, 'now', () => Now);
	T.mock.timers.enable({apis: ['setTimeout']});
	T.after(() =>
	{
		Stop?.();
		delete globalThis.document;
		delete globalThis.IntersectionObserver;
		delete globalThis.chrome;
	});
	const Tile = {control: {}, show()
		{
		}};
	Stop = ObserveCandidateThumbnails(null, {tabId: 1, scanId: 'scan'}, new Map([[0, Tile]]));
	Intersect([{target: Tile.control, isIntersecting: true}]);
	T.mock.timers.tick(0);
	await Settle();
	Now += 10000;
	T.mock.timers.tick(10000);
	await Settle();
	Now += 250;
	T.mock.timers.tick(250);
	await Settle();
	Assert.equal(Reads, 2);
});
