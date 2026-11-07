/**
 * MediaStream으로 본편을 보는 페이지에서 사이트가 명시한 HLS 대체 소스를 준비합니다.
 * 원본 플레이어·설정·트랙을 건드리지 않습니다. 방송 정보와 성공한 HTTP 요청을 확인한 뒤
 * 기존 네트워크 관측기에 넘기므로, 다운로드 시작 이후에는 원본 문서가 필요하지 않습니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { HostPattern } from './media.js';
import { ParseMaster } from './hls.js';
import { NormalizeHlsProtocol } from './hls-protocol.js';
import { NetworkCandidates, ObserveManifest, ReadSourceMetadataUrls, WithDeclaredSourceProbe } from '../network.js';
import { LoadSourceProviders } from './source-provider-data.js';
const Pending = new Map();

/** Chrome이 MAIN 월드에 직렬화하여 실행합니다. 원본 플레이어의 제어 함수는 호출하지 않습니다. */
export async function DeclaredStreamPageTask(Options)
{
	if (location.href !== Options.page)
	{
		return null;
	}
	async function ReadText(Address, Credentials)
	{
		const Response = await fetch(Address, { credentials: Credentials, redirect: 'error', cache: 'no-store',
			signal: AbortSignal.timeout(Options.timeoutMs) });
		if (Response.status !== 200 || !Response.body)
		{
			await Response.body?.cancel();
			return null;
		}
		const Reader = Response.body.getReader();
		const Decoder = new TextDecoder();
		let TextValue = '', Bytes = 0;
		try
		{
			for (; ; )
			{
				const { value: Chunk, done: bDone } = await Reader.read();
				if (bDone)
				{
					break;
				}
				Bytes += Chunk.byteLength;
				if (Bytes > Options.maxBytes)
				{
					return null;
				}
				TextValue += Decoder.decode(Chunk, { stream: true });
			}
			return location.href === Options.page ? TextValue + Decoder.decode() : null;
		}
		finally
		{
			await Reader.cancel().catch(() =>
			{
			});
			Reader.releaseLock();
		}
	}
	if (Options.mode === 'playlist')
	{
		const Url = new URL(Options.url);
		if (!['https:', 'http:'].includes(Url.protocol) || Url.username || Url.password)
		{
			return null;
		}
		const TextValue = await ReadText(Url.href, 'omit');
		return TextValue?.trimStart().startsWith('#EXTM3U') ? { url: Url.href, text: TextValue } : null;
	}
	// 카드의 MediaStream이나 숨은 영상은 대체 주소 탐색을 시작하지 않습니다.
	const Players = [...document.querySelectorAll('video')].filter(Player =>
	{
		const Bounds = Player.getBoundingClientRect();
		return Player.srcObject instanceof MediaStream && !Player.paused && Player.videoWidth &&
		Player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Bounds.width > 0 && Bounds.height > 0 &&
		!Player.closest('a[href], [role="link"], article, li, [role="listitem"], [data-card]') &&
		Player.srcObject.getVideoTracks().some(Track => Track.readyState === 'live');
	});
	if (Players.length !== 1)
	{
		return null;
	}
	const Provider = Options.provider;
	const At = (Value, Path) => Path.reduce((Current, Name) => Current?.[Name], Value);
	let ElementValue = Players[0];
	let ModelId;
	let RuntimeConfig;
	let bStoreRead = false;
	for (let Depth = 0; ElementValue && Depth < Provider.maxPlayerAncestors; Depth++, ElementValue = ElementValue.parentElement)
	{
		const FiberKey = Object.keys(ElementValue).find(Name => Name.startsWith('__reactFiber'));
		let Component = FiberKey && ElementValue[FiberKey];
		for (let Index = 0; Component && Index < Provider.maxComponentAncestors; Index++, Component = Component.return)
		{
			const Props = Component.memoizedProps;
			if (!ModelId && typeof Props?.[Provider.playerMarkerProperty] === 'function' &&
			Number.isSafeInteger(Props[Provider.playerIdentityProperty]) && Props[Provider.playerIdentityProperty] > 0)
			{
				ModelId = Props[Provider.playerIdentityProperty];
			}
			const Store = Props?.store ?? Props?.value?.store;
			if (!bStoreRead && typeof Store?.getState === 'function')
			{
				bStoreRead = true;
				// 게스트 페이지의 SSR에는 mode만 있고 실제 설정은 실행 중인 상태 저장소에 있습니다.
				// getState는 읽기 전용 API입니다. 계정/채팅 필드는 읽거나 열거하지 않고 지정된 공개 설정만 복사합니다.
				const State = Store.getState();
				const Settings = At(State, Provider.runtimeConfigPath);
				RuntimeConfig = { template: Settings?.[Provider.templateField], host: Settings?.[Provider.hostField],
					resolution: At(State, Provider.runtimeResolutionPath), lowLatency: At(State, Provider.runtimeLowLatencyPath) };
			}
			if (ModelId && bStoreRead)
			{
				break;
			}
		}
		if (ModelId && bStoreRead)
		{
			break;
		}
	}
	const Script = [...document.scripts].find(Item => Item.textContent.trimStart().startsWith(Provider.configAssignment));
	let Config;
	if (Script && Script.textContent.length <= Options.maxBytes)
	{
		try
		{
			const TextValue = Script.textContent.slice(Script.textContent.indexOf('=') + 1).trim().replace(/;$/, '');
			Config = JSON.parse(TextValue);
		}
		catch
		{
			/* 인라인 설정이 없으면 현재 플레이어의 공개 설정을 사용합니다. */
		}
	}
	const Settings = At(Config, Provider.configPath);
	const Template = Settings?.[Provider.templateField] ?? RuntimeConfig?.template;
	const CdnHost = Settings?.[Provider.hostField] ?? RuntimeConfig?.host;
	const Resolution = At(Config, Provider.resolutionPath) ?? RuntimeConfig?.resolution;
	const bLowLatency = At(Config, Provider.lowLatencyPath) ?? RuntimeConfig?.lowLatency;
	if (typeof Template !== 'string' || typeof CdnHost !== 'string' ||
	!/^[-a-z\d.]+$/i.test(CdnHost) || typeof Resolution !== 'string' || !/^[a-z\d]+$/i.test(Resolution))
	{
		return null;
	}
	const Pattern = new RegExp(Provider.metadataPathPattern);
	const MetadataUrls = [...(Options.metadataUrls ?? []), ...performance.getEntriesByType('resource').map(Entry => Entry.name)];
	// 방송 요청이 워커에서 실행되거나 기록이 지워졌을 때도 실제 플레이어의 식별자를 사용합니다.
	if (ModelId)
	{
		MetadataUrls.push(new URL(Provider.metadataUrlTemplate.replace('{modelId}', String(ModelId)), location.origin).href);
	}
	const Addresses = [...new Set(MetadataUrls.filter(Address =>
		{
			try
			{
				const Url = new URL(Address);
				return Url.origin === location.origin && Pattern.test(Url.pathname);
			}
			catch
			{
				return false;
			}
		}))].reverse().slice(0, Options.maxMetadataRequests);
	let PageName;
	try
	{
		PageName = decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1) ?? '');
	}
	catch
	{
		return null;
	}
	for (const Address of Addresses)
	{
		let Broadcast;
		try
		{
			Broadcast = JSON.parse(await ReadText(Address, 'same-origin')).item;
		}
		catch
		{
			continue;
		}
		// 실제 공개 방송만 취급합니다. 다른 카드의 방송이나 유료/비공개 상태는 대체 소스로 사용하지 않습니다.
		if (!Broadcast?.isLive || Broadcast.status !== 'public' || Broadcast.isBlocked || Broadcast.isDeleted ||
		typeof Broadcast.username !== 'string' || Broadcast.username.toLowerCase() !== PageName.toLowerCase() ||
		typeof Broadcast.streamName !== 'string' || !/^[a-z\d_-]+$/i.test(Broadcast.streamName))
		{
			continue;
		}
		const Fields = { cdnHost: CdnHost, streamName: Broadcast.streamName, suffix: Provider.suffixSeparator + Resolution };
		const Value = Template.replace(/\{([^}]+)\}/g, (Match, Name) => Fields[Name] ?? Match);
		if (/[{}]/.test(Value))
		{
			return null;
		}
		const Url = new URL(Value);
		if (!['https:', 'http:'].includes(Url.protocol) || Url.username || Url.password || !/\.m3u8$/i.test(Url.pathname))
		{
			return null;
		}
		if (bLowLatency)
		{
			Url.searchParams.set(Provider.latencyParameter.name, Provider.latencyParameter.value);
		}
		return { url: Url.href };
	}
	return null;
}

