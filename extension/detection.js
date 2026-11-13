import { ReportDebugFailure } from './lib/debug-log.js';
/**
 * 현재 문서의 플레이어와 관측한 HTTP 응답을 합쳐 다운로드 가능한 후보를 만듭니다. 서명된 주소는 브라우저 세션 안에서만 유지합니다.
 * 후보를 사용하기 직전에 문서 ID, 페이지 주소, 호스트 권한을 다시 확인합니다. 스캔 당시의 후보 번호만으로 작업을 시작하지 않습니다.
 */
import { RuntimePolicy } from './lib/runtime-policy.js';
import {CreateSharedThumbnailCache} from './lib/shared-thumbnail-cache.js';
const SharedThumbnails = CreateSharedThumbnailCache({ttl: RuntimePolicy.Preview.ThumbnailRefreshMs, limit: RuntimePolicy.Preview.MaxCachedThumbnails});
import { ClassifyMediaUrl, HlsReloadParameters, HostPattern, IsStreamFormat, MediaResourceKey, StreamPreviewPath, IsMetaCdnUrl, IsMetaMediaFragment } from './lib/media.js';
import {DiscoverMetaReel, MetaReelIdentity} from './lib/meta-reel.js';
import { FilterAllowedNetworkCandidates, IsAuxiliaryMedia, MaxObservedMediaPerTab, NetworkCandidates, ReadMediaContext } from './network.js';
import { LocalizedError } from './lib/i18n.js';
import { ScanStorageKey } from './lib/detection-cache.js';
import { CollectPlayerPreviews, ThumbnailFrame } from './lib/player-previews.js';
import {CaptureVisiblePlayerThumbnail} from './lib/visible-player-thumbnail.js';
import { HlsVariantResolution, MatchesHlsVariant } from './lib/hls.js';
import { DiscoverDeclaredHls } from './lib/declared-streams.js';
import { DiscoverNativeHls } from './lib/native-hls-discovery.js';
import {DiscoverHlsDvr} from './lib/hls-dvr-discovery.js';
import {DiscoverDashInitialization} from './lib/dash-initialization.js';
import { DiscoverSelectedHls } from './lib/selected-hls.js';
import {DiscoverNaverClip} from './lib/naver-clip.js';
import {DiscoverBilibili, IdentifyBilibiliPage} from './lib/bilibili.js';
import {WebRtcPageTask} from './lib/webrtc-page.js';
import {RecordingMimeTypes} from './lib/recording-format.js';
import {DiscoverSubtitles} from './lib/subtitle-discovery.js';
import {SubtitleStatus} from './lib/subtitle-status.js';
import {DescribeSubtitleTracks} from './lib/download-options-selection.js';
import {ReadPlaylist} from './lib/hls-http.js';
import {FindDashSubtitles} from './lib/subtitles.js';
import {AssertMediaAllowed, YoutubeSourceBlocked, IdentifyYoutubeUrl} from './lib/youtube-source-policy.js';
import {YoutubeAvailable} from './features/youtube/entry.js';
const KeyEncoder = new TextEncoder();
const MaxPlaybackObservations = MaxObservedMediaPerTab + RuntimePolicy.Detection.MaxMediaContextUrls;
async function MediaJobKey(Page, Url)
{
	// 후보 번호는 매 스캔마다 새로 부여됩니다. 페이지와 주소로 지문을 계산하면
	// 다운로드 기록에 서명된 주소를 저장하지 않고도 이후 스캔의 같은 미디어를 연결할 수 있습니다.
	const Digest = await crypto.subtle.digest('SHA-256', KeyEncoder.encode(JSON.stringify([Page, Url])));
	return Array.from(new Uint8Array(Digest), Byte => Byte.toString(16).padStart(2, '0')).join('');
}

