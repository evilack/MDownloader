import { DebugLog, ReportDebugFailure } from './lib/debug-log.js';
/**
 * 미디어 HTTP 응답을 탭과 문서 단위로 기록합니다. 새 페이지에서 이전 문서의 주소를 사용할 수 없도록 문서 식별자와 접근 권한을 함께 검사합니다.
 * 동시에 온 응답은 저장 순서를 맞춰 한 응답이 다른 후보를 덮어쓰지 않게 합니다.
 */
import { RuntimePolicy } from './lib/runtime-policy.js';
import { ClassifyMediaUrl, ClassifyResponseMedia, HostPattern, IsHlsFragmentUrl, MediaResourceKey } from './lib/media.js';
import { MatchesHlsVariant, ParseMaster, ReadHlsLiveState, ReadHlsMediaResources } from './lib/hls.js';
import { ValidHlsRequestContext } from './lib/hls-request-context.js';
import { MediaContextCacheKey, MediaContextCachePrefix, NetworkCacheKey, NetworkCachePrefix, SourceMetadataCacheKey, SourceMetadataCachePrefix } from './lib/detection-cache.js';
import { NormalizeHlsProtocol } from './lib/hls-protocol.js';
import { LoadSourceProviders } from './lib/source-provider-data.js';
import { CreateMediaPageScopes } from './lib/media-page-scope.js';
import {YoutubeSourceBlocked} from './lib/youtube-source-policy.js';
export const MaxObservedMediaPerTab = RuntimePolicy.Detection.MaxObservedMedia;
const MediaResponseStatus = new Set([200, 206]);
let Writes = Promise.resolve();
const ObservedHeaders = new Map();
const DeclaredSourceProbes = new Map();
const RequestPages = new Map();
const PreviewScopes = new Map();
const PageScopes = CreateMediaPageScopes(async TabId =>
{
	const Tab = await chrome.tabs?.get(TabId);
	return HostPattern(Tab?.url) ? Tab.url : undefined;
});
const MediaRoles = new Set(['preview', 'ad', 'playback']);
function DeclaredSourceKey(TabId, DocumentId, Url)
{
	return JSON.stringify([TabId, DocumentId, MediaResourceKey(Url)]);
}

export function ObservePageUrl(TabId, Page)
{
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('PageChanged', () => ({ tabId: TabId }));
	}
	if (HostPattern(Page))
	{
		PageScopes.update(TabId, Page);
	}
	else
	{
		PageScopes.forget(TabId);
	}
}

/** GET을 시작할 때 페이지를 캡처합니다. 응답이 늦게 끝나도 새 페이지로 재분류하지 않습니다. */
export function ObserveRequestStart(Details)
{
	if (Details.tabId < 0 || !Details.documentId || Details.method !== 'GET' || !HostPattern(Details.initiator))
	{
		return;
	}
	const Scope = PreviewScopes.get(JSON.stringify([Details.tabId, Details.documentId]));
	const bPreview = Scope?.previewOnly === true;
	RequestPages.set(Details.requestId, PageScopes.capture(Details.tabId).then(Page => ({ ...Page, previewOnly: bPreview })));
	if (RequestPages.size > RuntimePolicy.Detection.MaxPendingHeaders)
	{
		RequestPages.delete(RequestPages.keys().next().value);
	}
}

function MediaContextUrl(Value)
{
	if (typeof Value !== 'string' || Value.length > RuntimePolicy.Detection.MaxUrlChars || !HostPattern(Value))
	{
		return null;
	}
	// HTTP 요청에 미디어 프래그먼트는 전송되지 않습니다. 서명된 쿼리는 그대로 비교합니다.
	return MediaResourceKey(Value);
}

