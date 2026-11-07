import {WriteMediaArtifact} from './helpers/media-artifacts.mjs';
import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile as ReadFile} from 'node:fs/promises';
import {ReadFilePrefix, ReadMp4Metadata} from '../extension/lib/partial-file.js';
import {RemuxFilePrefix} from '../extension/lib/partial-remux.js';
import {Input, BlobSource, BufferSource, ALL_FORMATS} from '../extension/vendor/mediabunny-1.65.2.mjs';
Test('saves complete MP4 packets from a prefix while fetching only tail metadata', async T =>
{
	const Bytes = await ReadFile(new URL('../website/sample/media/sample-film.mp4', import.meta.url));
	const Requested = [];
	T.mock.method(globalThis, 'fetch', async(_url, Options) =>
	{
		const Range = /bytes=(\d+)-(\d+)/.exec(Options.headers.Range);
		const Start = Number(Range[1]), End = Number(Range[2]);
		Requested.push([Start, End]);
		return new Response(Bytes.subarray(Start, End + 1), {status: 206, headers: {'Content-Range': `bytes ${Start}-${End}/${Bytes.length}`, ETag: '"sample"'}});
	});
	let Stored;
	const Workspace = {getFileHandle: async() => ({getFile: async() => new Blob([Stored]), createWritable: async() => ({write: async Value =>
				{
					Stored = new Uint8Array(Value);
				}, close: async() =>
				{
				}, abort: async() =>
				{
				}})})};
	const Prefix = await ReadFilePrefix({url: 'https://file.test/movie.mp4', bytes: 120000, totalBytes: Bytes.length}, Workspace, new AbortController().signal);
	const Chunks = [];
	const Result = await RemuxFilePrefix(Prefix, 'MP4', new WritableStream({write(Value)
		{
			Chunks.push(Value);
		}}), new AbortController().signal);
	Assert.equal(Result.extension, '.mp4');
	const Total = Math.max(...Chunks.map(C => C.position + C.data.length));
	const Output = new Uint8Array(Total);
	for (const C of Chunks)
	{
		Output.set(C.data, C.position);
	}
	const input = new Input({source: new BlobSource(new Blob([Output])), formats: ALL_FORMATS});
	await WriteMediaArtifact('direct-partial.mp4', Output);
	try
	{
		Assert.equal((await input.getTracks()).length, 2);
		const Duration = await input.computeDuration();
		Assert.ok(Duration > 1 && Duration < 10);
		for (const Track of await input.getTracks())
		{
			Assert.ok(await Track.computeDuration() > 1, 'both video and audio must contain the received portion');
		}
		Assert.ok(Requested.slice(1).every(([Start]) => Start >= 226707), 'metadata reads must skip unreceived mdat payload');
	}
	finally
	{
		input.dispose();
	}
});
Test('remuxes an incomplete MKV without changing its video and audio codecs', async() =>
{
	const Original = await ReadFile(new URL('../website/sample/media/sample-film.mp4', import.meta.url));
	async function Remux(Prefix, Format)
	{
		const Chunks = [];
		const Result = await RemuxFilePrefix(Prefix, Format, new WritableStream({write(Value)
			{
				Chunks.push(Value);
			}}), new AbortController().signal);
		const Bytes = new Uint8Array(Math.max(...Chunks.map(C => C.position + C.data.length)));
		for (const Chunk of Chunks)
		{
			Bytes.set(Chunk.data, Chunk.position);
		}
		return{bytes: Bytes, ...Result};
	}
	const Full = await Remux({file: new Blob([Original]), total: Original.length}, 'MKV');
	Assert.equal(Full.extension, '.mkv');
	const Partial = await Remux({file: new Blob([Full.bytes.slice(0, Math.floor(Full.bytes.length / 2))]), total: Full.bytes.length}, 'MKV');
	const input = new Input({source: new BufferSource(Partial.bytes), formats: ALL_FORMATS});
	try
	{
		Assert.equal((await input.getTracks()).length, 2);
		Assert.ok(await input.computeDuration() > 1);
		Assert.ok(await input.computeDuration() < 10);
		Assert.equal(await(await input.getPrimaryVideoTrack()).getCodec(), 'avc');
	}
	finally
	{
		input.dispose();
	}
	await WriteMediaArtifact('direct-partial.mkv', Partial.bytes);
});
Test('stops a server that ignores Range at the requested prefix and rejects changed metadata', async T =>
{
	let Bytes;
	let bCanceled = false;
	const Workspace = {getFileHandle: async() => ({getFile: async() => new Blob([Bytes]), createWritable: async() => ({write: async Value =>
				{
					Bytes = new Uint8Array(Value);
				}, close: async() =>
				{
				}, abort: async() =>
				{
				}})})};
	T.mock.method(globalThis, 'fetch', async() => new Response(new ReadableStream({start(Stream)
		{
			Stream.enqueue(new Uint8Array(20));
		}, cancel()
		{
			bCanceled = true;
		}}), {headers: {'Content-Length': '20', ETag: '"old"'}}));
	const Signal = new AbortController();
	const Prefix = await ReadFilePrefix({url: 'https://file.test/file.mp4', bytes: 10, totalBytes: 20}, Workspace, Signal.signal);
	Assert.equal(Prefix.file.size, 10);
	Assert.equal(bCanceled, true);
	Assert.equal(Signal.signal.aborted, false);
	const Header = new Uint8Array(8);
	new DataView(Header.buffer).setUint32(0, 8);
	Header.set([109, 111, 111, 118], 4);
	T.mock.method(globalThis, 'fetch', async() => new Response(Header, {status: 206, headers: {'Content-Range': 'bytes 0-7/20', ETag: '"new"'}}));
	await Assert.rejects(ReadMp4Metadata({...Prefix, file: new Blob([])}, Signal.signal), {key: 'job_snapshot_source_changed'});
	Assert.equal(Signal.signal.aborted, false);
});
