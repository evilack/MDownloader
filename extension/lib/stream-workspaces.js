import { DebugLog } from './debug-log.js';
/**
 * 전송 임시 폴더의 소유권을 분리합니다. 새 오프스크린 문서가 시작할 때 남은 폴더를 한 번만
 * 정리한 후 작업 ID별 하위 폴더를 만듭니다. 새 작업을 시작할 때 실행 중인 다른 작업의
 * 폴더를 지우지 않습니다. release는 MP4를 브라우저가 끝까지 읽은 후 호출해야 합니다.
 */
export function CreateStreamWorkspaces(Name, GetRoot = () => navigator.storage.getDirectory())
{
	let Initializing;
	function Root()
	{
		if (!Initializing)
		{
			Initializing = (async () =>
			{
				const Storage = await GetRoot();
				const Scratch = await Storage.getDirectoryHandle(Name, { create: true });
				for await (const Entry of Scratch.values())
				{
					await Scratch.removeEntry(Entry.name, { recursive: true });
				}
				return Scratch;
			})();
		}
		return Initializing;
	}
	return {
		async create(RequestId)
		{
			if (DebugLog.IsEnabled())
			{
				DebugLog.Record('WorkspaceCreated', () => ({ requestId: RequestId }));
			}
			return (await Root()).getDirectoryHandle(RequestId, { create: true });
		},
		async release(RequestId)
		{
			if (DebugLog.IsEnabled())
			{
				DebugLog.Record('WorkspaceReleased', () => ({ requestId: RequestId }));
			}
			await (await Root()).removeEntry(RequestId, { recursive: true }).catch(() =>
			{
			});
		},
	};
}