export function ObserveMediaContext(Sender, { timeOrigin: TimeOrigin, media: Media, page: Page, previewOnly: PreviewOnly })
{
	if (Sender.id !== chrome.runtime.id || !HostPattern(Sender.url) || !Sender.documentId ||
	!Number.isInteger(Sender.tab?.id) || Sender.tab.id < 0 ||
	(Sender.documentLifecycle && Sender.documentLifecycle !== 'active') ||
	!Number.isFinite(TimeOrigin) || !Array.isArray(Media) || Media.length > MaxObservedMediaPerTab)
	{
		return;
	}
	if (Page !== undefined && (!HostPattern(Page) || new URL(Page).origin !== new URL(Sender.url).origin))
	{
		return;
	}
	if (typeof PreviewOnly === 'boolean')
	{
		// 미리보기 요청의 소유권은 시작 시점에 고정합니다. 포인터가 나간 뒤 끝난 응답도
		// 본편 후보로 다시 나타나지 않게 문서별 범위를 별도로 기억합니다.
		PreviewScopes.set(JSON.stringify([Sender.tab.id, Sender.documentId]), { tabId: Sender.tab.id, previewOnly: PreviewOnly });
		if (PreviewScopes.size > RuntimePolicy.Detection.MaxObservedMedia)
		{
			PreviewScopes.delete(PreviewScopes.keys().next().value);
		}
	}
	const Reports = Media.flatMap(Pair =>
	{
		if (!Array.isArray(Pair) || !MediaRoles.has(Pair[1]))
		{
			return [];
		}
		const Url = MediaContextUrl(Pair[0]);
		return Url ? [[Url, Pair[1]]] : [];
	});
	if (!Reports.length && typeof PreviewOnly !== 'boolean')
	{
		return;
	}
	const Key = MediaContextCacheKey(Sender.tab.id);
	return Write(async () =>
	{
		const Stored = (await chrome.storage.session.get(Key))[Key] ?? [];
		const Previous = Stored.find(Frame => Frame.documentId === Sender.documentId);
		const Roles = new Map(Page && Previous?.page !== Page ? [] : Previous?.media);
		let bChanged = (Page !== undefined && Previous?.page !== Page) ||
		(typeof PreviewOnly === 'boolean' && Previous?.previewOnly !== PreviewOnly);
		for (const [Url, Role] of Reports)
		{
			// 같은 문서에서 본편으로 확인한 정확한 주소는 나중에 카드가 재사용해도 계속 제공됩니다.
			if (Roles.get(Url) === 'playback' || Roles.get(Url) === Role)
			{
				continue;
			}
			Roles.delete(Url);
			Roles.set(Url, Role);
			bChanged = true;
		}
		if (!bChanged)
		{
			return;
		}
		const Current = { documentId: Sender.documentId, timeOrigin: TimeOrigin, ...(Page ? { page: Page } : {}),
			...(typeof PreviewOnly === 'boolean' ? { previewOnly: PreviewOnly } : {}),
			media: [...Roles].slice(-RuntimePolicy.Detection.MaxMediaContextUrls) };
		await chrome.storage.session.set({ [Key]: [Current, ...Stored.filter(Frame => Frame !== Previous)]
			.slice(0, RuntimePolicy.Detection.MaxMediaContextDocuments) });
	});
}

export async function ReadMediaContext(TabId)
{
	await Writes;
	const Key = MediaContextCacheKey(TabId);
	const NetworkKey = NetworkCacheKey(TabId);
	const [ContextData, NetworkData] = await Promise.all([
		chrome.storage.session.get(Key), chrome.storage.session.get(NetworkKey),
	]);
	const Context = ContextData[Key] ?? [];
	const Observed = NetworkData[NetworkKey] ?? [];
	const ByDocument = new Map();
	const ByTimeOrigin = new Map();
	for (const Frame of Context)
	{
		const Roles = new Map(Frame.media);
		ByDocument.set(Frame.documentId, Roles);
		ByTimeOrigin.set(Frame.timeOrigin, ByTimeOrigin.has(Frame.timeOrigin) ? null : Roles);
	}
	// 호버가 시작될 때 받은 마스터의 역할을 실제로 연결된 화질에도 적용합니다.
	// 새로 발급된 토큰은 별도 주소로 남으며 다른 문서의 플레이어 역할은 섞이지 않습니다.
	for (const Item of Observed)
	{
		if (!ByDocument.has(Item.documentId))
		{
			ByDocument.set(Item.documentId, new Map());
		}
		const Roles = ByDocument.get(Item.documentId);
		if (Item.mediaRole && Roles.get(MediaResourceKey(Item.url)) !== 'playback')
		{
			Roles.set(MediaResourceKey(Item.url), Item.mediaRole);
		}
		if (Item.invalidPlaylist)
		{
			Roles.set(MediaResourceKey(Item.url), 'probe');
		}
		for (const Url of Item.resources ?? [])
		{
			const Resource = MediaResourceKey(Url);
			if (Roles.get(Resource) !== 'playback')
			{
				Roles.set(Resource, 'fragment');
			}
		}
		// 워커가 받은 재생목록 본문은 페이지 관측기에 전달되지 않을 수 있습니다.
		// 먼저 저장된 MP4도 같은 문서에서 확인한 HLS의 부분 조각 규칙과 맞으면 목록에서 제외합니다.
		// 디렉터리·화질 접두사·init/part 표기가 함께 일치해야 하므로 같은 폴더의 일반 MP4는 유지합니다.
		for (const Resource of Observed)
		{
			if (Resource.documentId === Item.documentId && IsHlsFragmentUrl(Item.url, Resource.url))
			{
				Roles.set(MediaResourceKey(Resource.url), 'fragment');
			}
		}
		const Role = Roles?.get(MediaResourceKey(Item.url));
		if (!Role)
		{
			continue;
		}
		for (const Url of Item.variants ?? [])
		{
			const Matches = Observed.filter(Entry => Entry.documentId === Item.documentId && Entry.format === Item.format &&
			Entry.url !== Item.url && MatchesHlsVariant(Url, Entry.url));
			const Resource = MediaResourceKey(Matches.length === 1 ? Matches[0].url : Url);
			if (Roles.get(Resource) !== 'playback')
			{
				Roles.set(Resource, Role);
			}
		}
	}
	return { byDocument: ByDocument, byTimeOrigin: ByTimeOrigin };
}

