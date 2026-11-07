/**
 * 격리된 콘텐츠 스크립트에서 카드·광고 플레이어와 정확한 미디어 주소를 연결합니다.
 * 페이지의 재생이나 요청에는 개입하지 않습니다.
 */
(() =>
{
	if (globalThis.MDownloaderMediaContext)
	{
		return;
	}
	globalThis.MDownloaderMediaContext = true;
	// Navigation API는 같은 문서의 pushState/replaceState/뒤로 가기도 알려 줍니다.
	// 성능 기록을 지우지 않고 현재 페이지 시작 시각만 기억하여 사이트 플레이어의 측정에 영향을 주지 않습니다.
	const PageScope = { page: location.href, since: 0, players: new WeakMap() };
	globalThis.MDownloaderMediaPage = PageScope;
	const Policy = globalThis.MDownloaderPagePolicy;
	if (!Policy)
	{
		return;
	}
	const {MediaSelector, ThumbnailSelector, CardSelector, PreviewSelector, AdSlotSelector, PlaylistWindowMs, MaxBatch} = Policy;
	const PlaylistUrl = /^https?:\/\/[^?#]+\.(m3u8|mpd)(?:[?#]|$)/i;
	const Roles = new Map();
	const Pending = new Map();
	const Starts = new WeakMap();
	let StreamNotifications = new WeakSet();
	let Hover;
	let bFlushPending = false;
	function CheckPage()
	{
		if (PageScope.page === location.href)
		{
			return;
		}
		PageScope.page = location.href;
		PageScope.since = performance.now();
		Roles.clear();
		Pending.clear();
		StreamNotifications = new WeakSet();
		Hover = undefined;
		UpdatePreviewScope();
	}
	window.navigation?.addEventListener('currententrychange', CheckPage);
	window.addEventListener('popstate', CheckPage);
	window.addEventListener('hashchange', CheckPage);
	function CardFor(ElementValue)
	{
		const Card = ElementValue?.closest('a[href], [role="link"]') ?? ElementValue?.closest(CardSelector);
		const Link = Card?.matches('a[href]') ? Card : Card?.querySelector('a[href]');
		if (!Link || !/^https?:\/\//i.test(Link.href) ||
		Link.href.split('#', 1)[0] === location.href.split('#', 1)[0])
		{
			return null;
		}
		return Card;
	}

	function SlotFor(Media)
	{
		if (Media.closest(AdSlotSelector))
		{
			return true;
		}
		// 동일 출처 광고 프레임에서는 명시된 슬롯의 소유 관계도 읽을 수 있습니다.
		return !!window.frameElement?.closest(AdSlotSelector);
	}

	function RoleFor(Media)
	{
		if (SlotFor(Media))
		{
			return 'ad';
		}
		const Card = CardFor(Media);
		if (Media.tagName !== 'VIDEO' || !Card || !Media.muted || Media.controls)
		{
			return null;
		}
		const bMarked = Media.matches(PreviewSelector);
		const bHovering = Card === Hover?.card || Hover?.card.contains(Media);
		// XSZAV·MissAV에서 확인한 음소거·반복·상세 링크와 호버의 조합입니다.
		// 파일명이나 CDN은 판정에 쓰지 않습니다. 이미 열린 카드의 명시적 미리보기 표시도 같은 근거로 사용합니다.
		// 라이브 카드에는 loop가 없습니다. 상세 링크·표지·호버·음소거·컨트롤 없음의 조합으로 판정합니다.
		if ((bHovering || bMarked) && (bMarked || Card.querySelector(ThumbnailSelector)))
		{
			return 'preview';
		}
		return null;
	}

	function UpdatePreviewScope()
	{
		const Card = Hover?.card;
		const bMain = [...document.querySelectorAll(MediaSelector)].some(Media => !CardFor(Media) && !SlotFor(Media));
		const bPreviewOnly = !!Card?.isConnected && !!Card.querySelector(ThumbnailSelector) && !bMain;
		if (PageScope.previewOnly === bPreviewOnly)
		{
			return;
		}
		PageScope.previewOnly = bPreviewOnly;
		try
		{
			void chrome.runtime.sendMessage({ type: 'mdownloader-media-context', page: location.href,
				timeOrigin: performance.timeOrigin, media: [], previewOnly: bPreviewOnly }).catch(() =>
			{
			});
		}
		catch
		{
			/* 확장을 다시 로드하면 기존 문서의 실행 문맥은 만료됩니다. */
		}
	}

	function Report(Url, Role)
	{
		if (!/^https?:\/\//i.test(Url) || Roles.get(Url) === Role || Roles.get(Url) === 'playback')
		{
			return;
		}
		if (Roles.size >= Policy.MaxRoles)
		{
			Roles.delete(Roles.keys().next().value);
		}
		Roles.set(Url, Role);
		Pending.set(Url, Role);
		if (bFlushPending)
		{
			return;
		}
		bFlushPending = true;
		queueMicrotask(() =>
		{
			bFlushPending = false;
			const Reports = [...Pending];
			Pending.clear();
			for (let Index = 0; Index < Reports.length; Index += MaxBatch)
			{
				try
				{
					void chrome.runtime.sendMessage({ type: 'mdownloader-media-context', timeOrigin: performance.timeOrigin,
						page: PageScope.page, previewOnly: PageScope.previewOnly, media: Reports.slice(Index, Index + MaxBatch) }).catch(() =>
					{
					});
				}
				catch
				{
					/* 확장을 다시 로드하면 이미 열린 문서의 실행 문맥이 만료될 수 있습니다. */
				}
			}
		});
	}

	function ReadPlaylistRoles(Entries)
	{
		const Playlists = Entries.filter(Entry =>
		(Entry.initiatorType === 'fetch' || Entry.initiatorType === 'xmlhttprequest') && PlaylistUrl.test(Entry.name));
		if (!Playlists.length)
		{
			return;
		}
		const Now = performance.now();
		const Players = [...document.querySelectorAll(MediaSelector)].filter(Media => Media.currentSrc.startsWith('blob:') &&
		(!Media.paused || (Media.networkState === 2 && Now <= Starts.get(Media)?.until)));
		// Blob에는 원본 주소가 없습니다. 같은 문서에서 요청 시각이 연결되고 다른 Blob 플레이어가 없을 때만 연결합니다.
		if (Players.length !== 1)
		{
			return;
		}
		const Start = Starts.get(Players[0]);
		if (!Start?.role)
		{
			return;
		}
		for (const Entry of Playlists)
		{
			if (Entry.startTime >= Start.from && Entry.startTime <= Start.until)
			{
				Report(Entry.name, Start.role);
			}
		}
	}

	function Inspect(Media, EventType)
	{
		CheckPage();
		UpdatePreviewScope();
		const Role = RoleFor(Media);
		const Url = Media.currentSrc || Media.src;
		const Owner = PageScope.players.get(Media);
		if (!Owner || EventType === 'loadstart' || Owner.source !== Url || Owner.stream !== Media.srcObject)
		{
			PageScope.players.set(Media, { page: location.href, source: Url, stream: Media.srcObject });
		}
		if (PageScope.players.get(Media).page !== location.href)
		{
			return;
		}
		const Previous = Starts.get(Media);
		const Now = performance.now();
		const bMainPlayback = !Role && !CardFor(Media) && EventType === 'playing';
		if (bMainPlayback && Media.srcObject &&
		!StreamNotifications.has(Media.srcObject))
		{
			StreamNotifications.add(Media.srcObject);
			// HTTP 주소가 없는 본편도 재생 준비 시점에 대체 소스 탐색을 시작할 수 있게 알립니다.
			void chrome.runtime.sendMessage({ type: 'mdownloader-stream-ready' }).catch(() =>
			{
			});
		}
		if (EventType === 'loadstart' || !Previous || Previous.url !== Url)
		{
			Starts.set(Media, { url: Url, role: Role, from: Role === 'preview' && Hover ? Hover.since : Now - PlaylistWindowMs,
				until: Now + PlaylistWindowMs });
		}
		const Start = Starts.get(Media);
		if (Role || bMainPlayback)
		{
			Start.role = Role ?? 'playback';
		}
		if (Start.role && Url.startsWith('blob:'))
		{
			ReadPlaylistRoles(performance.getEntriesByType('resource'));
		}
		else if (bMainPlayback)
		{
			Report(Url, 'playback');
		}
		if (Role)
		{
			// 카드·광고 플레이어가 선언한 대체 소스도 직접 수집 경로에서 다시 나타나지 않게 합니다.
			Report(Url, Role);
			if (Media.hasAttribute('src'))
			{
				Report(Media.src, Role);
			}
			for (const Source of Media.querySelectorAll('source[src]'))
			{
				Report(Source.src, Role);
			}
		}
	}

	document.addEventListener('pointerover', Event =>
	{
		if (!Event.isTrusted || Event.pointerType !== 'mouse')
		{
			return;
		}
		const Card = CardFor(Event.target instanceof Element ? Event.target : null);
		if (Card !== Hover?.card)
		{
			Hover = Card ? { card: Card, since: performance.now() } : undefined;
		}
		UpdatePreviewScope();
	}, true);
	document.addEventListener('pointerout', Event =>
	{
		if (Event.isTrusted && Hover?.card.contains(Event.target) && !Hover.card.contains(Event.relatedTarget))
		{
			Hover = undefined;
		}
		UpdatePreviewScope();
	}, true);
	for (const Name of ['loadstart', 'loadedmetadata', 'playing'])
	{
		document.addEventListener(Name, Event =>
		{
			if (Event.target instanceof HTMLMediaElement)
			{
				Inspect(Event.target, Name);
			}
		}, true);
	}
	new PerformanceObserver(List => ReadPlaylistRoles(List.getEntries())).observe({ type: 'resource' });
	UpdatePreviewScope();
	for (const Media of document.querySelectorAll(MediaSelector))
	{
		Inspect(Media, Media.paused ? 'existing' : 'playing');
	}
})();
