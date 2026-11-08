import { ReportDebugFailure } from './lib/debug-log.js';
/**
 * 현재 문서의 플레이어와 관측한 HTTP 응답을 합쳐 다운로드 가능한 후보를 만듭니다. 서명된 주소는 브라우저 세션 안에서만 유지합니다.
 * 후보를 사용하기 직전에 문서 ID, 페이지 주소, 호스트 권한을 다시 확인합니다. 스캔 당시의 후보 번호만으로 작업을 시작하지 않습니다.
 */
import { RuntimePolicy } from './lib/runtime-policy.js';
import { ClassifyMediaUrl, HlsReloadParameters, HostPattern, IsStreamFormat, MediaResourceKey, StreamPreviewPath } from './lib/media.js';
import { FilterAllowedNetworkCandidates, IsAuxiliaryMedia, MaxObservedMediaPerTab, NetworkCandidates, ReadMediaContext } from './network.js';
import { LocalizedError } from './lib/i18n.js';
import { ScanStorageKey } from './lib/detection-cache.js';
import { CollectPlayerPreviews, ThumbnailFrame } from './lib/player-previews.js';
import { MatchesHlsVariant } from './lib/hls.js';
import { DiscoverDeclaredHls } from './lib/declared-streams.js';
import { DiscoverNativeHls } from './lib/native-hls-discovery.js';
import { DiscoverSelectedHls } from './lib/selected-hls.js';
import {WebRtcPageTask} from './lib/webrtc-page.js';
import {AssertMediaAllowed, YoutubeSourceBlocked} from './lib/youtube-source-policy.js';
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
	const SourcePlayers = Players.filter(Player => !SourceExclusion || !Player.closest(SourceExclusion));
	const SourceUrls = Player => [Player.currentSrc, Player.hasAttribute('src') ? Player.src : '',
		...[...Player.querySelectorAll('source[src]')].map(Source => Source.src)].filter(Boolean);
	return {
		page: location.href,
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

export async function FindMedia(TabId)
{
	// Chrome은 주입할 함수를 직렬화합니다. 모듈의 설정값은 함수 밖에 두고 호출 인자로 넘깁니다.
	const [Frame] = await chrome.scripting.executeScript({
		target: { tabId: TabId }, func: CollectVideos, args: [MaxPlaybackObservations, RuntimePolicy.Detection.AuxiliaryPlayerSelector, RuntimePolicy.Detection.SourcePlayerSelector],
	});
	const { page: Page, sources: Sources, playlists: Playlists } = Frame.result;
	if (YoutubeSourceBlocked({page: Page})) return {documentId: Frame.documentId, page: Page, observed: [], items: []};
	if (!['http:', 'https:'].includes(new URL(Page).protocol))
	{
		return null;
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
	if (await DiscoverNativeHls(TabId, Frame.documentId, Page, Sources, Observed))
	{
		Observed = (await NetworkCandidates(TabId, Frame.documentId)).filter(IsCurrentSource);
	}
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
	const AllowedObserved = Observed.filter(Item => !IsAuxiliary(Item.url, Item.documentId, undefined, Item.format)).map(Item =>
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
		return { ...Item, ...(Live !== undefined ? { live: Live } : {}), qualities: Qualities, variants: Qualities.map(Quality => Quality.url) };
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
	const Items = new Map();
	for (const Item of [...Direct.filter(Item => Item.supported && !IsStreamFormat(Item.format)), ...AllowedObserved, ...Playback.values(), ...Direct])
	{
		if (YoutubeSourceBlocked({...Item, pageUrl: Page})) continue;
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
	Master.variants?.some(Url => MediaResourceKey(Url) === MediaResourceKey(Item.url))))
	.filter(Item => !SelectedHls || Item.format !== 'M3U8' || (Item.documentId ?? Frame.documentId) !== Frame.documentId ||
	MediaResourceKey(Item.url) === SelectedHls.url);
	return { documentId: Frame.documentId, page: Page, observed: AllowedObserved, items: [...WebRtcItems, ...Roots] };
}

async function ProbeWebRtc(TabId, DocumentId, Page)
{
	const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]}, func: WebRtcPageTask,
		args: [{action: 'probe', page: Page, excludedSelector: RuntimePolicy.Detection.AuxiliaryPlayerSelector}]}).catch(() => []);
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
		const { documentId: DocumentId, page: Page, items: Items, observed: Observed } = Result;
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
			const Origin = IsStreamFormat(Item.format) && HostPattern(Item.url);
			if (Origin && !LocalPermissions.has(Origin))
			{
				LocalPermissions.set(Origin, chrome.permissions.contains({ origins: [Origin] }));
			}
			const [ServerAllowed, MediaKey] = await Promise.all([
				LocalPermissions.get(Origin), Item.supported ? MediaJobKey(Page, Item.sourceIdentity ? JSON.stringify(['playback', Item.sourceIdentity]) : Item.url) : undefined,
			]);
			const ServerPermission = Origin && !ServerAllowed ? Origin : undefined;
			return { ...Item, observedVariants: ObservedVariants, serverPermission: ServerPermission, id: Id, mediaKey: MediaKey };
		}));
		const ScanId = crypto.randomUUID();
		await chrome.storage.session.set({
			[ScanStorageKey(TabId, Scope)]: { scanId: ScanId, documentId: DocumentId, page: Page, candidates: Candidates },
		});
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
		return { scanId: ScanId, candidates: Candidates.map(({ id: Id, name: Name, format: Format, supported: Supported, live: Live, serverPermission: ServerPermission, url: Url, mediaKey: MediaKey }) => ({
				id: Id, name: Name, format: Format, supported: Supported, serverPermission: ServerPermission, mediaKey: MediaKey,
				...(Live !== undefined ? { live: Live } : {}),
				playlistPath: IsStreamFormat(Format) && PlaylistNameCounts.get(Name) > 1 ? new URL(Url).pathname : undefined,
			})) };
	}
	catch
	{
		return { restricted: true };
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

async function ReadPreviews(TabId, DocumentId, Candidates, FrameSize, Page = null)
{
	const [Frame] = await chrome.scripting.executeScript({
		target: DocumentId ? { tabId: TabId, documentIds: [DocumentId] } : { tabId: TabId },
		func: CollectPlayerPreviews, args: [Candidates, {...FrameSize, excludedSelector: RuntimePolicy.Detection.AuxiliaryPlayerSelector}, Page],
	}).catch(() => []);
	return Frame?.result ?? [];
}

export async function ReadCandidateThumbnail(TabId, Item)
{
	const Previews = await ReadPreviews(TabId, Item.documentId, [{ id: Item.id, url: Item.url, variants: Item.variants ?? [], singleStream: Item.singleStream, selectedSource: Item.selectedSource }], ThumbnailFrame, Item.previewPage);
	return Array.isArray(Previews) ? Previews[0] : undefined;
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
		Documents.get(DocumentId).push({ id: Id, url: Url, ...(Variants ? { variants: Variants } : {}), singleStream: IsSingleDocumentStream(Saved, Item), ...(Item.selectedSource ? { selectedSource: true } : {}) });
	}
	const Previews = await Promise.all([...Documents].map(([DocumentId, Candidates]) =>
	ReadPreviews(TabId, DocumentId, Candidates, ThumbnailFrame, DocumentId === Saved.documentId ? Saved.page : null)));
	return Previews.flat();
}

