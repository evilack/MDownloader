import Assert from 'node:assert/strict';
import {readFile as ReadFile} from 'node:fs/promises';
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm';

// Chrome 서비스 워커와 같이 동적 import를 거절한 상태에서 실제 화질 조회 함수를
// 실행합니다. 일반 Node import로는 드러나지 않는 브라우저 제약을 재현합니다.
const CandidateCalls = [], PageCalls = [];
let Format = 'WEBRTC', Reply = {qualities: [{name: 'source', session: 'session', resolution: '1920x1080', bandwidth: 6000000}]};
class LocalizedError extends Error { constructor(Key) { super(Key); this.key = Key; } }
const Context = createContext({chrome: {scripting: {async executeScript(Options)
{
	PageCalls.push(Options);
	return [{documentId: 'document', result: Reply}];
}}}});
const Dependencies = new Map(Object.entries({
	'./hls-jobs.js': {EnsureRunner() {}, HlsRunnerUrl() {}},
	'./lib/webrtc-page.js': {WebRtcPageTask() {}},
	'./lib/webrtc-quality-task.js': {WebRtcQualityTask() {}},
	'./lib/runtime-policy.js': {RuntimePolicy: {}},
	'./lib/i18n.js': {LocalizedError, ReceivedError() {}},
	'./lib/youtube-source-policy.js': {AssertMediaAllowed() {}},
	'./lib/source-provider-data.js': {LoadSourceProviders() {}},
	'./lib/webrtc-descriptor.js': {RequireWebRtcConnection() {}},
	'./detection.js': {async ResolveCandidate(...Args)
	{
		CandidateCalls.push(Args);
		return {format: Format, documentId: 'document', page: 'https://player.test/live', trackId: 'actual-video'};
	}},
}));
const Module = new SourceTextModule(await ReadFile(new URL('../../extension/webrtc-jobs.js', import.meta.url), 'utf8'), {
	context: Context,
	importModuleDynamically() { throw new TypeError('import() is disallowed on ServiceWorkerGlobalScope'); },
});
await Module.link(Specifier =>
{
	const Values = Dependencies.get(Specifier);
	Assert.ok(Values, 'unexpected service-worker dependency: ' + Specifier);
	return new SyntheticModule(Object.keys(Values), function()
	{
		for (const [Key, Value] of Object.entries(Values)) this.setExport(Key, Value);
	}, {context: Context});
});
await Module.evaluate();
const Input = {tabId: 7, scanId: 'current-scan', candidateId: 2, scope: 'popup'};
const Qualities = await Module.namespace.WebRtcQualities(Input);
Assert.deepEqual(Qualities, Reply.qualities);
Assert.deepEqual(CandidateCalls, [[7, 'current-scan', 2, 'popup']]);
Assert.equal(PageCalls.length, 1);
Assert.equal(PageCalls[0].world, 'MAIN');
Assert.equal(PageCalls[0].target.tabId, 7);
Assert.deepEqual(Array.from(PageCalls[0].target.documentIds), ['document']);
Assert.equal(PageCalls[0].args[0].action, 'list');
Assert.equal(PageCalls[0].args[0].trackId, 'actual-video');
Format = 'M3U8';
await Assert.rejects(Module.namespace.WebRtcQualities(Input), {key: 'candidate_changed'});
Assert.equal(PageCalls.length, 1, 'other candidates cannot invoke WebRTC page quality controls');
Format = 'WEBRTC'; Reply = {error: 'webrtc_quality_unavailable'};
await Assert.rejects(Module.namespace.WebRtcQualities(Input), {key: 'webrtc_quality_unavailable'});
console.log('Service-worker WebRTC quality lookup passed with dynamic import disabled.');
