import {CreateRecordingSink, IsRecordingMessage} from './webrtc-recording.js';
import {RuntimePolicy} from './runtime-policy.js';
import {LocalizedError, SerializeError} from './i18n.js';

/** 기존 오프스크린 문서에서 WebRTC 수신·저장 수명을 관리합니다. 팝업/관리자 수명과 무관합니다. */
export function CreateWebRtcTransfers({extensionId, createStore, report, saveFile, release, snapshots, prepareJob})
{
	const Entries = new Map(), Preparing = new Map();
	function Report(Entry, Action, Fields)
	{
		const Next = (Entry.reportTail ?? Promise.resolve()).then(() => report(Entry.requestId, Action, Fields));
		Entry.reportTail = Next.catch(() => {});
		return Next;
	}
	async function Finish(Id, Count, Reason)
	{
		const Entry = Entries.get(Id);
		if (!Entry) return false;
		if (Entry.finishing) return Entry.finishing;
		Entry.phase = 'finishing';
		Entry.finishing = (async () =>
		{
			const Signal = Entry.controller.signal;
			try
			{
				let Partial = Reason !== 'requested';
				try { await Entry.sink.finish(Count); }
				catch (ErrorValue) { if (!Entry.store.bytes) throw ErrorValue; Partial = true; }
				Signal.throwIfAborted();
				if (!Entry.store.bytes) throw new LocalizedError('webrtc_empty');
				const Filename = await Report(Entry, 'recordingFormat', {mimeType: Entry.job.mimeType, partial: Partial, reason: Reason});
				await Report(Entry, 'progress', {received: Entry.store.bytes, finished: Entry.count, live: true, muxing: true});
				const File = await Entry.store.file(Entry.job.mimeType);
				await saveFile({...Entry.job, filename: Filename}, File, Signal);
			}
			catch (ErrorValue)
			{
				await Report(Entry, 'failure', {canceled: Signal.aborted,
					error: Signal.aborted ? undefined : SerializeError(ErrorValue, 'webrtc_recording_failed')}).catch(() => {});
			}
			finally
			{
				// 강제 종료도 이미 시작한 쓰기가 끝난 후 이 작업 폴더만 정리합니다.
				await Entry.sink.finish().catch(() => {});
				// 별도 저장의 취소/완료 신호는 원본과 독립적입니다. 해당 읽기가 끝나기
				// 전에는 원본 조각 폴더를 제거하지 않습니다.
				await snapshots?.close(Id);
				await release(Id).catch(() => {});
				Entries.delete(Id);
			}
			return true;
		})();
		return Entry.finishing;
	}
	return {
		ids: () => [...Entries.keys()],
		prepare(Job)
		{
			if (Entries.has(Job.requestId) || Preparing.has(Job.requestId)) throw new LocalizedError('webrtc_busy');
			const Pending = {canceled: false, controller: new AbortController()};
			Preparing.set(Job.requestId, Pending);
			Pending.promise = (async () =>
			{
				try
				{
					await prepareJob?.(Job, Pending.controller.signal);
					Pending.controller.signal.throwIfAborted();
					const Store = await createStore(Job);
					const Entry = {job: Job, ...Job, store: Store, phase: 'recording', count: 0, controller: Pending.controller,
						sink: CreateRecordingSink(Store, {maxBytes: RuntimePolicy.Transfer.MaxScratchBytes, maxChunkBytes: 192 * 1024})};
					Entries.set(Job.requestId, Entry);
					snapshots?.register(Job.requestId, () =>
					{
						if (Entry.phase !== 'recording' || !Entry.count || !Store.bytes) return null;
						return {subtitleTracks: Job.subtitleTracks, recording: {readFile: Store.snapshot(Job.mimeType),
							format: Job.mimeType.startsWith('video/mp4') ? 'MP4' : 'WEBM'}};
					});
					if (Pending.canceled)
					{
						Entry.controller.abort();
						await Finish(Job.requestId, undefined, 'canceled');
						throw new DOMException('Canceled', 'AbortError');
					}
					return true;
				}
				finally { Preparing.delete(Job.requestId); }
			})();
			return Pending.promise;
		},
		async accept(Message, Sender)
		{
			const Entry = Entries.get(Message.requestId);
			if (!Entry || Entry.background || !IsRecordingMessage(Message, Sender, Entry, extensionId, Entry.tabId)) return {ok: false};
			if (Message.heartbeat) return {ok: true};
			if (Message.end) { void Finish(Message.requestId, Message.count, Message.reason); return {ok: true}; }
			try
			{
				const Result = await Entry.sink.append(Message.sequence, Message.data);
				Entry.count = Result.count;
				await Report(Entry, 'progress', {received: Result.bytes, finished: Result.count, live: true,
					snapshotAvailable: !!snapshots && Entry.phase === 'recording'});
				return {ok: true};
			}
			catch { return {ok: false}; }
		},
		finish: Finish,
		async appendBlob(Id, BlobValue)
		{
			const Entry = Entries.get(Id);
			if (!Entry || Entry.phase !== 'recording') throw new LocalizedError('webrtc_receiver_lost');
			for (let Offset = 0; Offset < BlobValue.size; Offset += 192 * 1024)
			{
				const Chunk = new Uint8Array(await BlobValue.slice(Offset, Offset + 192 * 1024).arrayBuffer());
				Entry.controller.signal.throwIfAborted();
				const Result = await Entry.sink.appendBytes(Entry.count, Chunk);
				Entry.count = Result.count;
				await Report(Entry, 'progress', {received: Result.bytes, finished: Result.count, live: true,
					snapshotAvailable: !!snapshots && Entry.phase === 'recording'});
			}
		},
		sourceLost(TabId, Page) { return Promise.all([...Entries.values()].filter(Entry => !Entry.background && Entry.tabId === TabId && (!Page || Entry.page !== Page))
			.map(Entry => Finish(Entry.requestId, undefined, 'webrtc_source_changed'))); },
		async cancel(Id)
		{
			const Pending = Preparing.get(Id);
			if (Pending) { Pending.canceled = true; Pending.controller.abort(); await Pending.promise.catch(() => {}); }
			const Entry = Entries.get(Id);
			if (!Entry) return !!Pending;
			Entry.controller.abort();
			await Finish(Id, undefined, 'canceled');
			return true;
		},
	};
}