function CollectVideos(MaxPlaylists, ExcludedSelector, SourcePlayerSelector)
{
	const Playlists = [];
	// 같은 출처의 플레이어 프레임에서도 브라우저가 완료한 리소스 요청을 읽을 수 있습니다.
	const Frames = [window];
	for (const Frame of Frames)
	{
		try
		{
			const LocalOwnerDocument = Frame.document;
			if (LocalOwnerDocument.querySelector('video, audio'))
			{
				const FrameUrls = new Set();
				const Entries = Frame.performance.getEntriesByType('resource');
				for (let Index = Entries.length - 1; Index >= 0 && Playlists.length < MaxPlaylists; Index--)
				{
					const Entry = Entries[Index];
					if ((Entry.startTime ?? 0) >= (Frame.MDownloaderMediaPage?.since ?? 0) &&
					(Entry.initiatorType === 'xmlhttprequest' || Entry.initiatorType === 'fetch') &&
					(Entry.responseStatus === 200 || Entry.responseStatus === 206) &&
					/^https?:\/\/[^?#]+\.(m3u8|mpd)(?:[?#]|$)/i.test(Entry.name) && !FrameUrls.has(Entry.name))
					{
						FrameUrls.add(Entry.name);
						Playlists.push([Entry.name, Frame.performance.timeOrigin]);
					}
				}
			}
			for (let Index = 0; Index < Frame.length; Index++)
			{
				Frames.push(Frame.frames[Index]);
			}
		}
		catch
		{
			/* 다른 출처의 프레임은 권한 범위 내에서 네트워크 응답을 관측합니다. */
		}
	}
	const Players = [...document.querySelectorAll('video, audio')];
	const MainPlayers = Players.filter(Player => !ExcludedSelector || !Player.closest(ExcludedSelector));
	// 링크는 영상의 이동 대상일 수도 있습니다. 직접 URL 수집용 카드 제외와
	// 영상 요소에 연결된 선택 API 조회 대상을 구분해 대표 플레이어를 놓치지 않습니다.
	const SourceExclusion = SourcePlayerSelector ?? ExcludedSelector;
	// 광고 SDK 등이 만든 소스 없는 대기 요소는 실제 두 번째 플레이어가 아닙니다.
	// 선언된 소스가 있는 요소는 정지/로딩 중이어도 남겨 소유권을 추측하지 않습니다.
	const SourcePlayers = Players.filter(Player => (!SourceExclusion || !Player.closest(SourceExclusion)) &&
		(Player.currentSrc || Player.srcObject || Player.getAttribute?.('src') || Player.querySelector?.('source[src]')));
	const SourceUrls = Player => [Player.currentSrc, Player.hasAttribute('src') ? Player.src : '',
		...[...Player.querySelectorAll('source[src]')].map(Source => Source.src)].filter(Boolean);
	return {
		page: location.href,
		playerFrames: [...document.querySelectorAll('iframe[src][allowfullscreen], iframe[src][allow*="fullscreen"]')]
			.slice(0, MaxPlaylists).map(Frame => Frame.src),
		pageTitle: document.title,
		timeOrigin: performance.timeOrigin,
		playlists: Playlists,
		observerReady: !!globalThis.MDownloaderMediaContext,
		previewOnly: globalThis.MDownloaderMediaPage?.previewOnly === true,
		liveStream: [...document.querySelectorAll('video')].some(Player => Player.srcObject && !Player.paused && Player.videoWidth),
		auxiliarySources: Players.filter(Player => !MainPlayers.includes(Player)).flatMap(SourceUrls),
		opaquePlayer: SourcePlayers.length === 1 &&
		SourcePlayers.some(Player =>
		{
			const Owner = globalThis.MDownloaderMediaPage?.players.get(Player);
			return (!Owner || Owner.page === location.href) && !globalThis.MDownloaderMediaPage?.previewOnly &&
			(Player.currentSrc.startsWith('blob:') || (!Player.currentSrc && !!Player.srcObject));
		}),
		sources: MainPlayers.filter(Video =>
		{
			const Owner = globalThis.MDownloaderMediaPage?.players.get(Video);
			return !globalThis.MDownloaderMediaPage?.previewOnly && (!Owner || Owner.page === location.href);
		}).flatMap(SourceUrls),
	};
}

/** Read existing player metadata only; a stale SPA response cannot describe the current candidate. */
function ReadYoutubeBroadcast({page: Page, videoId: VideoId})
{
	if (location.href !== Page) return null;
	const Response = globalThis.ytInitialPlayerResponse;
	const Details = Response?.videoDetails;
	if (Details?.videoId !== VideoId) return null;
	const Broadcast = Response.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
	const Upcoming = Details.isUpcoming === true;
	const Time = Broadcast?.startTimestamp ? new Date(Broadcast.startTimestamp).getTime() : NaN;
	return {videoId: VideoId, upcoming: Upcoming,
		...(Upcoming ? {live: false} : typeof Broadcast?.isLiveNow === 'boolean' ? {live: Broadcast.isLiveNow}
			: typeof Details.isLive === 'boolean' ? {live: Details.isLive} : {}),
		...(Upcoming && Number.isFinite(Time) ? {scheduledStartTime: new Date(Time).toISOString()} : {})};
}

async function YoutubeBroadcastInDocument(TabId, DocumentId, Page, VideoId)
{
	try
	{
		const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]},
			world: 'MAIN', func: ReadYoutubeBroadcast, args: [{page: Page, videoId: VideoId}]});
		if (Frame?.documentId !== DocumentId || Frame.result?.videoId !== VideoId) return {};
		const {upcoming: Upcoming, scheduledStartTime: ScheduledStartTime, live: Live} = Frame.result;
		return {upcoming: Upcoming, ...(ScheduledStartTime ? {scheduledStartTime: ScheduledStartTime} : {}),
			...(typeof Live === 'boolean' ? {live: Live} : {})};
	}
	catch {return {};}
}

