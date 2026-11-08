/**
 * 서비스 워커에서 스트림 전송 문서를 준비하고 작업 메시지를 전달합니다. 이 모듈은 주소 접근 권한을 검사하고, 조각을 읽거나 MP4를 묶는 작업은 전송 문서에 맡깁니다.
 */
import { HostPattern } from './lib/media.js';
import { ResolveCandidate } from './detection.js';
import { ParseMaster } from './lib/hls.js';
import { ReadPlaylist } from './lib/hls-http.js';
import {FindHlsSubtitles} from './lib/subtitles.js';
import { KnownMasterDenial } from './lib/hls-diagnostics.js';
import { LocalizedError, ReceivedError, Translate } from './lib/i18n.js';
import { DebugConfiguration } from './lib/debug-runtime.js';
import { DebugLog } from './lib/debug-log.js';
import {AssertMediaAllowed} from './lib/youtube-source-policy.js';
import {YoutubeAvailable} from './features/youtube/entry.js';
const Path = 'hls-runner.html';
let Creating;
export const HlsRunnerUrl = () => chrome.runtime.getURL(Path);
export async function EnsureRunner()
{
	if (!Creating)
	{
		Creating = (async () =>
		{
			if ((await chrome.runtime.getContexts({
				contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [HlsRunnerUrl()],
			})).length)
			{
				return;
			}
			if (!chrome.offscreen)
			{
				throw new LocalizedError('stream_runner_unavailable');
			}
			await chrome.offscreen.createDocument({
				url: Path, reasons: ['BLOBS', 'WEB_RTC', ...(YoutubeAvailable() ? ['IFRAME_SCRIPTING', 'WORKERS'] : [])],
				justification: Translate('offscreen_justification'),
			});
		})().finally(() =>
		{
			Creating = undefined;
		});
	}
	return Creating;
}

export async function RequireHlsHosts(Urls)
{
	for (const Url of Urls) AssertMediaAllowed({url: Url});
	const Origins = [...new Set(Urls.map(HostPattern))];
	if (Origins.includes(null))
	{
		throw new LocalizedError('stream_invalid_host');
	}
	for (const Origin of Origins)
	{
		if (!await chrome.permissions.contains({ origins: [Origin] }))
		{
			throw new LocalizedError('stream_host_permission', Origin.slice(0, -2));
		}
	}
}

export async function HlsQualities({ tabId: TabId, scanId: ScanId, candidateId: CandidateId, scope: Scope })
{
	const Item = await ResolveCandidate(TabId, ScanId, CandidateId, Scope);
	if (Item.format !== 'M3U8')
	{
		return [];
	}
	const MasterDenied = await KnownMasterDenial(Item.url);
	let Qualities = MasterDenied ? Item.qualities?.filter(Quality =>
	Item.observedVariants?.some(Variant => Variant.url === Quality.url)) : Item.qualities;
	// 다른 CDN이 재생 중 발급한 인증 주소를 쓰는 경우에는 실제 관측한 화질만 전송할 수 있습니다.
	if (Item.requestContext && Item.observedVariants?.some(Variant => Variant.requestContext?.serverOrigin !== Item.requestContext.serverOrigin))
	{
		Qualities = Qualities?.filter(Quality => Item.observedVariants.some(Variant => Variant.url === Quality.url));
	}
	if (!Qualities)
	{
		// 헤더 규칙은 현재 전송 작업에만 속합니다. 화질 조회는 규칙을 바꾸지 않습니다.
		if (Item.requestContext || MasterDenied)
		{
			return [];
		}
		await RequireHlsHosts([Item.url]);
		try
		{
			const Text = await ReadPlaylist(Item.url);
			Qualities = ParseMaster(Text, Item.url)?.reverse().map(Quality => ({...Quality, subtitles:FindHlsSubtitles(Text, Item.url, Quality.url)}));
		}
		catch (ErrorValue)
		{
			if (ErrorValue.status === 403 && Item.observedVariants?.length)
			{
				return [];
			}
			throw ErrorValue;
		}
	}
	if (!Qualities?.length)
	{
		return [];
	}
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('QualityOptions', () => ({ count: Qualities.length }));
	}
	// 한 조회 안에서 같은 CDN의 권한만 공유합니다. 다음 클릭은 권한 철회를 다시 확인합니다.
	const Permissions = new Map();
	return Promise.all(Qualities.map(async Quality =>
	{
		const Origin = HostPattern(Quality.url);
		if (!Permissions.has(Origin))
		{
			Permissions.set(Origin, chrome.permissions.contains({ origins: [Origin] }));
		}
		const ServerPermission = await Permissions.get(Origin) ? undefined : Origin;
		return { ...Quality, serverPermission: ServerPermission };
	}));
}