export function IsAuxiliaryMedia(Context, Url, DocumentId, TimeOrigin)
{
	const Roles = DocumentId === undefined ? Context.byTimeOrigin.get(TimeOrigin) : Context.byDocument.get(DocumentId);
	const Role = Roles && Roles.get(MediaContextUrl(Url));
	return Role === 'preview' || Role === 'ad' || Role === 'fragment' || Role === 'probe';
}

export function ClassifyResponse(Details)
{
	if (YoutubeSourceBlocked(Details)) return null;
	if (Details.tabId < 0 || !Details.documentId ||
	(Details.frameId !== 0 && !(Details.frameId > 0 && Details.parentFrameId === 0 && Details.parentDocumentId)) ||
	!HostPattern(Details.initiator) || Details.method !== 'GET' ||
	!MediaResponseStatus.has(Details.statusCode) ||
	(Details.documentLifecycle && Details.documentLifecycle !== 'active'))
	{
		return null;
	}
	const Mime = Details.responseHeaders?.find(Header => Header.name.toLowerCase() === 'content-type')
	?.value?.split(';', 1)[0].trim().toLowerCase();
	return ClassifyResponseMedia(Details.url, Mime);
}

function HasOrigins(Urls, PermissionChecks)
{
	const Origins = Urls.map(HostPattern);
	if (!Origins.every(Boolean))
	{
		return false;
	}
	const Unique = [...new Set(Origins)].sort();
	const Key = Unique.join('\n');
	if (PermissionChecks?.has(Key))
	{
		return PermissionChecks.get(Key);
	}
	const Allowed = chrome.permissions.contains({ origins: Unique });
	PermissionChecks?.set(Key, Allowed);
	return Allowed;
}

function Write(Operation)
{
	Writes = Writes.then(Operation).catch(ErrorValue => ReportDebugFailure(ErrorValue, 'NetworkCacheFailed'));
	return Writes;
}

export function ObserveRequest(Details)
{
	if (Details.tabId < 0 || Details.frameId < 0 || Details.method !== 'GET' ||
	ClassifyMediaUrl(Details.url)?.format !== 'M3U8' || !Details.documentId)
	{
		return;
	}
	const ServerOrigin = new URL(Details.url).origin;
	const Header = Name => Details.requestHeaders?.find(Value => Value.name.toLowerCase() === Name)?.value;
	const Context = { serverOrigin: ServerOrigin, origin: Header('origin'), referer: Header('referer') };
	if (Context.origin !== Details.initiator || !ValidHlsRequestContext(Context))
	{
		return;
	}
	ObservedHeaders.set(Details.requestId, { documentId: Details.documentId, url: Details.url, context: Context });
	if (ObservedHeaders.size > RuntimePolicy.Detection.MaxPendingHeaders)
	{
		ObservedHeaders.delete(ObservedHeaders.keys().next().value);
	}
}