/** 선언된 HLS의 성공 응답과 실제 요청 문맥을 문서에 연결하는 공통 조회입니다. */
export async function ProbeHlsPlaylist(TabId, DocumentId, Page, Url)
{
	const Origins = [HostPattern(Page), HostPattern(Url)];
	if (Origins.includes(null) || !await chrome.permissions.contains({origins: [...new Set(Origins)]}))
	{
		return null;
	}
	const Playlist = await WithDeclaredSourceProbe(TabId, DocumentId, Page, Url, async () =>
	{
		const [Frame] = await chrome.scripting.executeScript({target: {tabId: TabId, documentIds: [DocumentId]}, world: 'MAIN',
			func: DeclaredStreamPageTask, args: [{mode: 'playlist', page: Page, url: Url,
					maxBytes: RuntimePolicy.Detection.MaxSourceConfigBytes, timeoutMs: RuntimePolicy.Transfer.RequestTimeoutMs}]});
		return Frame?.documentId === DocumentId ? Frame.result : null;
	});
	if (!Playlist)
	{
		return null;
	}
	await NetworkCandidates(TabId, DocumentId);
	await ObserveManifest({tab: {id: TabId}, frameId: 0, documentId: DocumentId, origin: new URL(Page).origin}, Playlist);
	return NormalizeHlsProtocol(Playlist.text, Playlist.url);
}

