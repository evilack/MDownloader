import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile as ReadFile} from 'node:fs/promises';
import {DescribeSubtitleTracks} from '../extension/lib/download-options-selection.js';
import {InspectMp4Subtitles} from '../tools/lib/inspect-mp4-subtitles.mjs';
import {createHash} from 'node:crypto';

function MemoryDirectory(Name = 'root')
{
	const Entries = new Map();
	return {name: Name, async *values() {yield* Entries.values();}, async removeEntry(Key) {Entries.delete(Key);},
		async getDirectoryHandle(Key) {if (!Entries.has(Key)) Entries.set(Key, MemoryDirectory(Key)); return Entries.get(Key);},
		async getFileHandle(Key)
		{
			if (!Entries.has(Key))
			{
				let Bytes = new Uint8Array();
				Entries.set(Key, {name: Key, getFile: async() => new Blob([Bytes]), createWritable: async() =>
				{
					let Position = 0;
					const Sink = {write(Value)
					{
						const Chunk = Value?.type === 'write' ? Value.data : Value;
						if (Value?.type === 'write') Position = Value.position;
						const Data = Chunk instanceof Uint8Array ? Chunk : new Uint8Array(Chunk);
						const Next = new Uint8Array(Math.max(Bytes.length, Position + Data.length));
						Next.set(Bytes); Next.set(Data, Position); Bytes = Next; Position += Data.length;
					}};
					const Stream = new WritableStream(Sink);
					Stream.write = Value => Promise.resolve(Sink.write(Value));
					return Stream;
				}});
			}
			return Entries.get(Key);
		}};
}