export async function FindMedia(TabId)
{
	// Chrome은 주입할 함수를 직렬화합니다. 모듈의 설정값은 함수 밖에 두고 호출 인자로 넘깁니다.
	const [Frame] = await chrome.scripting.executeScript({
		target: { tabId: TabId }, func: CollectVideos, args: [MaxPlaybackObservations, RuntimePolicy.Detection.AuxiliaryPlayerSelector, RuntimePolicy.Detection.SourcePlayerSelector],
	});
	const { page: Page, sources: Sources, playlists: Playlists } = Frame.result;
	if (YoutubeSourceBlocked({page: Page})) return {documentId: Frame.documentId, page: Page, observed: [], items: []};
	const Youtube = YoutubeAvailable() && IdentifyYoutubeUrl(Page);
	if (Youtube)
	{
		const Title = Frame.result.pageTitle?.replace(/^\(\d+\)\s*/, '').replace(/\s+-\s+YouTube\s*$/i, '').trim();
		const Name = Title && Title !== 'YouTube' ? Title : 'YouTube-' + Youtube.videoId;
		const Broadcast = await YoutubeBroadcastInDocument(TabId, Frame.documentId, Page, Youtube.videoId);
		return {documentId: Frame.documentId, page: Page, observed: [], items: [{url: Youtube.canonicalUrl,
			name: Name + '.mp4', format: 'YOUTUBE', supported: true, page: Page, ...Broadcast}]};
	}
	if (!['http:', 'https:'].includes(new URL(Page).protocol))
	{
		return null;
	}
	const NaverClip = await DiscoverNaverClip(TabId, Frame.documentId, Page);
	if (NaverClip.length)
	{
		return {documentId: Frame.documentId, page: Page, observed: [], items: NaverClip};
	}
	const Bilibili = await DiscoverBilibili(TabId, Frame.documentId, Page);
	if (Bilibili.length)
	{
		return {documentId: Frame.documentId, page: Page, observed: [], items: Bilibili};
	}
	if (Frame.result.observerReady === false)
	{
		// 임시 탭 접근 권한을 받은 뒤나 스크립트 등록 전에 열린 문서에도 이후 재생을 관측합니다.
		await chrome.scripting.executeScript({
			target: { tabId: TabId, documentIds: [Frame.documentId] }, files: ['data/page-policy.js', 'media-context-page.js'],
		}).catch(() =>
		{
		});
	}
	let Observed = await NetworkCandidates(TabId, Frame.documentId);
	const WebRtc = Frame.result.liveStream ? await ProbeWebRtc(TabId, Frame.documentId, Page) : null;
	const WebRtcItems = WebRtc?.mimeType ? WebRtc.streams.map(Stream => ({
		url: 'webrtc:' + encodeURIComponent(Stream.trackId), trackId: Stream.trackId,
		name: `WebRTC-${Stream.width}x${Stream.height}.${WebRtc.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`,
		format: 'WEBRTC', supported: true, live: true, mimeType: WebRtc.mimeType,
		documentId: Frame.documentId, page: Page,
	})) : [];
	const SingleWebRtc = Frame.result.opaquePlayer && WebRtcItems.length === 1;
	// SPA 전환 전 대체 방송은 리소스 타이밍에도 남습니다. 캐시와 타이밍 양쪽에서 제외해야
	// 이전 방송이 본편 후보로 되살아나거나 현재 방송의 탐색을 막지 않습니다.
	const PreviousDeclared = new Set(Observed.filter(Item => (Item.page && Item.page !== Page) || (Item.declaredPage && Item.declaredPage !== Page))
	.flatMap(Item => [Item.url, ...(Item.variants ?? [])]).map(MediaResourceKey));
	const IsCurrentSource = Item => (!Item.page || Item.page === Page) && (!Item.declaredPage || Item.declaredPage === Page);
	Observed = Observed.filter(IsCurrentSource);
	const DashInitialization = await DiscoverDashInitialization(TabId, Frame.documentId, Page, Observed);
	let Context = await ReadMediaContext(TabId);
	// 응답 헤더가 카드 역할 메시지보다 먼저 도착해도, 현재 DOM이 미리보기 전용임을
	// 확인한 중간 상태의 미분류 주소는 노출하지 않습니다. 다른 문서의 본편은 유지합니다.
	const AuxiliarySources = new Set((Frame.result.auxiliarySources ?? []).map(MediaResourceKey));
	// WebRTC 유무로 같은 문서의 HLS 전체를 숨기지 않습니다. 사용자가 확인한
	// 흐린 대체 프로필만 제외하고, 명시적인 본편 연결이 있으면 그 판정을 우선합니다.
	const IsBlurredPreview = (Url, DocumentId) => WebRtcItems.length > 0 && DocumentId === Frame.documentId &&
		Context.byDocument.get(DocumentId)?.get(MediaResourceKey(Url)) !== 'playback' &&
		/(?:^|[_/])\d+p_blurred(?:[_.-]|$)/i.test(new URL(Url).pathname);
	const IsAuxiliary = (Url, DocumentId, TimeOrigin, Format) => IsAuxiliaryMedia(Context, Url, DocumentId, TimeOrigin) ||
	IsBlurredPreview(Url, DocumentId) ||
	(DocumentId === Frame.documentId && AuxiliarySources.has(MediaResourceKey(Url))) ||
	(Frame.result.previewOnly && IsStreamFormat(Format ?? ClassifyMediaUrl(Url)?.format) &&
	(DocumentId === Frame.documentId || (DocumentId === undefined && TimeOrigin === Frame.result.timeOrigin)) &&
	!Context.byDocument.get(Frame.documentId)?.has(MediaResourceKey(Url)));
	if (await DiscoverNativeHls(TabId, Frame.documentId, Page, Sources,
		Observed.filter(Item => !IsAuxiliary(Item.url, Item.documentId, undefined, Item.format)),
		{opaquePlayer: Frame.result.opaquePlayer, excludedSelector: RuntimePolicy.Detection.SourcePlayerSelector}))
	{
		Observed = (await NetworkCandidates(TabId, Frame.documentId)).filter(IsCurrentSource);
	}
	// 선택 소스가 확인된 단독 워커 플레이어에 한해 같은 문서의 이전 HLS 요청을 표시 대상에서 제외합니다.
	// 주소는 관측 기록에 보존하며 다른 프레임과 다른 형식의 영상은 유지합니다.
	const SelectedHls = Frame.result.opaquePlayer && !SingleWebRtc ? await DiscoverSelectedHls(TabId, Frame.documentId, Page,
	Observed.filter(Item => !IsAuxiliary(Item.url, Item.documentId, undefined, Item.format))) : null;
	if (SelectedHls)
	{
		Observed = (await NetworkCandidates(TabId, Frame.documentId)).filter(IsCurrentSource);
	}
	if (Frame.result.liveStream && !Observed.some(Item => IsStreamFormat(Item.format) &&
		!IsAuxiliary(Item.url, Item.documentId, undefined, Item.format) &&
		(Item.qualities?.length || Item.declaredPage === Page || typeof Item.live === 'boolean')))
	{
		await DiscoverDeclaredHls(TabId, Frame.documentId, Page).catch(ErrorValue => ReportDebugFailure(ErrorValue, 'DeclaredSourceFailed'));
		Observed = (await NetworkCandidates(TabId, Frame.documentId)).filter(IsCurrentSource);
		Context = await ReadMediaContext(TabId);
	}
	// 요청 출처가 같아도 서로 다른 프레임의 미디어 판정은 섞지 않습니다.
	if (!Frame.result.previewOnly && (Frame.result.opaquePlayer || Sources.some(Url=>ClassifyMediaUrl(Url)?.format==='M3U8')) &&
		await DiscoverHlsDvr(TabId,Frame.documentId,Page,Observed.filter(Item=>!IsAuxiliary(Item.url,Item.documentId,undefined,Item.format))))
	{
		Observed=(await NetworkCandidates(TabId,Frame.documentId)).filter(IsCurrentSource);
		Context=await ReadMediaContext(TabId);
	}
	const AllowedObserved = Observed.filter(Item => !IsAuxiliary(Item.url, Item.documentId, undefined, Item.format)).map(({dashManifest: _DashManifest, ...Item}) =>
	{
		if (SelectedHls && Item.documentId === Frame.documentId && MediaResourceKey(Item.url) === SelectedHls.url)
		{
			Item = {...Item, selectedSource: true};
		}
		// 명시적인 미디어 재생목록 판정은 우선합니다. 그 정보가 없는 선택 마스터에만
		// 같은 영상 요소에 연결된 플레이어의 라이브 길이를 보충합니다.
		if (Item.live === undefined && Item.documentId === Frame.documentId &&
		SelectedHls?.live === true && MediaResourceKey(Item.url) === SelectedHls.url)
		{
			Item = {...Item, live: true};
		}
		if (SelectedHls?.sourceIdentity && MediaResourceKey(Item.url) === SelectedHls.url)
		{
			Item = {...Item, sourceIdentity: SelectedHls.sourceIdentity};
		}
		if (!Item.qualities?.length)
		{
			return Item;
		}
		// 페이지가 인증 쿼리를 덧붙인 실제 요청을 연결합니다. 후보가 여럿이면 어느 세션인지 추측하지 않습니다.
		const Qualities = Item.qualities.map(Quality =>
		{
			const Matches = Observed.filter(Entry => Entry.documentId === Item.documentId && Entry.url !== Item.url &&
			Entry.format === Item.format && MatchesHlsVariant(Quality.url, Entry.url));
			return Matches.length === 1 ? { ...Quality, url: Matches[0].url } : Quality;
		});
		// 주소나 사이트명으로 라이브를 추측하지 않고 같은 문서에서 성공한 화질 응답만 연결합니다.
		const Live = Item.live ?? Observed.find(Entry => Entry.documentId === Item.documentId && typeof Entry.live === 'boolean' &&
		Qualities.some(Quality => Quality.url === Entry.url))?.live;
		const Dvr = Item.dvr ?? Observed.find(Entry => Entry.documentId === Item.documentId && typeof Entry.dvr === 'boolean' &&
		Qualities.some(Quality => Quality.url === Entry.url))?.dvr;
		return { ...Item, ...(Live !== undefined ? { live: Live } : {}), ...(Dvr !== undefined ? {dvr: Dvr} : {}), qualities: Qualities, variants: Qualities.map(Quality => Quality.url) };
	});
	const Direct = Sources.filter(Url => !PreviousDeclared.has(MediaResourceKey(Url)) &&
	!IsAuxiliary(Url, Frame.documentId)).map(ClassifyMediaUrl).filter(Boolean);
	const Playback = new Map();
	for (const [Url, TimeOrigin] of Playlists)
	{
		const DocumentId = TimeOrigin === Frame.result.timeOrigin ? Frame.documentId : undefined;
		const ResourceKey = MediaResourceKey(Url);
		if (Playback.has(ResourceKey) || PreviousDeclared.has(ResourceKey) || IsAuxiliary(Url, DocumentId, TimeOrigin))
		{
			continue;
		}
		const Item = ClassifyMediaUrl(Url);
		if (!IsStreamFormat(Item?.format))
		{
			continue;
		}
		Playback.set(ResourceKey, { ...Item, fromPlayback: true, playbackTimeOrigin: TimeOrigin, documentId: DocumentId });
		if (Playback.size === MaxObservedMediaPerTab)
		{
			break;
		}
	}
	const MetaReel = await DiscoverMetaReel(TabId, Frame.documentId, Page);
	const Items = new Map();
	for (const Item of [...(MetaReel ? [MetaReel] : []), ...Direct.filter(Item => Item.supported && !IsStreamFormat(Item.format)), ...AllowedObserved, ...Playback.values(), ...Direct])
	{
		if ((Item.documentId ?? Frame.documentId) === Frame.documentId && DashInitialization.has(MediaResourceKey(Item.url))) continue;
		if (YoutubeSourceBlocked({...Item, pageUrl: Page})) continue;
		if (IsMetaMediaFragment(Item.url)) continue;
		// Once this post declares its complete MP4, its CDN tracks and prefetched neighbours
		// are not separate downloads. Other frames and non-Meta media retain their own scope.
		const IsRootSource = Item.documentId === Frame.documentId || (Item.documentId === undefined && !Item.fromPlayback);
		if (MetaReel && Item !== MetaReel && IsRootSource && IsMetaCdnUrl(Item.url)) continue;
		const ResourceKey = MediaResourceKey(Item.url);
		if (!Items.has(ResourceKey))
		{
			Items.set(ResourceKey, Item);
		}
	}
	// 같은 문서에서 받은 마스터가 명시한 화질은 별도 영상으로 세지 않습니다.
	// 원본 관측과 화질 정보는 남겨 다운로드 선택과 요청 문맥 확인에 계속 사용합니다.
	const Roots = [...Items.values()].filter(Item => Item.variants?.length || !AllowedObserved.some(Master =>
	Master.documentId === (Item.documentId ?? Frame.documentId) && Master.url !== Item.url &&
	(Master.variants?.some(Url => MediaResourceKey(Url) === MediaResourceKey(Item.url)) ||
	Master.qualities?.some(Quality => Quality.audioUrl && MediaResourceKey(Quality.audioUrl) === MediaResourceKey(Item.url)))))
	.filter(Item => !SelectedHls || Item.format !== 'M3U8' || (Item.documentId ?? Frame.documentId) !== Frame.documentId ||
	MediaResourceKey(Item.url) === SelectedHls.url);
	return { documentId: Frame.documentId, page: Page, observed: AllowedObserved, items: [...WebRtcItems, ...Roots],
		playerFrames: Frame.result.playerFrames };
}

