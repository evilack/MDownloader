/**
 * Chrome 서비스 워커의 진입점입니다. 팝업·사이드 패널·오프스크린 문서의 메시지를 발신 위치에 따라 검증한 뒤 담당 모듈로 전달합니다.
 * Chrome이 워커를 다시 시작할 수 있으므로, 작업과 후보 목록의 기준 데이터는 브라우저 저장소에 둡니다.
 */
import { CandidatePreviews, CaptureCandidatePreview, ClearScan, PreviewCandidate, ResolveCandidate, Scan } from './detection.js';
import { ControlJob, Enqueue, EnqueuePlayback, JobUrl, ListJobs, PreviewJob, RemoveJob, RemoveJobs, UpdateHls } from './jobs.js';
import { ForgetNetwork, ForgetRequest, ObserveManifest, ObserveMediaContext, ObservePageUrl, ObserveRequestStart, ObserveRequest, ObserveResponse } from './network.js';
import { MediaContextCachePrefix, NetworkCachePrefix, SourceMetadataCachePrefix } from './lib/detection-cache.js';
import { CancelHls, HlsQualities, HlsRunnerUrl } from './hls-jobs.js';
import { MigrateHlsDiscovery, SyncHlsDiscovery } from './hls-discovery.js';
import { SetHlsRequestRules } from './lib/hls-request-context.js';
import { HostPattern } from './lib/media.js';
import { InitializeLocale, LocalizedError, MessageRef, SerializeError, Translate } from './lib/i18n.js';
import { SettingKeys } from './lib/settings.js';
import { RecordBrowserDownload } from './lib/download-log.js';
import { ClearBadge, ForgetBadge, RefreshBadge, RefreshBadgeFromScan, RefreshOpenBadges } from './media-badge.js';
import { FinishDownloadNaming, ForgetDownloadFilename } from './lib/browser-download.js';
import { SyncMediaContext } from './media-context-registration.js';
import { DebugLog, ReportDebugFailure } from './lib/debug-log.js';
import { InitializeDebugLogging } from './lib/debug-runtime.js';
import {RelayWebRtc, WebRtcSourceLost, CancelAllWebRtc, WebRtcQualities} from './webrtc-jobs.js';
void InitializeDebugLogging(async bEnabled =>
{
	// 설정 전환에만 기존 오프스크린 문서에 알립니다. 진단 때문에 문서를 만들거나 깨우지 않습니다.
	if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [HlsRunnerUrl()] })).length)
	{
		return;
	}
	if (DebugLog.IsEnabled() !== bEnabled)
	{
		return;
	}
	await chrome.runtime.sendMessage({ type: 'debugConfiguration', debugLogging: bEnabled });
});
async function RefreshActionTitle()
{
	try
	{
		await InitializeLocale();
		await chrome.action.setTitle({ title: Translate('action_title') });
	}
	catch (ErrorValue)
	{
		if (DebugLog.IsEnabled())
		{
			DebugLog.Record('ActionTitleFailed', () => ({ error: ErrorValue }));
		}
	}
}

async function Route(Message)
{
	switch (Message.type)
	{
		case 'scan':
		{
			const Result = Scan(Message.tabId, Message.scope);
			void RefreshBadgeFromScan(Message.tabId, Result);
			return Result;
		}
		case 'candidateUrl': return (await ResolveCandidate(Message.tabId, Message.scanId, Message.candidateId, Message.scope)).url;
		case 'candidatePreviews': return CandidatePreviews(Message);
		case 'previewCandidate': return PreviewCandidate(Message);
		case 'captureCandidatePreview': return CaptureCandidatePreview(Message);
		case 'hlsQualities': return HlsQualities(Message);
		case 'webrtcQualities': return WebRtcQualities(Message);
		case 'enqueue': return Enqueue(Message);
		case 'jobs': return ListJobs(Message.requestIds, Message.mediaKeys);
		case 'jobUrl': return JobUrl(Message.requestId);
		case 'previewJob': return PreviewJob(Message.requestId);
		case 'removeJob': return RemoveJob(Message.requestId, Message.deleteFile);
		case 'removeJobs': return RemoveJobs(Message.requestIds, Message.group);
		case 'control': return ControlJob(Message.requestId, Message.action);
		default: throw new LocalizedError('request_unsupported');
	}
}

