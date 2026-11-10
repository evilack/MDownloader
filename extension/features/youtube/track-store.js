import {PublishCaptionChunk,SealCaptionJournal} from '../../lib/caption-committed-input.js';
/** Committed chunks are never modified. Frozen Blob lists remain readable while
 * the receiver appends new files. The runner owns directory lifetime. */
export function CreateYoutubeTrackStore(Directory,{audioJournal:AudioJournal,sealReason:SealReason=()=> 'eof'}={})
{
	const Files = {video: [], audio: []};
	const Bytes = {video:0,audio:0};
	return {
		async writer(Kind)
		{
			let Index = 0, Closed = false;
			return {
				async write(Chunk)
				{
					if (Closed) throw new Error('Track writer closed');
					if(!Chunk.byteLength)return;
					const Handle = await Directory.getFileHandle(`${Kind}-${Index++}.chunk`, {create: true});
					const Writer = await Handle.createWritable();
					try { await Writer.write(Chunk); await Writer.close(); }
					catch (ErrorValue) { await Writer.abort().catch(() => {}); throw ErrorValue; }
					const File=await Handle.getFile(),Offset=Bytes[Kind];Bytes[Kind]+=File.size;
					Files[Kind].push(File);
					if(Kind==='audio')PublishCaptionChunk(AudioJournal,File,Files.audio.length-1,Offset);
				},
				async close() { Closed = true; if(Kind==='audio')SealCaptionJournal(AudioJournal,SealReason()); },
				async abort() { Closed = true; if(Kind==='audio')AudioJournal?.fail(new Error('caption_source_failed')); },
			};
		},
		snapshot: () => ({video: new Blob(Files.video), audio: new Blob(Files.audio)}),
	};
}
