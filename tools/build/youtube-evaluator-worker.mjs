import {Jinter} from 'jintr';
const Reply = globalThis.postMessage.bind(globalThis);
// 이 worker는 해석 전 네트워크/확장/저장소 기능을 제거합니다. CSP의 eval 금지도 유지합니다.
for (const Name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'Worker', 'SharedWorker', 'importScripts', 'chrome', 'browser', 'indexedDB', 'caches', 'navigator', 'FileReader', 'BroadcastChannel'])
{
	Object.defineProperty(globalThis, Name, {value: undefined, configurable: false, writable: false});
}
const Quiet = Object.freeze({log() {}, info() {}, warn() {}, error() {}, debug() {}});
globalThis.console = Quiet;
globalThis.onmessage = Event =>
{
	try
	{
		if (typeof Event.data?.script !== 'string' || new TextEncoder().encode(Event.data.script).length > 4 * 1024 * 1024) throw new Error();
		const Interpreter = new Jinter();
		Interpreter.scope.clear();
		Interpreter.defineObject('console', Quiet);
		for (const [Name, Value] of Object.entries({Object, Array, String, Number, Boolean, Math, Date, JSON, RegExp, Map, Set, Uint8Array, Error, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, Infinity, NaN, undefined})) Interpreter.defineObject(Name, Value);
		for (const [Name, Value] of Object.entries(Event.data.environment ?? {})) if (['sig', 'sp', 'n'].includes(Name) && typeof Value === 'string') Interpreter.scope.set(Name, Value);
		const Value = Interpreter.evaluate(Event.data.script);
		Reply({ok: true, value: {sig: Value?.sig, n: Value?.n}});
	}
	catch { Reply({ok: false}); }
};
