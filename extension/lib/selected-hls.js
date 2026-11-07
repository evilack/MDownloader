/**
 * 주소가 없는 워커 영상에서는 요청 URL 개수로 영상 개수를 결정할 수 없습니다.
 * 영상 요소에 직접 연결된 플레이어의 읽기 API가 선택한 소스를 제공하는 경우에만
 * 그 주소를 대표로 사용합니다. URL 모양·호스트·방송 이름으로 관계를 추측하지 않습니다.
 */
import {RuntimePolicy} from './runtime-policy.js';
import {MediaResourceKey, HostPattern, ClassifyMediaUrl} from './media.js';
import {ObserveManifest, NetworkCandidates, ReadSourceMetadataUrls, WithDeclaredSourceProbe} from '../network.js';
import {LoadSourceProviders} from './source-provider-data.js';
import {ProbeHlsVariants} from './declared-streams.js';
const Attempts = new Map();
const Renewals = new Map();
export async function DiscoverSelectedHls(TabId, DocumentId, Page, Observed)
{
	const Items = Observed.filter(Item => Item.documentId === DocumentId && Item.initiator === new URL(Page).origin && Item.format === 'M3U8');
	const ProbeKey = Url => JSON.stringify([TabId, DocumentId, Page, Url]);
	const ReadUrls = Items.filter(Item => !Item.qualities?.length &&
	Date.now() - (Attempts.get(ProbeKey(Item.url)) ?? 0) >= RuntimePolicy.Detection.NativeManifestRetryMs).map(Item => Item.url);
	try
	{
		const Providers = await LoadSourceProviders().catch(() => ({}));
		const RenewalKey = ProbeKey('metadata');
		const Cached = Renewals.get(RenewalKey);
		const Options = {allowedUrls: Items.map(Item => Item.url), readUrls: ReadUrls,
			maxAncestors: RuntimePolicy.Detection.MaxPlayerComponentAncestors, maxHooks: RuntimePolicy.Detection.MaxPlayerHooks,
			maxIdentityLength: RuntimePolicy.Detection.MaxSourceIdentityChars,
			excludedSelector: RuntimePolicy.Detection.SourcePlayerSelector, descriptor: Providers.reactPlayback,
			metadataUrls: await ReadSourceMetadataUrls(TabId, DocumentId),
			maxMetadataRequests: RuntimePolicy.Detection.MaxMetadataProbes,
			renewal: Cached && Date.now() - Cached.at < RuntimePolicy.Detection.MetadataRefreshMs ? Cached.source : undefined,
			maxBytes: RuntimePolicy.Detection.MaxObservedManifestBytes, timeoutMs: RuntimePolicy.Detection.NativeManifestTimeoutMs};
		async function Run(Fields)
		{
			const [Frame] = await chrome.scripting.executeScript({
				target: {tabId: TabId, documentIds: [DocumentId]}, world: 'MAIN', func: ReadSelectedHls,
				args: [Page, {...Options, ...Fields}],
			});
			return Frame?.documentId === DocumentId ? Frame.result : null;
		}
		let Selected = await Run();
		if (ClassifyMediaUrl(Selected?.url)?.format !== 'M3U8')
		{
			return null;
		}
		const bObserved = Items.some(Item => Item.url === Selected.url);
		if (!bObserved && !Selected.declared && !Selected.bound)
		{
			return null;
		}
		if (!await chrome.permissions.contains({origins: [...new Set([HostPattern(Page), HostPattern(Selected.url)])]}))
		{
			return null;
		}
		if (Selected.declared && (!Options.renewal || Selected.ownerUrl !== Cached.source.ownerUrl || Selected.url !== Cached.source.url))
		{
			const {url, ownerUrl, sourceIdentity, live: Live} = Selected;
			Renewals.set(RenewalKey, {at: Date.now(), source: {url, ownerUrl, sourceIdentity, live: Live}});
			if (Renewals.size > RuntimePolicy.Detection.MaxObservedMedia)
			{
				Renewals.delete(Renewals.keys().next().value);
			}
		}
		// 새로 발급된 주소는 응답 전에 소유 문서를 연결하고, 실제 성공 응답이
		// 관측 저장소에 기록된 경우에만 다운로드 후보로 인정합니다.
		if (!bObserved || (!Selected.text && !Items.find(Item => Item.url === Selected.url)?.qualities?.length && ReadUrls.includes(Selected.url)))
		{
			Selected = await WithDeclaredSourceProbe(TabId, DocumentId, Page, Selected.url,
			() => Run({allowedUrls: [...Options.allowedUrls, Selected.url], readUrls: [Selected.url], renewal: Selected.declared ? Selected : Options.renewal}));
			if (!Selected)
			{
				return null;
			}
		}
		if (ReadUrls.includes(Selected.url))
		{
			Attempts.set(ProbeKey(Selected.url), Date.now());
			if (Attempts.size > RuntimePolicy.Detection.MaxObservedMedia)
			{
				Attempts.delete(Attempts.keys().next().value);
			}
		}
		if (typeof Selected.text === 'string')
		{
			await ObserveManifest(
			{tab: {id: TabId}, documentId: DocumentId, frameId: 0, origin: new URL(Page).origin},
			{url: Selected.url, text: Selected.text, page: Page});
		}
		let Current = await NetworkCandidates(TabId, DocumentId);
		const Master = Current.find(Item => Item.url === Selected.url && Item.documentId === DocumentId && (!Item.page || Item.page === Page));
		if (!Master)
		{
			return null;
		}
		const Missing = Master.qualities?.filter(Quality => !Current.some(Item => Item.url === Quality.url && Item.documentId === DocumentId && Item.requestContext));
		if (Missing?.length)
		{
			await ProbeHlsVariants(TabId, DocumentId, Page, Missing);
		}
		return {url: MediaResourceKey(Selected.url), ...(Selected.live === true ? {live: true} : {}),
			...(Selected.sourceIdentity ? {sourceIdentity: Selected.sourceIdentity} : {})};
	}
	catch
	{
		return null;
	}
}