// These addresses only inform the permission UI. A resource timing entry is
// not proof that a playlist is valid or that it can be downloaded.
function ReadMediaOrigins(Limit)
{
	const Players = [...document.querySelectorAll('video, audio')];
	const Sources = Players.flatMap(Player => [Player.currentSrc || Player.src,
		...[...Player.querySelectorAll('source[src]')].map(Source => Source.src)]);
	if (Players.some(Player => Player.currentSrc.startsWith('blob:')))
	{
		for (const Entry of performance.getEntriesByType('resource').slice(-Limit))
		{
			if (/\.(m3u8|mpd)(?:[?#]|$)/i.test(Entry.name)) Sources.push(Entry.name);
		}
	}
	return {page: location.href, mediaOrigins: Sources.slice(0, Limit)};
}

async function MissingScanOrigins(TabId, DocumentId, Page, PlayerFrames = [])
{
	const PageOrigin = HostPattern(Page);
	if (!PageOrigin || YoutubeSourceBlocked({page: Page})) return [];
	const FrameOrigins = new Set(PlayerFrames.filter(Url => !YoutubeSourceBlocked({frameUrl: Url})).map(HostPattern).filter(Boolean));
	const Origins = new Set([PageOrigin, ...FrameOrigins]);
	if (DocumentId)
	{
		const Frames = await chrome.scripting.executeScript({
			target: {tabId: TabId, allFrames: true}, func: ReadMediaOrigins, args: [MaxObservedMediaPerTab],
		}).catch(() => []);
		for (const {frameId, result} of Frames)
		{
			if (!result || YoutubeSourceBlocked({frameUrl: result.page}) ||
				(frameId === 0 ? result.page !== Page : !FrameOrigins.has(HostPattern(result.page)))) continue;
			for (const Url of result.mediaOrigins)
			{
				const Origin = HostPattern(Url);
				if (Origin && !YoutubeSourceBlocked({url: Url, page: Page})) Origins.add(Origin);
			}
		}
	}
	return (await Promise.all([...Origins].slice(0, MaxObservedMediaPerTab).map(async Origin =>
		await chrome.permissions.contains({origins: [Origin]}) ? null : Origin))).filter(Boolean);
}

async function ProbeWebRtc(TabId, DocumentId, Page)
{
	const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]}, func: WebRtcPageTask,
		args: [{action: 'probe', page: Page, mimeTypes:RecordingMimeTypes(), excludedSelector: RuntimePolicy.Detection.AuxiliaryPlayerSelector}]}).catch(() => []);
	return Frame?.documentId === DocumentId && Frame.result?.page === Page ? Frame.result : null;
}

