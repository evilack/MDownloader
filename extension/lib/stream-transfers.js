import { DebugLog, ReportDebugFailure } from './debug-log.js';
/**
 * 오프스크린 문서 한 개 안의 여러 스트림 수명을 작업 ID별로 관리합니다.
 * 각 작업의 취소와 '중지 및 저장' 신호는 분리됩니다. 실행 함수가 저장까지 끝난 뒤에만
 * 해당 ID를 해제하므로, 다른 작업을 끝내거나 관리 목록에서 사라지게 하지 않습니다.
 */
export function CreateStreamTransfers(Run, UnexpectedFailure = ReportDebugFailure)
{
	const Entries = new Map();
	return {
		ids: () => [...Entries.keys()],
		start(Job)
		{
			if (Entries.has(Job.requestId))
			{
				return false;
			}
			const Entry = { controller: new AbortController(), finish: new AbortController(), playback: !!Job.playback };
			Entries.set(Job.requestId, Entry);
			if (DebugLog.IsEnabled())
			{
				DebugLog.Record('TransferStarted', () => ({ requestId: Job.requestId }));
			}
			void (async () =>
			{
				try
				{
					await Run(Job, Entry.controller, Entry.finish.signal);
				}
				catch (ErrorValue)
				{
					UnexpectedFailure(ErrorValue);
				}
				finally
				{
					if (Entries.get(Job.requestId) === Entry)
					{
						Entries.delete(Job.requestId);
					}
				}
			})();
			return true;
		},
		finish(RequestId)
		{
			const Entry = Entries.get(RequestId);
			if (!Entry || Entry.playback)
			{
				return false;
			}
			Entry.finish.abort();
			return true;
		},
		cancel(RequestId, Reason)
		{
			const Targets = RequestId === undefined ? [...Entries.values()].filter(Entry => !Entry.playback)
			: [Entries.get(RequestId)].filter(Boolean);
			for (const Entry of Targets)
			{
				Entry.controller.abort(Reason);
			}
			return Targets.length > 0;
		},
	};
}