/** 주입 함수는 모듈 스코프를 참조할 수 없으므로 필요한 상한을 호출부에서 전달합니다. */
export async function ReadSelectedHls(Page, Options)
{
	let bLive, bDeclared, bBound;
	const At = (Value, Path) => Path?.reduce((Current, Field) => Current?.[Field], Value);
	function ReadValue(Value, Player)
	{
		if (!Value || typeof Value !== 'object')
		{
			return null;
		}
		try
		{
			if (typeof Value.getHTMLVideoElement === 'function' && typeof Value.getPath === 'function' && Value.getHTMLVideoElement() === Player)
			{
				const Address = Value.getPath();
				if (typeof Address === 'string')
				{
					const Url = new URL(Address);
					if (!['http:', 'https:'].includes(Url.protocol) || Url.username || Url.password || !/\.m3u8$/i.test(Url.pathname))
					{
						return null;
					}
					// 워커의 마스터가 관측 목록에서 빠져도 실제 영상 요소에 연결된
					// 선택 API는 현재 소스의 근거입니다. 이 표시는 다운로드 허가가 아니라
					// 권한 확인 후 마스터 응답을 새로 관측하기 위한 조회 후보입니다.
					bBound = !Options.allowedUrls.includes(Url.href);
					try
					{
						if (Value.getDuration?.() === Infinity)
						{
							bLive = true;
						}
					}
					catch
					{
					}
					return Url.href;
				}
			}
			const Descriptor = Options.descriptor;
			if (!Descriptor || typeof Value[Descriptor.sourceField] !== 'string' || typeof Value[Descriptor.pageField] !== 'string' ||
			new URL(Value[Descriptor.pageField], Page).href !== Page)
			{
				return null;
			}
			const Url = new URL(Value[Descriptor.sourceField]);
			if (!['http:', 'https:'].includes(Url.protocol) || Url.username || Url.password || !/\.m3u8$/i.test(Url.pathname))
			{
				return null;
			}
			bDeclared = true;
			if (Value[Descriptor.typeField] === Descriptor.liveValue)
			{
				bLive = true;
			}
			return Url.href;
		}
		catch
		{
			return null;
		}
	}
	function CurrentSource()
	{
		bLive = undefined;
		bDeclared = false;
		bBound = false;
		if (location.href !== Page)
		{
			return null;
		}
		const Players = [...document.querySelectorAll('video, audio')].filter(Player =>
		!Options.excludedSelector || !Player.closest(Options.excludedSelector));
		// 여러 플레이어의 소유권이나 카드의 역할을 추측하지 않습니다. 둘 이상이면 기존 후보 목록을 유지합니다.
		if (Players.length !== 1)
		{
			return null;
		}
		const Player = Players[0];
		let ElementValue = Player;
		while (ElementValue && !Object.keys(ElementValue).some(Key => Key.startsWith('__reactFiber')))
		{
			ElementValue = ElementValue.parentElement;
		}
		const FiberKey = ElementValue && Object.keys(ElementValue).find(Key => Key.startsWith('__reactFiber'));
		let Component = ElementValue?.[FiberKey];
		for (let Index = 0; Component && Index < Options.maxAncestors; Index++, Component = Component.return)
		{
			const Props = Component.memoizedProps;
			for (const Value of Object.values(Props ?? {}))
			{
				const Url = ReadValue(Value, Player);
				if (Url)
				{
					return Url;
				}
			}
			// 함수형 플레이어가 상태/참조 훅에 보관한 선언도 같은 영상의 상위
			// 구성요소 안에서만 읽습니다. 계정·채팅 상태를 재귀 탐색하지 않습니다.
			let Hook = Component.memoizedState;
			for (let Index = 0; Hook && Index < (Options.maxHooks ?? 0); Index++, Hook = Hook.next)
			{
				const Url = ReadValue(Hook.memoizedState, Player) ?? ReadValue(Hook.memoizedState?.current, Player);
				if (Url)
				{
					return Url;
				}
			}
		}
		return null;
	}
	const OwnerUrl = CurrentSource();
	if (!OwnerUrl)
	{
		return null;
	}
	let Url = OwnerUrl, SourceIdentity;
	async function ReadText(Address, Credentials, Cache)
	{
		const Response = await fetch(Address, {credentials: Credentials, cache: Cache, redirect: 'error', signal: AbortSignal.timeout(Options.timeoutMs)});
		const Reader = Response.body?.getReader();
		if (!Reader)
		{
			return null;
		}
		let Bytes = 0, TextValue = '';
		const Decoder = new TextDecoder();
		try
		{
			if (Response.status !== 200)
			{
				return null;
			}
			for (; ; )
			{
				const {done: Done, value} = await Reader.read();
				if (Done)
				{
					break;
				}
				Bytes += value.byteLength;
				if (Bytes > Options.maxBytes)
				{
					return null;
				}
				TextValue += Decoder.decode(value, {stream: true});
			}
			return TextValue + Decoder.decode();
		}
		finally
		{
			await Reader.cancel().catch(() =>
			{
			});
			Reader.releaseLock();
		}
	}
	if (bDeclared && Options.descriptor?.refresh)
	{
		const Cached = Options.renewal;
		if (Cached?.ownerUrl === OwnerUrl)
		{
			Url = Cached.url;
			SourceIdentity = Cached.sourceIdentity;
		}
		else
		{
			const Descriptor = Options.descriptor, Mapping = Descriptor.refresh;
			const Pattern = new RegExp(Descriptor.metadataPathPattern);
			const Entries = typeof performance?.getEntriesByType === 'function' ? performance.getEntriesByType('resource').map(Entry => Entry.name) : [];
			const Addresses = [...new Set([...(Options.metadataUrls ?? []), ...Entries])].filter(Address =>
			{
				try
				{
					const Url = new URL(Address);
					return Url.origin === new URL(Page).origin && Pattern.test(Url.pathname);
				}
				catch
				{
					return false;
				}
			});
			for (const Address of Addresses.reverse().slice(0, Options.maxMetadataRequests ?? Addresses.length))
			{
				try
				{
					const Metadata = JSON.parse(await ReadText(Address, 'same-origin', 'no-store'));
					const Identity = At(Metadata, Mapping.identityPath);
					const Expected = decodeURIComponent(new URL(Page).pathname.split('/').filter(Boolean).at(-1) ?? '');
					const Fresh = new URL(At(Metadata, Mapping.sourcePath));
					if (typeof Identity !== 'string' || Identity.toLowerCase() !== Expected.toLowerCase() || At(Metadata, Mapping.livePath) !== true ||
					!['http:', 'https:'].includes(Fresh.protocol) || Fresh.username || Fresh.password || !/\.m3u8$/i.test(Fresh.pathname))
					{
						continue;
					}
					Url = Fresh.href;
					const StreamId = At(Metadata, Mapping.streamIdPath);
					if ((typeof StreamId === 'string' || typeof StreamId === 'number') && String(StreamId).length <= Options.maxIdentityLength)
					{
						SourceIdentity = String(StreamId);
					}
					break;
				}
				catch
				{
					/* 실패한 메타데이터는 다른 채널이나 이전 주소로 바꾸어 추측하지 않습니다. */
				}
			}
		}
	}
	const SelectedLive = bLive;
	const bSelectedDeclared = bDeclared;
	const bSelectedBound = bBound;
	function Result(TextValue)
	{
		// 요청 중 소스나 페이지가 바뀌면 이전 방송의 상태도 함께 버립니다.
		if (CurrentSource() !== OwnerUrl)
		{
			return null;
		}
		return {url: Url, ...(SelectedLive === true ? {live: true} : {}), ...(TextValue ? {text: TextValue} : {}),
			...(bSelectedBound ? {bound: true} : {}),
			...(bSelectedDeclared ? {declared: true, ownerUrl: OwnerUrl} : {}), ...(SourceIdentity ? {sourceIdentity: SourceIdentity} : {})};
	}
	if (!Options.readUrls.includes(Url))
	{
		return Result();
	}
	try
	{
		// 마스터를 재생성하면 별도 세션의 화질 주소가 발급될 수 있으므로 브라우저 캐시를 우선합니다.
		const TextValue = await ReadText(Url, 'omit', 'force-cache');
		return Result(TextValue?.trimStart().split(/\r?\n/, 1)[0] === '#EXTM3U' ? TextValue : undefined);
	}
	catch
	{
		return Result();
	}
}
