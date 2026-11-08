/** Committed chunks are never modified. Frozen Blob lists remain readable while
 * the receiver appends new files. The runner owns directory lifetime. */
export function CreateYoutubeTrackStore(Directory)
{
	const Files = {video: [], audio: []};
	return {
		async writer(Kind)
		{
			let Index = 0, Closed = false;
			return {
				async write(Chunk)
				{
					if (Closed) throw new Error('Track writer closed');
					const Handle = await Directory.getFileHandle(`${Kind}-${Index++}.chunk`, {create: true});
					const Writer = await Handle.createWritable();
					try { await Writer.write(Chunk); await Writer.close(); }
					catch (ErrorValue) { await Writer.abort().catch(() => {}); throw ErrorValue; }
					Files[Kind].push(await Handle.getFile());
				},
				async close() { Closed = true; },
				async abort() { Closed = true; },
			};
		},
		snapshot: () => ({video: new Blob(Files.video), audio: new Blob(Files.audio)}),
	};
}