export function ForgetRequest(Details)
{
	ObservedHeaders.delete(Details.requestId);
	RequestPages.delete(Details.requestId);
}

export function ObserveResponse(Details)
{
	const HttpRequest = ObservedHeaders.get(Details.requestId);
	const PageSnapshot = RequestPages.get(Details.requestId);
	ForgetRequest(Details);
	if (YoutubeSourceBlocked(Details)) return;
	const Candidate = ClassifyResponse(Details);
	if (Candidate && DebugLog.IsEnabled())
	{
		DebugLog.Record('Observation', () => ({ tabId: Details.tabId, status: Details.statusCode }));
	}
	if (!Candidate)
	{
		return ObserveSourceMetadata(Details);
	}
	const Probe = DeclaredSourceProbes.get(DeclaredSourceKey(Details.tabId, Details.documentId, Details.url));
	const DeclaredPage = Probe && new URL(Probe.page).origin === Details.initiator ? Probe.page : undefined;
	const Key = NetworkCacheKey(Details.tabId);
	return Write(async () =>
	{
		if (!await HasOrigins([Details.initiator, Details.url]))
		{
			return;
		}
		const Scope = await PageSnapshot;
		if (YoutubeSourceBlocked({page: Scope?.page, ...Details})) return;
		if (Scope?.stale)
		{
			return;
		}
		// 이전 페이지의 늦은 응답은 해당 문서에만 기록합니다. 새 문서의 후보에는 섞이지 않습니다.
		const Stored = (await chrome.storage.session.get(Key))[Key] ?? [];
		const ResourceKey = MediaResourceKey(Details.url);
		// MP4 확장자를 가진 초기화 파일과 부분 조각도 실제 재생목록에 속하면 독립 파일이 아닙니다.
		if (Stored.some(Item => Item.documentId === Details.documentId &&
		(Item.resources?.includes(ResourceKey) || IsHlsFragmentUrl(Item.url, Details.url))))
		{
			return;
		}
		const Entry = { ...Candidate, documentId: Details.documentId, initiator: Details.initiator };
		if (Scope?.page)
		{
			Entry.page = Scope.page;
		}
		if (Details.frameId > 0)
		{
			Entry.frameId = Details.frameId;
			Entry.parentDocumentId = Details.parentDocumentId;
		}
		const Previous = Stored.find(Item => MediaResourceKey(Item.url) === ResourceKey && Item.documentId === Entry.documentId);
		if (Scope?.previewOnly || Previous?.mediaRole === 'preview')
		{
			Entry.mediaRole = 'preview';
		}
		if (!Scope?.page && Previous?.page)
		{
			Entry.page = Previous.page;
		}
		if (Entry.format === 'M3U8')
		{
			const bSamePlaylist = Previous?.format === Entry.format;
			if (bSamePlaylist && Previous.live !== undefined)
			{
				Entry.live = Previous.live;
			}
			if (DeclaredPage)
			{
				Entry.declaredPage = DeclaredPage;
			}
			else if (bSamePlaylist && Previous.declaredPage)
			{
				Entry.declaredPage = Previous.declaredPage;
			}
			if (bSamePlaylist && Previous.variants)
			{
				Entry.variants = Previous.variants;
			}
			if (bSamePlaylist && Previous.qualities)
			{
				Entry.qualities = Previous.qualities;
			}
			if (bSamePlaylist && Previous.resources)
			{
				Entry.resources = Previous.resources;
			}
			if (bSamePlaylist && Previous.invalidPlaylist)
			{
				Entry.invalidPlaylist = true;
			}
			if (HttpRequest?.url === Entry.url && HttpRequest.documentId === Entry.documentId)
			{
				Entry.requestContext = HttpRequest.context;
			}
			else if (bSamePlaylist && Previous.requestContext)
			{
				Entry.requestContext = Previous.requestContext;
			}
		}
		// Chrome 저장소에서 읽은 객체는 필드 순서가 달라질 수 있습니다.
		// 직렬화한 문자열 대신 실제 값으로 비교해 같은 미리보기 요청이 목록을 다시 만들지 않게 합니다.
		if (Previous && Previous.initiator === Entry.initiator && Previous.format === Entry.format &&
		Previous.page === Entry.page && Previous.declaredPage === Entry.declaredPage && Previous.mediaRole === Entry.mediaRole &&
		Previous.name === Entry.name && Previous.requestContext?.origin === Entry.requestContext?.origin &&
		Previous.requestContext?.referer === Entry.requestContext?.referer &&
		Previous.requestContext?.serverOrigin === Entry.requestContext?.serverOrigin)
		{
			return;
		}
		const Entries = [Entry, ...Stored.filter(Item => MediaResourceKey(Item.url) !== ResourceKey || Item.documentId !== Entry.documentId)];
		if (Entries.length <= MaxObservedMediaPerTab)
		{
			await chrome.storage.session.set({ [Key]: Entries });
			return;
		}
		const ContextKey = MediaContextCacheKey(Details.tabId);
		const Context = (await chrome.storage.session.get(ContextKey))[ContextKey] ?? [];
		const Roles = new Map(Context.map(Frame => [Frame.documentId, new Map(Frame.media)]));
		const Main = [];
		const Auxiliary = [];
		for (const Item of Entries)
		{
			const Role = Roles.get(Item.documentId)?.get(MediaResourceKey(Item.url));
			const bAuxiliary = IsAuxiliaryMedia({ byDocument: Roles }, Item.url, Item.documentId) ||
			(Item.mediaRole === 'preview' && Role !== 'playback');
			(bAuxiliary ? Auxiliary : Main).push(Item);
		}
		// 카드 요청이 계속 들어와도 일반 후보의 보관 공간을 잠식하지 않게 따로 제한합니다.
		// 같은 주소가 나중에 본편에 쓰이면 관측한 응답과 허용된 요청 문맥을 다시 쓸 수 있습니다.
		await chrome.storage.session.set({ [Key]: [...Main.slice(0, MaxObservedMediaPerTab), ...Auxiliary.slice(0, MaxObservedMediaPerTab)] });
	});
}