export async function PreviewCandidate({ tabId: TabId, scanId: ScanId, candidateId: CandidateId, scope: Scope })
{
	const Item = await ResolveCandidate(TabId, ScanId, CandidateId, Scope);
	const [Preview] = await ReadPreviews(TabId, Item.documentId, [{ id: Item.id, url: Item.url, variants: Item.variants ?? [], singleStream: Item.singleStream, selectedSource: Item.selectedSource }], RuntimePolicy.Preview.HoverFrame, Item.previewPage);
	// 마스터와 연결된 화질 중 이 문서에서 성공한 CDN 응답만 보호된 스트림의 미리보기에 사용합니다.
	const Playback = Item.observedVariants?.[0] ?? (Item.requestContext ? Item : undefined);
	return {
		url: Item.format === 'WEBRTC' ? undefined : Item.url, format: Item.format, still: Preview?.still, resolution: Preview?.resolution,
		live: Preview?.live ?? Item.live, duration: Preview?.duration,
		streamPath: StreamPreviewPath(Item.url, Item.format),
		protectedRequest: !!Playback,
		pageStream: Playback && { url: Playback.url, context: Playback.requestContext, tabId: TabId, documentId: Playback.documentId, page: Item.previewPage },
	};
}

export async function CaptureCandidatePreview({ tabId: TabId, scanId: ScanId, candidateId: CandidateId, scope: Scope })
{
	const Item = await ResolveCandidate(TabId, ScanId, CandidateId, Scope);
	if (!IsStreamFormat(Item.format) && Item.format !== 'WEBRTC')
	{
		return null;
	}
	const [Frame] = await chrome.scripting.executeScript({
		target: Item.documentId ? { tabId: TabId, documentIds: [Item.documentId] } : { tabId: TabId },
		func: CollectPlayerPreviews,
		args: [[{ id: Item.id, url: Item.url }], {...RuntimePolicy.Preview.HoverFrame, excludedSelector: RuntimePolicy.Detection.AuxiliaryPlayerSelector}, Item.previewPage, {
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
