import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {CreateRecordingSink, CreateRecordingStore, IsRecordingMessage} from '../extension/lib/webrtc-recording.js';

Test('recording messages are restricted to the exact source document and session', () =>
{
	const Current = {requestId: 'recording', token: 'secret', documentId: 'doc', page: 'https://player.test/live'};
	const Sender = {id: 'extension', tab: {id: 7}, documentId: 'doc', frameId: 0, url: 'https://player.test/live'};
	const Message = {type: 'webrtcRecordingData', requestId: 'recording', token: 'secret'};
	Assert.equal(IsRecordingMessage(Message, Sender, Current, 'extension', 7), true);
	for (const Changed of [{id: 'other'}, {tab: {id: 8}}, {documentId: 'other'}, {frameId: 1}, {url: 'https://player.test/other'}])
		Assert.equal(IsRecordingMessage(Message, {...Sender, ...Changed}, Current, 'extension', 7), false);
	Assert.equal(IsRecordingMessage({...Message, token: 'wrong'}, Sender, Current, 'extension', 7), false);
	Assert.equal(IsRecordingMessage(Message, Sender, {...Current, finishing: Promise.resolve()}, 'extension', 7), false);
});

Test('recording sink preserves byte order through concurrent messages and closes only after writes', async () =>
{
	const Chunks = [];
	let Closed = false;
	const Sink = CreateRecordingSink({async write(Bytes)
	{
		await new Promise(Resolve => setImmediate(Resolve));
		Assert.equal(Closed, false);
		Chunks.push(...Bytes);
	}, async close() { Closed = true; }}, {maxBytes: 20, maxChunkBytes: 8});
	await Promise.all([Sink.append(0, 'AAEC'), Sink.append(1, 'A/8=')]);
	Assert.deepEqual(await Sink.finish(2), {bytes: 5, count: 2});
	Assert.deepEqual(Chunks, [0, 1, 2, 3, 255]);
	Assert.equal(Closed, true);
	await Assert.rejects(Sink.append(2, 'AA=='));
});

Test('recording sink refuses gaps, malformed data and oversized chunks before writing', async () =>
{
	let Written = 0;
	const Sink = CreateRecordingSink({async write() { Written++; }, async close() {}}, {maxBytes: 5, maxChunkBytes: 3});
	await Assert.rejects(Sink.append(1, 'AA=='));
	await Assert.rejects(Sink.append(0, '*bad*'));
	await Assert.rejects(Sink.append(0, 'AAECAw=='));
	Assert.equal(Written, 0);
	await Sink.append(0, 'AAEC');
	await Assert.rejects(Sink.append(1, 'AwQF'));
	Assert.equal(Written, 1);
	await Assert.rejects(Sink.finish(2));
	Assert.deepEqual(await Sink.finish(1), {bytes: 3, count: 1});
});

Test('recording sink retains a write error and never acknowledges following bytes', async () =>
{
	let Written = 0;
	const Sink = CreateRecordingSink({async write() { Written++; throw new Error('disk full'); }, async close() {}}, {maxBytes: 20, maxChunkBytes: 8});
	await Assert.rejects(Sink.append(0, 'AA=='), /disk full/);
	await Assert.rejects(Sink.append(0, 'AQ=='), /disk full/);
	await Assert.rejects(Sink.finish(0), /disk full/);
	Assert.equal(Written, 1);
});

Test('source loss drains pending writes without requiring an obsolete received count', async () =>
{
	const Written = [];
	const Sink = CreateRecordingSink({async write(Bytes)
	{
		await new Promise(Resolve => setImmediate(Resolve));
		Written.push(...Bytes);
	}, async close() {}}, {maxBytes: 20, maxChunkBytes: 8});
	const Pending = Sink.append(0, 'AAEC');
	const Finished = Sink.finish();
	await Pending;
	Assert.deepEqual(await Finished, {bytes: 3, count: 1});
	Assert.deepEqual(Written, [0, 1, 2]);
});

Test('each acknowledged recording chunk survives a later disk write failure', async () =>
{
	const Files = new Map();
	const Directory = {async getFileHandle(Name)
	{
		return {async createWritable()
		{
			let Data;
			return {async write(Bytes) { if (Files.size === 1) throw new Error('disk full'); Data = Bytes; },
				async close() { Files.set(Name, new Blob([Data])); }, async abort() {}};
		}, async getFile() { return Files.get(Name); }};
	}, async removeEntry(Name) { Files.delete(Name); }};
	const Store = CreateRecordingStore(Directory);
	const Sink = CreateRecordingSink(Store, {maxBytes: 20, maxChunkBytes: 8});
	await Sink.append(0, 'AAEC');
	Assert.equal(Files.size, 1, 'successful data must be committed before acknowledgement');
	await Assert.rejects(Sink.append(1, 'AwQF'), /disk full/);
	Assert.equal(Store.bytes, 3);
	Assert.deepEqual([...new Uint8Array(await (await Store.file('video/mp4')).arrayBuffer())], [0, 1, 2]);
});