export async function ProbeHlsVariants(TabId, DocumentId, Page, Variants)
{
	const Lanes = RuntimePolicy.Detection.DeclaredVariantProbeLanes;
	for (let Index = 0; Index < Variants.length; Index += Lanes)
	{
		await Promise.all(Variants.slice(Index, Index + Lanes).map(Variant => ProbeHlsPlaylist(TabId, DocumentId, Page, Variant.url).catch(() => null)));
	}
}

export async function DiscoverDeclaredHls(TabId, DocumentId, Page)
{
	const Key = JSON.stringify([TabId, DocumentId, Page]);
	if (Pending.has(Key))
	{
		return Pending.get(Key);
	}
	const Operation = (async () =>
	{
		const Providers = await LoadSourceProviders();
		const Common = { page: Page, maxBytes: RuntimePolicy.Detection.MaxSourceConfigBytes,
			timeoutMs: RuntimePolicy.Transfer.RequestTimeoutMs, maxMetadataRequests: RuntimePolicy.Detection.MaxMetadataProbes };
		async function Run(Fields)
		{
			const [Frame] = await chrome.scripting.executeScript({ target: { tabId: TabId, documentIds: [DocumentId] },
				world: 'MAIN', func: DeclaredStreamPageTask, args: [{ ...Common, ...Fields }] });
			return Frame?.documentId === DocumentId ? Frame.result : null;
		}
		const Descriptor = await Run({ mode: 'discover', provider: Providers.mouflon,
			metadataUrls: await ReadSourceMetadataUrls(TabId, DocumentId) });
		if (!Descriptor)
		{
			return;
		}
		const TextValue = await ProbeHlsPlaylist(TabId, DocumentId, Page, Descriptor.url);
		if (!TextValue)
		{
			return;
		}
		const Variants = ParseMaster(TextValue, Descriptor.url)?.reverse() ?? [];
		// 마스터와 화질의 CDN이 다르면 최고 화질 하나의 요청 문맥만으로는
		// 나머지 화질을 다운로드 선택지에 안전하게 전달할 수 없습니다.
		// 사이트가 명시한 화질의 재생목록만 읽어 각각 성공 응답과 실제 헤더를 기록합니다.
		// 영상 조각을 재생하거나 원본 WebRTC 플레이어의 화질을 변경하지 않습니다.
		await ProbeHlsVariants(TabId, DocumentId, Page, Variants);
	})().finally(() => Pending.delete(Key));
	Pending.set(Key, Operation);
	return Operation;
}