for (const {Enabled, Filter} of [{Enabled:false,Filter:false},{Enabled:true,Filter:false},{Enabled:false,Filter:true}]) Test('offscreen subtitle transfer translation=' + Enabled + ' selected-only=' + Filter, async T =>
{
	const Root = MemoryDirectory(), Listeners = [], Calls = [], SubtitleStates = [];
	const Sample = await ReadFile(new URL('../website/sample/media/sample-film.mp4', import.meta.url));
	const NativeFetch = globalThis.fetch;
	let Saved, PartialSaved, ContinueVideo, ParentProgress;
	const ProgressReady = new Promise(Resolve => {ParentProgress = Resolve;});
	let Finish, Reject;
	const Done = new Promise((Resolve, Fail) => {Finish = Resolve; Reject = Fail;});
	Done.catch(() => {});
	const PreviousStorage = navigator.storage;
	Object.defineProperty(navigator, 'storage', {value: {getDirectory: async() => Root}, configurable: true});
	T.after(() => {delete globalThis.chrome; Object.defineProperty(navigator, 'storage', {value: PreviousStorage, configurable: true});});
	T.mock.method(globalThis, 'fetch', async (Url, Options) =>
	{
		if (String(Url).startsWith('blob:')) return NativeFetch(Url);
		Calls.push(String(Url));
		if (String(Url).includes('translation.googleapis.com')) return new Response(JSON.stringify({data:{translations:[{translatedText:'번역 자막'}]}}));
		if (String(Url).endsWith('.mp4'))
		{
			const Range = /bytes=(\d+)-(\d+)/.exec(Options?.headers?.Range ?? '');
			if (Range)
			{
				const Start = Number(Range[1]), End = Number(Range[2]);
				return new Response(Sample.subarray(Start, End + 1), {status: 206,
					headers: {'content-range': `bytes ${Start}-${End}/${Sample.length}`, ETag: '"same-video"'}});
			}
			return new Response(new ReadableStream({start(Controller)
			{
				Controller.enqueue(Sample.subarray(0, 120000));
				ContinueVideo = () => {Controller.enqueue(Sample.subarray(120000)); Controller.close();};
			}}), {headers: {'content-type': 'video/mp4', 'content-length': String(Sample.length)}});
		}
		return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nCaption\n');
	});
	// Offscreen documents expose runtime only, never chrome.storage.
	globalThis.chrome = {runtime: {id: 'test', getURL: Path => 'chrome-extension://test/' + Path,
		onMessage: {addListener: Callback => Listeners.push(Callback)}, async sendMessage(Message)
		{
			if (Message.type === 'subtitleTranslationConfiguration') return {ok: true, data: {enabled: Enabled,provider:'google',targetLanguage:'ko',providers:{google:{key:'test-only'}}}};
			if (Message.action === 'subtitleStatus') SubtitleStates.push(structuredClone(Message.status));
			if (Message.action === 'subtitleReady') return {ok: true, data: 'player_test_clip.mp4'};
			if (Message.action === 'progress' && Message.requestId === 'caption-runner' && !Message.muxing) ParentProgress();
			if (Message.action === 'save')
			{
				const Buffer = await (await NativeFetch(Message.objectUrl)).arrayBuffer();
				if (Message.requestId === 'caption-child') PartialSaved = Buffer; else Saved = Buffer;
			}
			if (Message.action === 'saving') {if (Message.requestId === 'caption-runner') Finish(); return {ok: true, data: 'complete'};}
			if (Message.action === 'failure') Reject(new Error(JSON.stringify(Message.error)));
			return {ok: true};
		}}};
	await import('../extension/hls-runner.js?translation=' + Enabled + '&filter=' + Filter);
	let Reply;
	const Sources = [
		{url: 'https://captions.test/en.vtt', language: 'en', label: 'English'},
		{url: 'https://captions.test/ja.vtt', language: 'ja', label: 'Japanese'},
	];
	const Ids = await DescribeSubtitleTracks(Sources);
	Listeners[0]({type: 'folderRun', job: {requestId: 'caption-runner', url: 'https://cdn.test/clip.mp4', subtitles: Sources,
		...(Filter ? {subtitleOptions:{trackIds:[Ids[1].id],translation:{enabled:false}}} : {})}}, {id: 'test', url: chrome.runtime.getURL('background.js')}, Value => {Reply = Value;});
	Assert.deepEqual(Reply, {ok: true});
	await Promise.race([ProgressReady, Done]);
	const PartialReply = await new Promise(Resolve => Listeners[0]({type: 'hlsSnapshot', parentId: 'caption-runner',
		job: {requestId: 'caption-child', filename: 'partial.mp4', snapshot: true, subtitleCount: 2},
		source: {url: 'https://cdn.test/clip.mp4', bytes: 120000, totalBytes: Sample.length, format: 'MP4'}},
		{id: 'test', url: chrome.runtime.getURL('background.js')}, Resolve));
	Assert.deepEqual(PartialReply, {ok: true});
	Assert.equal([...Buffer.from(PartialSaved).toString('latin1').matchAll(/tx3g/g)].length, Filter ? 1 : Enabled ? 3 : 2,
		'the concurrent current-save retains both prepared captions');
	ContinueVideo();
	await Promise.race([Done, new Promise((_, Fail) => {const Timer = setTimeout(() => Fail(new Error('offscreen subtitle save timed out')), 5000); Timer.unref();})]);
	Assert.ok(Saved.byteLength > Sample.byteLength);
	Assert.deepEqual(SubtitleStates.map(Status => Status.phase), Filter ? ['collecting','collecting','ready'] : Enabled ? ['collecting','collecting','collecting','ready','ready'] : ['collecting','collecting','collecting','ready']);
	Assert.deepEqual(SubtitleStates.filter(Status=>Status.phase==='collecting').map(Status=>Status.completed),Filter ? [0,1] : [0,1,2]);
	Assert.equal(SubtitleStates.at(-1).translation, Enabled ? 'complete' : 'off');
	if (Enabled) Assert.equal(SubtitleStates.at(-2).translation,'translating');
	const Text = Buffer.from(Saved).toString('latin1');
	Assert.equal([...Text.matchAll(/tx3g/g)].length, Filter ? 1 : Enabled ? 3 : 2);
	const Inspected=InspectMp4Subtitles(Buffer.from(Saved));
	Assert.deepEqual(Inspected.map(T=>T.language).sort(),(Filter?['jpn']:Enabled?['eng','jpn','kor']:['eng','jpn']).sort());
	Assert.ok(Inspected.every(T=>T.nonemptySamples>0 && T.lastEndMs<=2000));
	if(Enabled) Assert.equal(Inspected.find(T=>T.language==='kor').linesHash,createHash('sha256').update(JSON.stringify(['번역 자막'])).digest('hex'));
	Assert.deepEqual(new Set(Calls), new Set(['https://cdn.test/clip.mp4', ...(!Filter ? ['https://captions.test/en.vtt'] : []), 'https://captions.test/ja.vtt', ...(Enabled ? ['https://translation.googleapis.com/language/translate/v2'] : [])]));
});