/** 본문·쿠키·토큰은 저장하지 않고, 같은 출처에서 성공한 방송 정보 요청의 주소만 문서와 연결합니다. */
async function ObserveSourceMetadata(Details)
{
	if (Details.tabId < 0 || Details.frameId !== 0 || !Details.documentId || Details.method !== 'GET' ||
	Details.statusCode !== 200 || !HostPattern(Details.initiator) ||
	new URL(Details.url).origin !== Details.initiator ||
	(Details.documentLifecycle && Details.documentLifecycle !== 'active'))
	{
		return;
	}
	const Mime = Details.responseHeaders?.find(Header => Header.name.toLowerCase() === 'content-type')?.value;
	if (!/^application\/json(?:;|$)/i.test(Mime ?? ''))
	{
		return;
	}
	const Providers = await LoadSourceProviders();
	if (!Object.values(Providers).some(Provider => typeof Provider?.metadataPathPattern === 'string' &&
	new RegExp(Provider.metadataPathPattern).test(new URL(Details.url).pathname)))
	{
		return;
	}
	return Write(async () =>
	{
		if (!await HasOrigins([Details.initiator]))
		{
			return;
		}
		const Key = SourceMetadataCacheKey(Details.tabId);
		const Stored = (await chrome.storage.session.get(Key))[Key] ?? [];
		if (Stored.some(Item => Item.documentId === Details.documentId && Item.url === Details.url))
		{
			return;
		}
		await chrome.storage.session.set({ [Key]: [{ documentId: Details.documentId, url: Details.url }, ...Stored]
			.slice(0, RuntimePolicy.Detection.MaxObservedMedia) });
	});
}

export async function ReadSourceMetadataUrls(TabId, DocumentId)
{
	await Writes;
	const Key = SourceMetadataCacheKey(TabId);
	const Items = (await chrome.storage.session.get(Key))[Key] ?? [];
	return Items.filter(Item => Item.documentId === DocumentId).map(Item => Item.url).reverse();
}

/**
 * 워커의 탐색기가 HTTP 요청을 시작하기 전에 소유 페이지를 등록합니다.
 * 헤더 수신 시점부터 후보가 노출되므로 본문 완료 후에만 연결하면 SPA 전환 중 이전 방송이 섞입니다.
 * 응답 기록과 연결 해제를 모두 기다리고, 중첩 요청이 새 소유권을 덮어쓴 경우에는 그 요청을 지우지 않습니다.
 */
