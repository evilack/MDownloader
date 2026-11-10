import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile} from 'node:fs/promises';
import * as Media from '../extension/vendor/mediabunny-1.65.2.mjs';

function Directory()
{
	const Files = new Map(), Directories = new Map();
	return {
		async *values() {}, async removeEntry() {},
		async getDirectoryHandle(Name)
		{
			if (!Directories.has(Name)) Directories.set(Name, Directory());
			return Directories.get(Name);
		},
		async getFileHandle(Name)
		{
			if (!Files.has(Name))
			{
				let Bytes = new Uint8Array();
				Files.set(Name, {getFile: async() => new Blob([Bytes]), createWritable: async() =>
				{
					let Position = 0;
					const Sink = {write(Value)
					{
						if (Value?.type === 'write') Position = Value.position;
						const Chunk = Value?.type === 'write' ? Value.data : Value;
						const Data = Chunk instanceof Uint8Array ? Chunk : new Uint8Array(Chunk);
						const Next = new Uint8Array(Math.max(Bytes.length, Position + Data.length));
						Next.set(Bytes); Next.set(Data, Position); Bytes = Next; Position += Data.length;
					}};
					const Stream = new WritableStream(Sink);
					Stream.write = Value => Promise.resolve(Sink.write(Value));
					return Stream;
				}});
			}
			return Files.get(Name);
		},
	};
}

// Derive independent fragmented tracks from the project's own sample; no remote fixture.
async function TrackResources()
{
	const Sample = await readFile(new URL('../website/sample/media/sample-film.mp4', import.meta.url));
	const Input = new Media.Input({source: new Media.BufferSource(Sample), formats: Media.ALL_FORMATS});
	const Resources = new Map();
	try
	{
		for (const Track of await Input.getTracks())
		{
			const Target = new Media.BufferTarget();
			const Output = new Media.Output({format: new Media.Mp4OutputFormat({fastStart: 'fragmented'}), target: Target});
			const Packets = Track.isVideoTrack() ? new Media.EncodedVideoPacketSource(await Track.getCodec())
				: new Media.EncodedAudioPacketSource(await Track.getCodec());
			if (Track.isVideoTrack()) Output.addVideoTrack(Packets); else Output.addAudioTrack(Packets);
			await Output.start();
			let First = true;
			for await (const Packet of new Media.EncodedPacketSink(Track).packets())
			{
				await Packets.add(Packet, First ? {decoderConfig: await Track.getDecoderConfig()} : undefined);
				First = false;
			}
			Packets.close(); await Output.finalize();
			const Bytes = Buffer.from(Target.buffer);
			let Offset = 0;
			while (Offset < Bytes.length && ['ftyp', 'moov'].includes(Bytes.toString('ascii', Offset + 4, Offset + 8)))
				Offset += Bytes.readUInt32BE(Offset);
			const Base = 'https://cdn.test/' + Track.type;
			Resources.set(Base + '-init.mp4', Bytes.subarray(0, Offset));
			Resources.set(Base + '-part.m4s', Bytes.subarray(Offset));
			Resources.set(Base + '.m3u8', '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MAP:URI="' + Track.type +
				'-init.mp4"\n#EXTINF:' + await Input.computeDuration() + ',\n' + Track.type + '-part.m4s\n#EXT-X-ENDLIST\n');
		}
		return Resources;
	}
	finally {Input.dispose();}
}

Test('the offscreen observed-rendition path authorizes and muxes its separately declared audio', async T =>
{
	const Resources = await TrackResources(), Listeners = [], Calls = [], Access = [];
	const PreviousStorage = navigator.storage, NativeFetch = globalThis.fetch;
	Object.defineProperty(navigator, 'storage', {value: {getDirectory: async() => Directory()}, configurable: true});
	T.after(() => {delete globalThis.chrome; Object.defineProperty(navigator, 'storage', {value: PreviousStorage, configurable: true});});
	T.mock.method(globalThis, 'fetch', async Url =>
	{
		Calls.push(String(Url)); Assert.ok(Resources.has(String(Url)), 'only declared media is requested: ' + Url);
		return new Response(Resources.get(String(Url)));
	});
	const Done = Promise.withResolvers(); let Saved, Failure;
	globalThis.chrome = {runtime: {id: 'test', getURL: Path => 'chrome-extension://test/' + Path,
		onMessage: {addListener: Listener => Listeners.push(Listener)}, async sendMessage(Message)
		{
			if (Message.action === 'access') Access.push(...Message.urls);
			if (Message.action === 'save') Saved = await (await NativeFetch(Message.objectUrl)).arrayBuffer();
			if (Message.action === 'saving') {Done.resolve(); return {ok: true, data: 'complete'};}
			if (Message.action === 'failure') {Failure = Message.error; Done.resolve();}
			return {ok: true};
		}}};
	await import('../extension/hls-runner.js?observed-audio');
	Listeners[0]({type: 'hlsRun', job: {requestId: 'observed-audio', url: 'https://cdn.test/video.m3u8',
		audioUrl: 'https://cdn.test/audio.m3u8'}}, {id: 'test', url: chrome.runtime.getURL('background.js')}, () => {});
	await Promise.race([Done.promise, new Promise((_, Reject) =>
	{
		const Timer = setTimeout(() => Reject(Error('offscreen audio test timed out')), 5000); Timer.unref();
	})]);
	Assert.equal(Failure, undefined);
	Assert.ok(Calls.includes('https://cdn.test/audio.m3u8'), 'the companion audio playlist is fetched');
	Assert.ok(Access.includes('https://cdn.test/audio.m3u8'), 'audio uses the worker permission check');
	Assert.equal(Calls.filter(Url => Url === 'https://cdn.test/video.m3u8').length, 1);
	const Input = new Media.Input({source: new Media.BufferSource(Saved), formats: Media.ALL_FORMATS});
	try
	{
		Assert.ok(await Input.getPrimaryVideoTrack());
		const Audio = await Input.getPrimaryAudioTrack(); Assert.ok(Audio);
		Assert.equal(await Audio.getCodec(), 'aac');
		Assert.ok(await new Media.EncodedPacketSink(Audio).getFirstPacket());
	}
	finally {Input.dispose();}
});