export async function Scan(TabId, Scope)
{
	try
	{
		const Result = await FindMedia(TabId);
		if (!Result)
		{
			return { restricted: true };
		}
		const { documentId: DocumentId, page: Page, items: Items, observed: Observed, playerFrames: PlayerFrames } = Result;
		// 재사용할 헤더는 같은 문서에서 실제로 관측한 화질 응답에만 연결합니다.
		const VariantsByDocument = new Map();
		for (const Entry of Observed)
		{
			if (!Entry.requestContext)
			{
				continue;
			}
			if (!VariantsByDocument.has(Entry.documentId))
			{
				VariantsByDocument.set(Entry.documentId, new Map());
			}
			VariantsByDocument.get(Entry.documentId).set(Entry.url, Entry);
		}
		const LocalPermissions = new Map();
		const Candidates = await Promise.all(Items.map(async (Item, Id) =>
		{
			const Variants = VariantsByDocument.get(Item.documentId);
			const ObservedVariants = Item.variants?.map(Url => Variants?.get(Url)).filter(Boolean);
			// activeTab can discover a playing WebRTC track, but the quality observer
			// needs site access before the page starts negotiating the stream.
			const IsWebRtc = Item.format === 'WEBRTC';
			const Origin = IsWebRtc ? HostPattern(Item.page) :
				(IsStreamFormat(Item.format) || Item.format === 'YOUTUBE') && HostPattern(Item.url);
			if (Origin && !LocalPermissions.has(Origin))
			{
				LocalPermissions.set(Origin, chrome.permissions.contains({ origins: [Origin] }));
			}
			const [ServerAllowed, MediaKey] = await Promise.all([
				LocalPermissions.get(Origin), Item.supported ? MediaJobKey(Page, Item.sourceIdentity ? JSON.stringify(['playback', Item.sourceIdentity]) : Item.url) : undefined,
			]);
			const MissingPermission = Origin && !ServerAllowed ? Origin : undefined;
			return { ...Item, observedVariants: ObservedVariants, ...(IsWebRtc
				? {sitePermission: MissingPermission} : {serverPermission: MissingPermission}), id: Id, mediaKey: MediaKey };
		}));
		const ScanId = crypto.randomUUID();
		await chrome.storage.session.set({
			[ScanStorageKey(TabId, Scope)]: { scanId: ScanId, documentId: DocumentId, page: Page, candidates: Candidates },
		});
		const MissingOrigins = Candidates.some(Item => Item.supported)
			? [...new Set(Candidates.map(Item => Item.sitePermission).filter(Boolean))]
			: await MissingScanOrigins(TabId, DocumentId, Page, PlayerFrames).catch(() => []);
		const Current = await CurrentScan(TabId, ScanId, Scope);
		if (!Current)
		{
			return { changed: true };
		}
		const PlaylistNameCounts = new Map();
		for (const { format: Format, name: Name } of Candidates)
		{
			if (IsStreamFormat(Format))
			{
				PlaylistNameCounts.set(Name, (PlaylistNameCounts.get(Name) ?? 0) + 1);
			}
		}
		return { scanId: ScanId, ...(MissingOrigins.length ? {missingOrigins: MissingOrigins} : {}),
			candidates: Candidates.map(({ id: Id, name: Name, format: Format, supported: Supported, live: Live, dvr: Dvr, upcoming: Upcoming,
			scheduledStartTime: ScheduledStartTime, serverPermission: ServerPermission, sitePermission: SitePermission, url: Url, mediaKey: MediaKey }) => ({
				id: Id, name: Name, format: Format, supported: Supported, serverPermission: ServerPermission, mediaKey: MediaKey,
				...(SitePermission ? {sitePermission: SitePermission} : {}),
				...(Live !== undefined ? { live: Live } : {}),
				...(Dvr !== undefined ? {dvr: Dvr} : {}),
				...(Upcoming !== undefined ? {upcoming: Upcoming} : {}), ...(ScheduledStartTime ? {scheduledStartTime: ScheduledStartTime} : {}),
				playlistPath: IsStreamFormat(Format) && PlaylistNameCounts.get(Name) > 1 ? new URL(Url).pathname : undefined,
			})) };
	}
	catch
	{
		const Tab = await chrome.tabs?.get(TabId).catch(() => undefined);
		const MissingOrigins = await MissingScanOrigins(TabId, undefined, Tab?.url).catch(() => []);
		return { restricted: true, ...(MissingOrigins.length ? {missingOrigins: MissingOrigins} : {}),
			...(!Tab?.url ? {accessUnknown: true} : {}) };
	}
}

