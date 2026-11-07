/** OFF의 절대 무비용을 주장하지 않고 가드 호출 비용과 금지된 부작용 수를 따로
 * 측정합니다. 실제 콘솔 렌더링 비용은 브라우저마다 달라 이 측정에 포함하지 않습니다. */
import Assert from 'node:assert/strict';
import {writeFile as WriteFile, mkdir as Mkdir} from 'node:fs/promises';
import {CreateDebugLogger} from '../../extension/lib/debug-log.js';
import {RecordDownloadLog} from '../../extension/lib/download-log.js';
import {ArtifactPath} from '../lib/tool-config.mjs';
const Count = 500000;
const Counters = {data: 0, clock: 0, sink: 0, serialization: 0, storageReads: 0, storageWrites: 0, messages: 0, timers: 0, observers: 0, stacks: 0};
const Originals = new Map();
for (const [Name, Counter] of [['setTimeout', 'timers'], ['setInterval', 'timers'], ['PerformanceObserver', 'observers'], ['MutationObserver', 'observers'], ['Error', 'stacks']])
{
	Originals.set(Name, globalThis[Name]);
	const Original = globalThis[Name] ?? class
	{
	};
	globalThis[Name] = new Proxy(Original, {
		apply(Target, Receiver, Args)
		{
			Counters[Counter]++;
			return Reflect.apply(Target, Receiver, Args);
		},
		construct(Target, Args, NewTarget)
		{
			Counters[Counter]++;
			return Reflect.construct(Target, Args, NewTarget);
		},
	});
}
const Serialize = JSON.stringify;
JSON.stringify = (...Args) =>
{
	Counters.serialization++;
	return Serialize(...Args);
};
// 한 시각의 이벤트 폭주를 재현합니다. OFF는 이 시계도 호출하지 않습니다.
const Log = CreateDebugLogger({clock: () =>
	{
		Counters.clock++;
		return 0;
	}, sink: Entry =>
	{
		Counters.sink++;
		JSON.stringify(Entry);
	}});
const Data = () =>
{
	Counters.data++;
	const ErrorValue = new Error();
	return {count: 1, error: ErrorValue};
};
const Started = performance.now();
for (let Index = 0; Index < Count; Index++)
{
	if (Log.IsEnabled())
	{
		Log.Record('RequestStarted', Data);
	}
}
const GuardMs = performance.now() - Started;
const DirectStarted = performance.now();
for (let Index = 0; Index < Count; Index++)
{
	Log.Record('RequestStarted', Data);
}
const DirectMs = performance.now() - DirectStarted;
const Off = {...Counters};
Assert.ok(Object.values(Off).every(Value => Value === 0));
globalThis.chrome = {storage: {local: {
			get: async () =>
			{
				Counters.storageReads++;
				return {};
			}, set: () =>
			{
				Counters.storageWrites++;
			},
		}}, runtime: {sendMessage: () =>
		{
			Counters.messages++;
		}}};
try
{
	for (let Index = 0; Index < 10000; Index++)
	{
		await RecordDownloadLog('started', {downloadId: Index});
	}
}
finally
{
	delete globalThis.chrome;
}
Assert.equal(Counters.storageReads, 1);
Assert.equal(Counters.storageWrites, 0);
Log.SetEnabled(true);
for (let Index = 0; Index < Count; Index++)
{
	Log.Record('RequestStarted', Data);
}
Assert.equal(Counters.data, 1, 'the burst is throttled before lazy data evaluation');
Assert.equal(Log.Snapshot().length, 1);
Log.SetEnabled(false);
Assert.equal(Log.Snapshot().length, 0);
JSON.stringify = Serialize;
for (const [Name, Original] of Originals)
{
	if (Original === undefined)
	{
		delete globalThis[Name];
	}
	else
	{
		globalThis[Name] = Original;
	}
}
const Result = {node: process.version, iterations: Count, guardMs: GuardMs, directMs: DirectMs, off: Off,
	resultLoggingOff: {events: 10000, settingsReads: Counters.storageReads, storageWrites: Counters.storageWrites},
	onBurst: {events: Count, evaluations: Counters.data, outputs: Counters.sink, serializations: Counters.serialization},
	limitations: 'Node counters and synthetic sink; installed Chrome extension, native console cost and real-site traffic are not measured.'};
await Mkdir(ArtifactPath(), {recursive: true});
await WriteFile(ArtifactPath('debug-cost.json'), JSON.stringify(Result, null, 2));
console.log(JSON.stringify(Result));