export async function LaunchHls(Job, Url, VariantUrl, RequestContext, Format, Subtitles)
{
	AssertMediaAllowed({...Job, url: Url, variants: [VariantUrl], requestContext: RequestContext});
	return LaunchRunner({
		...FolderDestination(Job), requestId: Job.requestId, url: Url, variantUrl: VariantUrl, requestContext: RequestContext,
		...(Job.subtitleOptions ? {subtitleOptions: Job.subtitleOptions} : {}),
		...(Subtitles?.length ? {subtitles: Subtitles} : {}),
		...(Format === 'MPD' ? { format: Format } : {}),
	});
}

function FolderDestination({ pickedDownloadFolder: PickedDownloadFolder, filename: Filename })
{
	return PickedDownloadFolder ? { pickedDownloadFolder: PickedDownloadFolder, filename: Filename } : {};
}

export async function LaunchPlaybackHls(Job, Playback, Subtitles)
{
	return LaunchRunner({ ...FolderDestination(Job), requestId: Job.requestId, playback: Playback, ...(Subtitles?.length ? {subtitles: Subtitles} : {}) });
}

export async function LaunchDirectToFolder(Job, Url, Subtitles)
{
	AssertMediaAllowed({...Job, url: Url});
	await EnsureRunner();
	const Result = await chrome.runtime.sendMessage({
		type: 'folderRun', debugLogging: await DebugConfiguration(), job: { ...FolderDestination(Job), requestId: Job.requestId, url: Url,
			...(Job.subtitleOptions ? {subtitleOptions: Job.subtitleOptions} : {}),
			...(Subtitles?.length ? {subtitles: Subtitles} : {}) },
	});
	if (!Result?.ok)
	{
		throw ReceivedError(Result?.error, 'job_browser_start_failed');
	}
}

async function LaunchRunner(Job)
{
	await EnsureRunner();
	const Result = await chrome.runtime.sendMessage({ type: 'hlsRun', debugLogging: await DebugConfiguration(), job: Job });
	if (!Result?.ok)
	{
		throw ReceivedError(Result?.error, 'stream_start_failed');
	}
}

export async function ActiveTransfers()
{
	return (await chrome.runtime.sendMessage({ type: 'hlsActive' }).catch(() => null)) ?? {};
}

export async function IsHlsActive(RequestId)
{
	return !!(await ActiveTransfers()).requestIds?.includes(RequestId);
}

export async function FinishLive(RequestId)
{
	return (await chrome.runtime.sendMessage({ type: 'hlsFinish', requestId: RequestId }).catch(() => null))?.ok;
}

export async function SavePartialHls(ParentId, Job, Source)
{
	await EnsureRunner();
	const Result = await chrome.runtime.sendMessage({type: 'hlsSnapshot', debugLogging: await DebugConfiguration(), parentId: ParentId, job: Job, source: Source});
	if (!Result?.ok)
	{
		throw ReceivedError(Result?.error, 'job_snapshot_unavailable');
	}
}

export async function CancelHls(RequestId, Reason)
{
	const Result = await chrome.runtime.sendMessage({ type: 'hlsCancel', requestId: RequestId, reason: Reason }).catch(() => null);
	return Result?.ok;
}
