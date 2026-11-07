/**
 * 동적 관측 스크립트 등록의 공통 트랜잭션입니다. 호출 순서대로 Chrome의 현재 등록을
 * 다시 읽으므로 빠른 권한 변경도 오래된 스냅샷으로 덮지 않습니다. 호출자는 스크립트
 * 역할만 선언하며 MAIN/ISOLATED, 실행 시점, 프레임·파일 계약 전체를 비교합니다.
 */
import { GrantedHttpPatterns } from './host-permissions.js';
import { DebugLog } from './debug-log.js';
export function CreateContentScriptSync(Scripts, GetApi = () => chrome)
{
	let Pending = Promise.resolve();
	const Ids = Scripts.map(Script => Script.id);
	return function Sync()
	{
		const Update = Pending.catch(() =>
		{
		}).then(async () =>
		{
			const Api = typeof GetApi === 'function' ? GetApi() : GetApi;
			const [Granted, Registered] = await Promise.all([
				Api.permissions.getAll(), Api.scripting.getRegisteredContentScripts({ ids: Ids }),
			]);
			const Matches = GrantedHttpPatterns(Granted.origins);
			if (!Matches.length)
			{
				if (Registered.length)
				{
					await Api.scripting.unregisterContentScripts({ ids: Registered.map(Script => Script.id) });
				}
				if (DebugLog.IsEnabled())
				{
					DebugLog.Record('ContentScriptsSynced', () => ({ removed: Registered.length }));
				}
				return;
			}
			const Missing = [], Changed = [];
			for (const Script of Scripts)
			{
				const Current = Registered.find(Entry => Entry.id === Script.id);
				const Next = { allFrames: true, runAt: 'document_start', world: 'ISOLATED', ...Script, matches: Matches };
				if (!Current)
				{
					Missing.push(Next);
				}
				else if (Current.allFrames !== Next.allFrames || Current.runAt !== Next.runAt ||
				(Current.world ?? 'ISOLATED') !== Next.world ||
				JSON.stringify(Current.js) !== JSON.stringify(Next.js) ||
				JSON.stringify(Current.matches.toSorted()) !== JSON.stringify(Matches))
				{
					Changed.push(Next);
				}
			}
			if (Missing.length)
			{
				await Api.scripting.registerContentScripts(Missing);
			}
			if (Changed.length)
			{
				await Api.scripting.updateContentScripts(Changed);
			}
			if (DebugLog.IsEnabled())
			{
				DebugLog.Record('ContentScriptsSynced', () => ({ registered: Missing.length, changed: Changed.length }));
			}
		});
		Pending = Update;
		return Update;
	};
}