export async function WithDeclaredSourceProbe(TabId, DocumentId, Page, Url, Operation)
{
	if (!Number.isInteger(TabId) || TabId < 0 || !DocumentId || !HostPattern(Page) || !HostPattern(Url))
	{
		return null;
	}
	const Key = DeclaredSourceKey(TabId, DocumentId, Url);
	const Probe = { page: Page };
	DeclaredSourceProbes.set(Key, Probe);
	try
	{
		await BindDeclaredSource(TabId, DocumentId, Page, Url);
		return await Operation();
	}
	finally
	{
		try
		{
			if (DeclaredSourceProbes.get(Key) === Probe)
			{
				await BindDeclaredSource(TabId, DocumentId, Page, Url);
			}
		}
		finally
		{
			if (DeclaredSourceProbes.get(Key) === Probe)
			{
				DeclaredSourceProbes.delete(Key);
			}
		}
	}
}

/** 성공한 응답만 같은 문서·출처·정확한 주소의 소유 페이지에 연결합니다. */
export function BindDeclaredSource(TabId, DocumentId, Page, Url)
{
	if (!Number.isInteger(TabId) || TabId < 0 || !DocumentId || !HostPattern(Page) || !HostPattern(Url))
	{
		return;
	}
	return Write(async () =>
	{
		if (!await HasOrigins([Page, Url]))
		{
			return;
		}
		const Key = NetworkCacheKey(TabId);
		const Stored = (await chrome.storage.session.get(Key))[Key] ?? [];
		let bChanged = false;
		const Updated = Stored.map(Item =>
		{
			if (Item.documentId !== DocumentId || Item.format !== 'M3U8' || Item.initiator !== new URL(Page).origin ||
			MediaResourceKey(Item.url) !== MediaResourceKey(Url) || Item.declaredPage === Page)
			{
				return Item;
			}
			bChanged = true;
			return { ...Item, declaredPage: Page };
		});
		if (bChanged)
		{
			await chrome.storage.session.set({ [Key]: Updated });
		}
	});
}

export function ObserveManifest(Sender, { url: Url, text: TextValue, page: Page })
{
	if (YoutubeSourceBlocked({url: Url, page: Page, frameUrl: Sender.url, initiator: Sender.origin})) return;
	if (!Number.isInteger(Sender.frameId) || Sender.frameId < 0 || !Sender.documentId || !Number.isInteger(Sender.tab?.id) ||
	typeof Url !== 'string' || typeof TextValue !== 'string' || TextValue.length > RuntimePolicy.Detection.MaxObservedManifestBytes)
	{
		return;
	}
	const Key = NetworkCacheKey(Sender.tab.id);
	return Write(async () =>
	{
		let Stored = (await chrome.storage.session.get(Key))[Key] ?? [];
		let Item = Stored.find(Entry => MediaResourceKey(Entry.url) === MediaResourceKey(Url) && Entry.documentId === Sender.documentId &&
		Entry.initiator === Sender.origin && Entry.format === 'M3U8');
		if (!Item || !await HasOrigins([Item.initiator, Item.url]))
		{
			return;
		}
		if (Sender.frameId === 0 && HostPattern(Page) && new URL(Page).origin === Sender.origin && Item.page !== Page)
		{
			// 같은 문서에서 SPA 이동 후 새 페이지가 관측한 소유권을 이전 본문으로 되돌리지 않습니다.
			if (Item.page)
			{
				return;
			}
			const Updated = { ...Item, page: Page };
			Stored = Stored.map(Entry => Entry === Item ? Updated : Entry);
			Item = Updated;
			await chrome.storage.session.set({ [Key]: Stored });
		}
		if (TextValue.trimStart().split(/\r?\n/, 1)[0] !== '#EXTM3U')
		{
			if (!Item.invalidPlaylist)
			{
				await chrome.storage.session.set({
					[Key]: Stored.map(Entry => Entry === Item ? { ...Item, invalidPlaylist: true } : Entry),
				});
			}
			return;
		}
		TextValue = await NormalizeHlsProtocol(TextValue, Url);
		const Qualities = ParseMaster(TextValue, Url)?.reverse();
		if (!Qualities)
		{
			const Live = ReadHlsLiveState(TextValue);
			const Resources = ReadHlsMediaResources(TextValue, Url).map(MediaResourceKey);
			if (!Resources.length && Live === undefined)
			{
				return;
			}
			// 최근 라이브 창에서 사라진 조각도 보관해 늦은 HTTP 응답이 후보로 되살아나지 않게 합니다.
			const Recent = new Set(Resources);
			const Merged = [...(Item.resources ?? []).filter(Resource => !Recent.has(Resource)), ...Recent]
			.slice(-RuntimePolicy.Transfer.MaxSegments);
			const ResourcesSet = new Set(Merged);
			const Entries = Stored.filter(Entry => Entry === Item || Entry.documentId !== Sender.documentId ||
			!ResourcesSet.has(MediaResourceKey(Entry.url))).map(Entry => Entry === Item
			? { ...Item, ...(Live !== undefined ? { live: Live } : {}), resources: Merged, invalidPlaylist: false } : Entry);
			if (Item.invalidPlaylist || Item.live !== Live || JSON.stringify(Item.resources) !== JSON.stringify(Merged) || Entries.length !== Stored.length)
			{
				await chrome.storage.session.set({ [Key]: Entries });
			}
			return;
		}
		if (!Item.invalidPlaylist && Qualities.length === Item.qualities?.length && Qualities.every((Quality, Index) =>
		{
			const Previous = Item.qualities[Index];
			return Quality.url === Previous.url && Quality.bandwidth === Previous.bandwidth &&
			Quality.resolution === Previous.resolution && Quality.audioUrl === Previous.audioUrl;
		}))
		{
			return;
		}
		const Variants = Qualities.map(Variant => Variant.url);
		await chrome.storage.session.set({ [Key]: Stored.map(Entry => Entry === Item ? { ...Item, variants: Variants, qualities: Qualities, invalidPlaylist: false } : Entry) });
	});
}

