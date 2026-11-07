import {LocalizedError} from './i18n.js';

/** 원래 전송과 부분 저장의 취소 신호를 분리합니다. close는 이미 시작한
 * 부분 저장이 원본 임시 파일을 모두 읽을 때까지 기다린 뒤 소유권을 해제합니다.
 */
export function CreateTransferSnapshots(Run)
{
	const Entries = new Map();
	return {
		register(Id, Read)
		{
			if (Entries.has(Id))
			{
				throw new LocalizedError('job_snapshot_busy');
			}
			Entries.set(Id, {read: Read});
		},
		ids: () => [...Entries.values()].filter(Entry => Entry.pending).map(Entry => Entry.id),
		async save(ParentId, Job)
		{
			const Entry = Entries.get(ParentId);
			if (!Entry || Entry.closing)
			{
				throw new LocalizedError('job_snapshot_unavailable');
			}
			if (Entry.pending)
			{
				throw new LocalizedError('job_snapshot_busy');
			}
			const Snapshot = Entry.read();
			if (!Snapshot)
			{
				throw new LocalizedError('job_snapshot_unavailable');
			}
			Entry.id = Job.requestId;
			Entry.controller = new AbortController();
			Entry.pending = Promise.resolve().then(() => Run(Job, Snapshot, Entry.controller.signal));
			try
			{
				return await Entry.pending;
			}
			finally
			{
				Entry.pending = undefined;
				Entry.controller = undefined;
				Entry.id = undefined;
			}
		},
		cancel(Id)
		{
			const Entry = [...Entries.values()].find(Value => Value.id === Id);
			Entry?.controller?.abort();
			return !!Entry;
		},
		async close(Id)
		{
			const Entry = Entries.get(Id);
			if (!Entry)
			{
				return;
			}
			Entry.closing = true;
			await Entry.pending?.catch(() =>
			{
			});
			if (Entries.get(Id) === Entry)
			{
				Entries.delete(Id);
			}
		},
	};
}