chrome.runtime.onMessage.addListener((Message, Sender, Respond) =>
{
	if (Message.type === 'webrtcRecordingData' && Sender.id === chrome.runtime.id && HostPattern(Sender.origin) &&
		Sender.documentId && Sender.frameId === 0 && Number.isInteger(Sender.tab?.id))
	{
		void RelayWebRtc(Message, Sender).then(Respond, () => Respond({ok: false}));
		return true;
	}
	if (Message.type === 'mdownloader-stream-ready' && Sender.id === chrome.runtime.id &&
	HostPattern(Sender.origin) && Sender.documentId && Sender.frameId === 0 && Number.isInteger(Sender.tab?.id))
	{
		void RefreshBadge(Sender.tab.id);
		return;
	}
	if (Message.type === 'mdownloader-media-context')
	{
		void ObserveMediaContext(Sender, Message);
		return;
	}
	if (Message.type === 'mdownloader-hls-manifest' && Sender.id === chrome.runtime.id &&
	HostPattern(Sender.origin))
	{
		void ObserveManifest(Sender, Message);
		return;
	}
	const Root = chrome.runtime.getURL('');
	const bFromHls = Sender.url === HlsRunnerUrl() && Message.type === 'hlsUpdate';
	const bFromPlayback = Sender.url === Root + 'playback.html' && Message.type === 'savePlayback';
	const bFromManager = Sender.url?.split('?')[0] === Root + 'sidepanel.html';
	if (!bFromHls && !bFromPlayback && !bFromManager && Sender.url !== Root + 'popup.html')
	{
		return;
	}
	// 두 화면이 동시에 열려 있어도 같은 탭의 스캔을 공유하지 않습니다.
	// 이후 후보 조회는 요청을 시작한 화면의 스캔에서만 수행합니다.
	const Scope = bFromManager ? 'sidepanel' : 'popup';
	(bFromHls ? UpdateHls(Message) : bFromPlayback ? EnqueuePlayback(Message) : Route({ ...Message, scope: Scope })).then(
	Data => Respond({ ok: true, data: Data }),
	ErrorValue => Respond({ ok: false, error: SerializeError(ErrorValue) }),
	);
	return true;
});
const MediaRequestTypes = ['media', 'xmlhttprequest', 'other'];
const MediaRequestFilter = {
	urls: ['http://*/*', 'https://*/*'],
	types: MediaRequestTypes,
};
chrome.webRequest.onHeadersReceived.addListener(ObserveResponse, MediaRequestFilter, ['responseHeaders']);
chrome.webRequest.onBeforeRequest.addListener(ObserveRequestStart, MediaRequestFilter);
chrome.webRequest.onSendHeaders?.addListener(ObserveRequest, MediaRequestFilter, ['requestHeaders', 'extraHeaders']);
chrome.webRequest.onErrorOccurred?.addListener(ForgetRequest, MediaRequestFilter);
chrome.downloads.onChanged.addListener(Change =>
{
	FinishDownloadNaming(Change);
	void RecordBrowserDownload(Change).catch(() =>
	{
	});
});
chrome.downloads.onErased?.addListener(ForgetDownloadFilename);
chrome.tabs.onUpdated.addListener((TabId, Change) =>
{
	if (Change.url)
	{
		void WebRtcSourceLost(TabId, Change.url);
		ObservePageUrl(TabId, Change.url);
	}
	if (Change.status === 'loading' || Change.discarded)
	{
		void WebRtcSourceLost(TabId);
		void ClearBadge(TabId);
	}
	else if (Change.status === 'complete' || Change.url)
	{
		void RefreshBadge(TabId);
	}
});
chrome.tabs.onActivated.addListener(({ tabId: TabId }) =>
{
	void RefreshBadge(TabId);
});
chrome.storage.onChanged.addListener((Changes, Area) =>
{
	if (Area === 'local' && Object.hasOwn(Changes, SettingKeys.language))
	{
		void RefreshActionTitle();
	}
	if (Area !== 'session')
	{
		return;
	}
	const Tabs = new Set();
	for (const Key of Object.keys(Changes))
	{
		const Prefix = [NetworkCachePrefix, MediaContextCachePrefix, SourceMetadataCachePrefix].find(Value => Key.startsWith(Value));
		if (Prefix)
		{
			Tabs.add(Number(Key.slice(Prefix.length)));
		}
	}
	for (const TabId of Tabs)
	{
		void RefreshBadge(TabId);
	}
});
chrome.runtime.onStartup?.addListener(() =>
{
	void SyncMediaContext().catch(ReportDebugFailure);
	void RefreshOpenBadges().catch(ReportDebugFailure);
});
chrome.runtime.onInstalled?.addListener(async () =>
{
	void SyncMediaContext().catch(ReportDebugFailure);
	void RefreshOpenBadges().catch(ReportDebugFailure);
	try
	{
		await MigrateHlsDiscovery();
		await SetHlsRequestRules();
	}
	catch (ErrorValue)
	{
		ReportDebugFailure(ErrorValue);
	}
});
chrome.permissions.onAdded?.addListener(() =>
{
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('PermissionsChanged', () => ({ bAllowed: true }));
	}
	void SyncMediaContext().catch(ReportDebugFailure);
	void SyncHlsDiscovery().catch(ReportDebugFailure);
	void RefreshOpenBadges().catch(ReportDebugFailure);
});
chrome.permissions.onRemoved.addListener(({ origins: Origins }) =>
{
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('PermissionsChanged', () => ({ bAllowed: false }));
	}
	if (Origins?.length)
	{
		void CancelAllWebRtc().catch(ReportDebugFailure);
		void SyncMediaContext().catch(ReportDebugFailure);
		void SyncHlsDiscovery().catch(ReportDebugFailure);
		void ForgetNetwork().then(RefreshOpenBadges).catch(ReportDebugFailure);
		void CancelHls(undefined, MessageRef('job_permission_changed'));
	}
});
chrome.tabs.onRemoved.addListener(TabId =>
{
	void WebRtcSourceLost(TabId);
	ForgetBadge(TabId);
	void ClearScan(TabId).catch(() =>
	{
	});
	void ForgetNetwork(TabId);
});
if (chrome.action?.setTitle)
{
	void RefreshActionTitle();
}