export async function NetworkCandidates(TabId, DocumentId)
{
	await Writes;
	const Key = NetworkCacheKey(TabId);
	const Items = (await chrome.storage.session.get(Key))[Key] ?? [];
	return FilterAllowedNetworkCandidates(Items, TabId, DocumentId);
}

async function FrameDocument(TabId, FrameId)
{
	try
	{
		const [Frame] = await chrome.scripting.executeScript({
			target: { tabId: TabId, frameIds: [FrameId] }, func: () =>
			{
			},
		});
		return Frame?.documentId;
	}
	catch
	{
		return undefined;
	}
}

export async function FilterAllowedNetworkCandidates(Items, TabId, DocumentId, Page)
{
	// 권한과 프레임 확인 결과는 이 조회 동안에만 재사용합니다.
	// 같은 주소라도 프레임이 이동했거나 권한이 해제됐다면 다음 조회에서 반영해야 합니다.
	const Frames = new Map();
	const PermissionChecks = new Map();
	const Allowed = await Promise.all(Items.map(async Item =>
	{
		if (YoutubeSourceBlocked({...Item, pageUrl: Page})) return false;
		if (Page !== undefined && Item.page && Item.page !== Page)
		{
			return false;
		}
		if (Page !== undefined && Item.declaredPage && Item.declaredPage !== Page)
		{
			return false;
		}
		if (!Item.initiator)
		{
			return true;
		}
		if (Item.frameId)
		{
			if (Item.parentDocumentId !== DocumentId)
			{
				return false;
			}
			if (!Frames.has(Item.frameId))
			{
				Frames.set(Item.frameId, FrameDocument(TabId, Item.frameId));
			}
			if (Item.documentId !== await Frames.get(Item.frameId))
			{
				return false;
			}
		}
		else if (Item.documentId !== DocumentId)
		{
			return false;
		}
		return HasOrigins([Item.initiator, Item.url], PermissionChecks);
	}));
	return Items.filter((_item, Index) => Allowed[Index]);
}

export function ForgetNetwork(TabId)
{
	PageScopes.forget(TabId);
	for (const [Key, Scope] of PreviewScopes)
	{
		if (TabId === undefined || Scope.tabId === TabId)
		{
			PreviewScopes.delete(Key);
		}
	}
	return Write(async () =>
	{
		if (TabId !== undefined)
		{
			return chrome.storage.session.remove([NetworkCacheKey(TabId), MediaContextCacheKey(TabId), SourceMetadataCacheKey(TabId)]);
		}
		const Keys = Object.keys(await chrome.storage.session.get(null)).filter(Key =>
		Key.startsWith(NetworkCachePrefix) || Key.startsWith(MediaContextCachePrefix) || Key.startsWith(SourceMetadataCachePrefix));
		await chrome.storage.session.remove(Keys);
	});
}
