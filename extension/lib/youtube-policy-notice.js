import {DistributionPolicy} from './distribution-policy.js';
import {IsYoutubeSource} from './youtube-source-policy.js';

/** 목록 표시 설정과 무관하게 스토어판의 현재 탭 안내를 갱신합니다. */
export function ObserveYoutubePolicyNotice(Notify, Policy = DistributionPolicy)
{
	if (Policy.flavor !== 'chrome-store')
	{
		Notify(false);
		return () => {};
	}
	let Revision = 0, Tab;
	async function Refresh()
	{
		const Version = ++Revision;
		try
		{
			const [Current] = await chrome.tabs.query({active: true, currentWindow: true});
			if (Version !== Revision) return;
			Tab = Current;
			Notify(IsYoutubeSource({pageUrl: Tab?.url}), Tab);
		}
		catch
		{
			if (Version === Revision) Notify(false);
		}
	}
	const Activated = Info =>
	{
		if (!Tab || Info.windowId === Tab.windowId) void Refresh();
	};
	const Updated = (TabId, Change) =>
	{
		if ((!Tab || TabId === Tab.id) && (Change.url || Change.status === 'complete')) void Refresh();
	};
	chrome.tabs.onActivated.addListener(Activated);
	chrome.tabs.onUpdated.addListener(Updated);
	void Refresh();
	return () =>
	{
		Revision++;
		chrome.tabs.onActivated.removeListener(Activated);
		chrome.tabs.onUpdated.removeListener(Updated);
	};
}
