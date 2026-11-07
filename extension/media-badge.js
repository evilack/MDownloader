/**
 * 툴바 배지에는 현재 탭의 다운로드 가능 항목 수를 표시합니다. 팝업에서 이미 검사한 결과는 재사용하고, 탭 이동 전에 시작한 읽기가 늦게 완료되면 버립니다.
 */
import { RuntimePolicy } from './lib/runtime-policy.js';
import { FindMedia } from './detection.js';
import { HostPattern } from './lib/media.js';
const BadgeColor = { background: '#d0273a', text: '#ffffff' };
const Updates = new Map();
const CountMedia = Items => Items?.filter(Item => Item.supported).length ?? 0;
async function UpdateBadge(TabId, ReadCount)
{
	const Revision = Symbol();
	Updates.set(TabId, Revision);
	const IsCurrent = () => Updates.get(TabId) === Revision;
	try
	{
		const Count = await ReadCount(IsCurrent);
		// 배지는 가장 최근 탐지나 탐색 결과만 반영합니다. 이전 읽기가 더 늦게 끝나도 덮어쓰지 않습니다.
		if (!IsCurrent() || Count === undefined)
		{
			return;
		}
		const TextValue = Count === 0 ? '' : Count > RuntimePolicy.Detection.MaxBadgeCount ? `${RuntimePolicy.Detection.MaxBadgeCount}+` : String(Count);
		if (TextValue)
		{
			await Promise.all([
				chrome.action.setBadgeBackgroundColor({ tabId: TabId, color: BadgeColor.background }),
				chrome.action.setBadgeTextColor({ tabId: TabId, color: BadgeColor.text }),
				chrome.action.setBadgeText({ tabId: TabId, text: TextValue }),
			]);
		}
		else
		{
			await chrome.action.setBadgeText({ tabId: TabId, text: TextValue });
		}
	}
	catch
	{
		/* 검사하는 동안 탭이 닫히거나 다른 문서로 이동할 수 있습니다. */
	}
	finally
	{
		if (IsCurrent())
		{
			Updates.delete(TabId);
		}
	}
}

export function RefreshBadge(TabId)
{
	return UpdateBadge(TabId, async IsCurrent =>
	{
		const Tab = await chrome.tabs.get(TabId);
		if (!IsCurrent())
		{
			return undefined;
		}
		if (Tab.discarded || Tab.status === 'loading' || !HostPattern(Tab.url))
		{
			return 0;
		}
		return CountMedia((await FindMedia(TabId).catch(() => null))?.items);
	});
}

export function RefreshBadgeFromScan(TabId, ScanResult)
{
	// 팝업에서 권한을 확인한 결과를 사용해 같은 문서에 수집기를 다시 주입하지 않습니다.
	return UpdateBadge(TabId, async () =>
	{
		const Result = await ScanResult;
		return Result.changed ? undefined : CountMedia(Result.candidates);
	});
}

export const ClearBadge = TabId => UpdateBadge(TabId, () => 0);
export const ForgetBadge = TabId => Updates.delete(TabId);
export async function RefreshOpenBadges()
{
	for (const Tab of await chrome.tabs.query({}))
	{
		if (Tab.id !== undefined)
		{
			void RefreshBadge(Tab.id);
		}
	}
}
