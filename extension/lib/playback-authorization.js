import {CanUseYoutube} from './distribution-policy.js';
import {AssertMediaAllowed} from './youtube-source-policy.js';
import {LocalizedError} from './i18n.js';
import {DiscoverSubtitles} from './subtitle-discovery.js';
const Prefix = 'playback-authorization:';
/** 발신 DevTools 패널이 지정한 탭의 실제 URL을 워커에서 확인합니다. */
export async function AuthorizePlayback({requestId: Id, tabId: TabId, url: Url})
{
	if (!/^[a-f\d-]{36}$/i.test(Id) || !Number.isInteger(TabId)) throw new LocalizedError('job_invalid_request');
	const Tab = await chrome.tabs.get(TabId);
	if (!/^https?:\/\//.test(Tab.url ?? '')) throw new LocalizedError('candidate_no_access');
	AssertMediaAllowed({pageUrl: Tab.url, mediaUrl: Url});
	const Subtitles = await DiscoverSubtitles(TabId, {page: Tab.url, url: Url});
	await chrome.storage.session.set({[Prefix + Id]: {pageUrl: Tab.url, mediaUrl: Url, subtitles: Subtitles, created: Date.now()}});
}
export async function RequirePlaybackAuthorization(Id)
{
	const Key = Prefix + Id;
	const Source = chrome.storage.session ? (await chrome.storage.session.get(Key))[Key] : undefined;
	if (!CanUseYoutube())
	{
		if (!Source || Date.now() - Source.created > 24 * 60 * 60 * 1000) throw new LocalizedError('youtube_distribution_disabled');
		AssertMediaAllowed(Source);
	}
	return Source;
}