async function CurrentScan(TabId, ScanId, Scope)
{
	const Key = ScanStorageKey(TabId, Scope);
	const Saved = (await chrome.storage.session.get(Key))[Key];
	if (!Saved || Saved.scanId !== ScanId)
	{
		return null;
	}
	try
	{
		const [Frame] = await chrome.scripting.executeScript({
			target: { tabId: TabId, documentIds: [Saved.documentId] },
			func: () => ({ page: location.href, active: document.visibilityState === 'visible', pageTitle: document.title }),
		});
		if (Frame.result.page !== Saved.page || !Frame.result.active)
		{
			return null;
		}
		return { ...Saved, pageTitle: Frame.result.pageTitle };
	}
	catch
	{
		return null;
	}
}

/** 실제 문서의 전체 후보에서 유일성을 검사합니다. 화면에 보이는 일부 항목만으로 단정하지 않습니다. */
function IsSingleDocumentStream(Saved, Candidate)
{
	if (Candidate.format === 'YOUTUBE') return !!IdentifyYoutubeUrl(Saved.page) && IdentifyYoutubeUrl(Saved.page).videoId === IdentifyYoutubeUrl(Candidate.url)?.videoId &&
		Saved.candidates.filter(Entry => Entry.supported && Entry.format === 'YOUTUBE').length === 1;
	return IsStreamFormat(Candidate.format) && Saved.candidates.filter(Entry => Entry.supported && IsStreamFormat(Entry.format) &&
	(Entry.documentId ?? Saved.documentId) === (Candidate.documentId ?? Saved.documentId)).length === 1;
}

export async function ResolveCandidate(TabId, ScanId, CandidateId, Scope)
{
	const Saved = await CurrentScan(TabId, ScanId, Scope);
	const Candidate = Saved?.candidates.find(Item => Item.id === CandidateId);
	if (!Candidate?.supported)
	{
		throw new LocalizedError('candidate_changed');
	}
	AssertMediaAllowed({...Candidate, pageUrl: Saved.page});
	if (Candidate.sourceIdentity?.startsWith('bilibili:'))
	{
		const Current = await DiscoverBilibili(TabId, Saved.documentId, Saved.page);
		if (!Current.some(Item => Item.sourceIdentity === Candidate.sourceIdentity)) throw new LocalizedError('candidate_changed');
	}
	if (Candidate.format === 'YOUTUBE')
	{
		if (!IsSingleDocumentStream(Saved, Candidate)) throw new LocalizedError('candidate_changed');
		return {...Candidate, page: Saved.page, previewPage: Saved.page,
			documentId: Saved.documentId, singleStream: true, pageTitle: Saved.pageTitle};
	}
	const Context = await ReadMediaContext(TabId);
	if (Candidate.format === 'WEBRTC')
	{
		const Current = await ProbeWebRtc(TabId, Candidate.documentId, Saved.page);
		if (!Current?.streams?.some(Stream => Stream.trackId === Candidate.trackId)) throw new LocalizedError('candidate_changed');
		return {...Candidate, page: Saved.page, previewPage: Saved.page, pageTitle: Saved.pageTitle};
	}
	const Available = [Candidate, ...(Candidate.observedVariants ?? [])].filter(Item => !IsAuxiliaryMedia(
	Context, Item.url, Item.documentId ?? (Item.fromPlayback ? undefined : Saved.documentId), Item.playbackTimeOrigin,
	));
	if (Available[0] !== Candidate)
	{
		throw new LocalizedError('candidate_changed');
	}
	const Allowed = await FilterAllowedNetworkCandidates(Available, TabId, Saved.documentId, Saved.page);
	if (Allowed[0] !== Candidate)
	{
		throw new LocalizedError('candidate_no_access');
	}
	if (Candidate.fromPlayback)
	{
		const [Frame] = await chrome.scripting.executeScript({
			target: { tabId: TabId, documentIds: [Saved.documentId] }, func: CollectVideos, args: [MaxPlaybackObservations, RuntimePolicy.Detection.AuxiliaryPlayerSelector],
		}).catch(() => []);
		if (!Frame?.result.playlists.some(([Url, TimeOrigin]) => Url === Candidate.url &&
		(Candidate.playbackTimeOrigin === undefined || TimeOrigin === Candidate.playbackTimeOrigin)))
		{
			throw new LocalizedError('candidate_changed');
		}
	}
	let PreviewPage = Saved.page;
	if (Candidate.documentId && Candidate.documentId !== Saved.documentId)
	{
		// 부모 페이지 소유권과 실제 미리보기 문서는 별개입니다. 내장 플레이어에 부모 URL을
		// 전달하면 정상 프레임도 거절되므로, 검증된 문서의 실제 URL을 한 번 읽어 고정합니다.
		const [Frame] = await chrome.scripting.executeScript({
			target: { tabId: TabId, documentIds: [Candidate.documentId] }, func: () => location.href,
		}).catch(() => []);
		if (Frame?.documentId !== Candidate.documentId || !HostPattern(Frame.result))
		{
			throw new LocalizedError('candidate_changed');
		}
		PreviewPage = Frame.result;
	}
	AssertMediaAllowed({...Candidate, pageUrl: Saved.page, frameUrl: PreviewPage});
	// 썸네일과 같은 플레이어 연결 검증을 사용하되 이미지를 만들지 않는 조회입니다.
	// 별도 파일이나 다른 프레임에 현재 방송 제목이 섞이지 않도록 후보를 고른 뒤 조회합니다.
	const bSingleStream = IsSingleDocumentStream(Saved, Candidate);
	const Identity = await ReadPreviews(TabId, Candidate.documentId ?? Saved.documentId,
	[{ id: Candidate.id, url: Candidate.url, variants: Candidate.variants ?? [], selectedSource: Candidate.selectedSource }],
	{ metadataOnly: true, singleStream: bSingleStream }, PreviewPage);
	const MediaTitle = Identity?.find?.(Entry => Entry.id === Candidate.id)?.mediaTitle?.trim();
	const PageTitle = Saved.pageTitle?.trim() ?? '';
	const Item = { ...Candidate, singleStream: bSingleStream, page: Saved.page, previewPage: PreviewPage,
		pageTitle: MediaTitle && !PageTitle.includes(MediaTitle)
		? [PageTitle, MediaTitle].filter(Boolean).join(RuntimePolicy.Filename.TitleSeparator) : PageTitle };
	if (!Candidate.observedVariants?.length)
	{
		return Item;
	}
	return { ...Item, observedVariants: Allowed.slice(1) };
}

