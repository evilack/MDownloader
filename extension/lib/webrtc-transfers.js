import {CreateRecordingSink, IsRecordingMessage} from './webrtc-recording.js';
import {RuntimePolicy} from './runtime-policy.js';
import {LocalizedError, SerializeError} from './i18n.js';

/** 기존 오프스크린 문서에서 WebRTC 수신·저장 수명을 관리합니다. 팝업/관리자 수명과 무관합니다. */
export function CreateWebRtcTransfers({extensionId, createStore, report, saveFile, release})
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
				let Partial = !['requested', 'ended'].includes(Reason);
				try { await Entry.sink.finish(Count); }
				catch (ErrorValue) { if (!Entry.store.bytes) throw ErrorValue; Partial = true; }
				Signal.throwIfAborted();
				if (!Entry.store.bytes) throw new LocalizedError('webrtc_empty');
				const Filename = await Report(Entry, 'recordingFormat', {mimeType: Entry.job.mimeType, partial: Partial});
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
			const Pending = {canceled: false};
			Preparing.set(Job.requestId, Pending);
			Pending.promise = (async () =>
			{
				try
				{
					const Store = await createStore(Job);
					const Entry = {job: Job, ...Job, store: Store, phase: 'recording', count: 0, controller: new AbortController(),
						sink: CreateRecordingSink(Store, {maxBytes: RuntimePolicy.Transfer.MaxScratchBytes, maxChunkBytes: 192 * 1024})};
					Entries.set(Job.requestId, Entry);
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
			if (!Entry || !IsRecordingMessage(Message, Sender, Entry, extensionId, Entry.tabId)) return {ok: false};
			if (Message.heartbeat) return {ok: true};
			if (Message.end) { void Finish(Message.requestId, Message.count, Message.reason); return {ok: true}; }
			try
			{
				const Result = await Entry.sink.append(Message.sequence, Message.data);
				Entry.count = Result.count;
				await Report(Entry, 'progress', {received: Result.bytes, finished: Result.count, live: true});
				return {ok: true};
			}
			catch { return {ok: false}; }
		},
		finish: Finish,
		sourceLost(TabId, Page) { return Promise.all([...Entries.values()].filter(Entry => Entry.tabId === TabId && (!Page || Entry.page !== Page))
			.map(Entry => Finish(Entry.requestId, undefined, 'webrtc_source_changed'))); },
		async cancel(Id)
		{
			const Pending = Preparing.get(Id);
			if (Pending) { Pending.canceled = true; await Pending.promise.catch(() => {}); }
			const Entry = Entries.get(Id);
			if (!Entry) return !!Pending;
			Entry.controller.abort();
			await Finish(Id, undefined, 'canceled');
			return true;
		},
	};
}