function PagePlayerOptions(Item, Page, DocumentId)
{
	if (Item.format === 'YOUTUBE') return {pagePlayer: true};
	if (Page && Item.format === 'MP4' && Item.documentId === DocumentId && IdentifyBilibiliPage(Page) &&
		Item.sourceIdentity?.startsWith('bilibili:')) return {pagePlayer: true};
	if (!Page || Item.format !== 'MP4' || Item.documentId !== DocumentId || !IsMetaCdnUrl(Item.url)) return {};
	const Identity = MetaReelIdentity(Page);
	return Identity && Item.sourceIdentity === `${Identity.site}:${Identity.id}`
		? {pagePlayer: true, metaReelPlayer: true} : {};
}

async function ReadPreviews(TabId, DocumentId, Candidates, FrameSize, Page = null)
{
	if (FrameSize === ThumbnailFrame && Page)
	{
		const Current = IdentifyYoutubeUrl(Page);
		Candidates = Candidates.map(Item =>
		{
			const Video = Item.pagePlayer && !Item.metaReelPlayer && IdentifyYoutubeUrl(Item.url);
			// Bind the cover to the validated current video. Hover/capture requests
			// keep using decoded player frames; only list/job stills get this hint.
			return Video && Video.videoId === Current?.videoId
				? {...Item, thumbnailUrl: `https://i.ytimg.com/vi/${Video.videoId}/mqdefault.jpg`} : Item;
		});
	}
	if (FrameSize === ThumbnailFrame && Candidates.length === 1 && Candidates[0].pagePlayer === true && DocumentId && Page)
	{
		const Item = Candidates[0];
		const Previews = await SharedThumbnails.read({tabId: TabId, documentId: DocumentId, page: Page, url: Item.url},
			() => CollectPreviews(TabId, DocumentId, Candidates, FrameSize, Page));
		return Previews.map(Preview => ({...Preview, id: Item.id}));
	}
	return CollectPreviews(TabId, DocumentId, Candidates, FrameSize, Page);
}
async function CollectPreviews(TabId, DocumentId, Candidates, FrameSize, Page)
{
	// A validated current reel may itself live inside article/link markup. Keep the
	// general card exclusion for all other sources and ambiguous multi-source batches.
	const ExcludedSelector = Candidates.length === 1 && Candidates[0].metaReelPlayer
		? RuntimePolicy.Detection.MetaReelPlayerSelector : RuntimePolicy.Detection.AuxiliaryPlayerSelector;
	const [Frame] = await chrome.scripting.executeScript({
		target: DocumentId ? { tabId: TabId, documentIds: [DocumentId] } : { tabId: TabId },
		func: CollectPlayerPreviews, args: [Candidates, {...FrameSize, excludedSelector: ExcludedSelector}, Page],
	}).catch(() => []);
	const Results = Frame?.result ?? [];
	if (Candidates.length !== 1 || !Candidates[0].metaReelPlayer || Frame?.documentId !== DocumentId || !Page) return Results;
	return Promise.all(Results.map(async Preview =>
	{
		const {viewportCrop: Crop, ...Value} = Preview;
		if (!Crop) return Value;
		const Still = await CaptureVisiblePlayerThumbnail(TabId, DocumentId, Page, Crop, FrameSize);
		return Still ? {...Value, still: Still} : Value;
	}));
}

/** A provider's dimensions describe this file; a Blob player may be decoding a different rendition. */
function WithCandidateResolution(Item, Preview)
{
	let Resolution;
	if ([Item.width, Item.height].every(Value => Number.isSafeInteger(Value) && Value > 0))
	{
		Resolution = {width: Item.width, height: Item.height};
	}
	else if (Item.format === 'M3U8')
	{
		// Match StartJob: an observed rendition is used directly; otherwise the
		// default download selects the master's highest-bandwidth rendition.
		const SelectedUrl = Item.variantUrl ?? Item.observedVariants?.[0]?.url;
		const Quality = SelectedUrl ? Item.qualities?.find(Value => Value.url === SelectedUrl)
		: Item.qualities?.reduce((Best, Value) => !Best || Value.bandwidth > Best.bandwidth ? Value : Best, undefined);
		Resolution = HlsVariantResolution(Quality);
	}
	return Resolution ? {...Preview, id: Item.id, resolution: Resolution} : Preview;
}

export async function ReadCandidateThumbnail(TabId, Item)
{
	AssertMediaAllowed({...Item, pageUrl: Item.page});
	const Previews = await ReadPreviews(TabId, Item.documentId, [{ id: Item.id, url: Item.url, variants: Item.variants ?? [], singleStream: Item.singleStream, ...PagePlayerOptions(Item, Item.previewPage, Item.documentId), selectedSource: Item.selectedSource }], ThumbnailFrame, Item.previewPage);
	return WithCandidateResolution(Item, Array.isArray(Previews) ? Previews[0] : undefined);
}

export async function CandidateSubtitleStatuses({tabId, scanId, candidateIds, scope})
{
	if (!Array.isArray(candidateIds) || candidateIds.length > 128) throw new LocalizedError('candidate_changed');
	const {subtitleTranslation: Settings = {}} = await chrome.storage.local.get('subtitleTranslation');
	const Results = [];
	// Bound page inspection concurrency; status inspection never invokes a translation API.
	for (let Index = 0; Index < candidateIds.length; Index += 3)
	{
		Results.push(...await Promise.all(candidateIds.slice(Index, Index + 3).map(async id =>
		{
			let Broadcast = {};
			try
			{
				const Item = await ResolveCandidate(tabId, scanId, id, scope);
				Broadcast = Item.format === 'YOUTUBE' ? await YoutubeBroadcastInDocument(tabId, Item.documentId, Item.page,
					IdentifyYoutubeUrl(Item.url)?.videoId) : {};
				const Tracks = [...(Item.qualities?.[0]?.subtitles || []), ...await DiscoverSubtitles(tabId, Item)];
				return {id, status: SubtitleStatus(Tracks, Settings), ...Broadcast};
			}
			catch {return {id, status: {phase: 'failed', translation: Settings.enabled ? 'unknown' : 'off'}, ...Broadcast};}
		})));
	}
	return Results;
}

export async function CandidateSubtitleOptions({tabId, scanId, candidateId, scope})
{
	const Item = await ResolveCandidate(tabId, scanId, candidateId, scope);
	const Tracks = await DiscoverSubtitles(tabId, Item);
	if (Item.format === 'MPD')
	{
		AssertMediaAllowed(Item);
		if (Item.requestContext || !await chrome.permissions.contains({origins:[HostPattern(Item.url)]})) throw new LocalizedError('subtitle_invalid');
		Tracks.push(...FindDashSubtitles(await ReadPlaylist(Item.url), Item.url));
	}
	return DescribeSubtitleTracks(Tracks);
}

export async function CandidatePreviews({ tabId: TabId, scanId: ScanId, candidateIds: CandidateIds, scope: Scope })
{
	if (!Array.isArray(CandidateIds) || !CandidateIds.length)
	{
		return [];
	}
	const Saved = await CurrentScan(TabId, ScanId, Scope);
	if (!Saved)
	{
		return [];
	}
	const Requested = new Set(CandidateIds);
	const Items = Saved.candidates.filter(Item => Item.supported && Requested.has(Item.id));
	const Allowed = await FilterAllowedNetworkCandidates(Items, TabId, Saved.documentId, Saved.page);
	const Documents = new Map();
	for (const Item of Allowed)
	{
		const { id: Id, url: Url, variants: Variants, documentId: DocumentId = Saved.documentId } = Item;
		if (!Documents.has(DocumentId))
		{
			Documents.set(DocumentId, []);
		}
		Documents.get(DocumentId).push({ id: Id, url: Url, ...(Variants ? { variants: Variants } : {}), singleStream: IsSingleDocumentStream(Saved, Item), ...PagePlayerOptions(Item, Saved.page, Saved.documentId), ...(Item.selectedSource ? { selectedSource: true } : {}) });
	}
	const Previews = await Promise.all([...Documents].map(([DocumentId, Candidates]) =>
	ReadPreviews(TabId, DocumentId, Candidates, ThumbnailFrame, DocumentId === Saved.documentId ? Saved.page : null)));
	const ById = new Map(Previews.flat().map(Preview => [Preview.id, Preview]));
	return Allowed.map(Item => WithCandidateResolution(Item, ById.get(Item.id))).filter(Boolean);
}

export async function PreviewCandidate({ tabId: TabId, scanId: ScanId, candidateId: CandidateId, scope: Scope })
{
	const Item = await ResolveCandidate(TabId, ScanId, CandidateId, Scope);
	const [PlayerPreview] = await ReadPreviews(TabId, Item.documentId, [{ id: Item.id, url: Item.url, variants: Item.variants ?? [], singleStream: Item.singleStream, ...PagePlayerOptions(Item, Item.previewPage, Item.documentId), selectedSource: Item.selectedSource }], RuntimePolicy.Preview.HoverFrame, Item.previewPage);
	const Preview = WithCandidateResolution(Item, PlayerPreview);
	// 마스터와 연결된 화질 중 이 문서에서 성공한 CDN 응답만 보호된 스트림의 미리보기에 사용합니다.
	const Playback = Item.observedVariants?.[0] ?? (Item.requestContext ? Item : undefined);
	return {
		url: ['WEBRTC', 'YOUTUBE'].includes(Item.format) ? undefined : Item.url, format: Item.format, still: Preview?.still, resolution: Preview?.resolution,
		live: Preview?.live ?? Item.live, duration: Preview?.duration,
		streamPath: StreamPreviewPath(Item.url, Item.format),
		protectedRequest: !!Playback,
		pageStream: Playback && { url: Playback.url, context: Playback.requestContext, tabId: TabId, documentId: Playback.documentId, page: Item.previewPage },
	};
}

export async function CaptureCandidatePreview({ tabId: TabId, scanId: ScanId, candidateId: CandidateId, scope: Scope })
{
	const Item = await ResolveCandidate(TabId, ScanId, CandidateId, Scope);
	return CaptureResolvedCandidatePreview(TabId, Item);
}
/** Only a worker-registered, document-bound source may use this entry. */
export async function CaptureResolvedCandidatePreview(TabId, Item)
{
	AssertMediaAllowed({...Item, pageUrl: Item.page});
	if (!IsStreamFormat(Item.format) && !['WEBRTC', 'YOUTUBE'].includes(Item.format))
	{
		return null;
	}
	const [Frame] = await chrome.scripting.executeScript({
		target: Item.documentId ? { tabId: TabId, documentIds: [Item.documentId] } : { tabId: TabId },
		func: CollectPlayerPreviews,
		args: [[{ id: Item.id, url: Item.url, pagePlayer: Item.format === 'YOUTUBE' }], {...RuntimePolicy.Preview.HoverFrame, excludedSelector: RuntimePolicy.Detection.AuxiliaryPlayerSelector}, Item.previewPage, {
				...RuntimePolicy.Preview.PlaybackCapture, format: Item.format, variants: Item.variants ?? [],
				reloadParameters: HlsReloadParameters,
			}],
	}).catch(() => []);
	return Frame?.result ?? null;
}

export function ClearScan(TabId)
{
	return chrome.storage.session.remove([ScanStorageKey(TabId), ScanStorageKey(TabId, 'sidepanel')]);
}
