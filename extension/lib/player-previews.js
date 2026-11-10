/**
 * 페이지에 주입되는 함수는 확장의 모듈 스코프에 접근할 수 없습니다. 검사할 후보와 이미지 크기를 호출 인자로 받아 플레이어를 찾고, 허용된 프레임만 읽습니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
export const ThumbnailFrame = RuntimePolicy.Preview.ThumbnailFrame;

// Chrome이 직렬화해서 주입하는 함수이므로 외부 모듈의 지역 변수에 접근할 수 없습니다.
// 워커가 검증한 후보와 이미지 크기만 인자로 받아 처리합니다.
export function CollectPlayerPreviews(Candidates, { maxWidth: MaxWidth, maxHeight: MaxHeight, jpegQuality: JpegQuality, metadataOnly: bMetadataOnly, singleStream: bSingleStream, excludedSelector: ExcludedSelector }, Page, Capture)
{
	if (Page && location.href !== Page)
	{
		return [];
	}
	const Frames = [window];
	const Pending = new Map(Candidates.map(Item => [Item.id, Item.url]));
	const Variants = new Map(Candidates.map(Item => [Item.id, Item.variants ?? []]));
	const SingleStreams = new Set(Candidates.filter(Item => Item.singleStream).map(Item => Item.id));
	const SelectedSources = new Set(Candidates.filter(Item => Item.selectedSource).map(Item => Item.id));
	const PageSources = new Set(Candidates.filter(Item => Item.pagePlayer === true).map(Item => Item.id));
	const MetaReelSources = new Set(Candidates.filter(Item => Item.metaReelPlayer === true).map(Item => Item.id));
	const Results = new Map();
	const Thumbnails = new Map(!Capture && !bMetadataOnly && Page
		? Candidates.filter(Item => Item.thumbnailUrl && Item.pagePlayer).map(Item => [Item.id, Item.thumbnailUrl]) : []);
	// A video cover exists independently of a decoded frame (paused/loading players).
	// The exact document URL was checked above, including after SPA navigation.
	for (const [Id, Still] of Thumbnails) Results.set(Id, {id: Id, still: Still});

	// 주입 함수는 모듈을 가져올 수 없으므로, 워커가 넘긴 표준 갱신 쿼리 이름으로 비교 키를 만듭니다.
	// 실제 요청 주소는 바꾸지 않습니다. 서명·인증 쿼리는 그대로 남아 다른 세션과 구분됩니다.
	function PlaybackKey(Address)
	{
		if (!Address)
		{
			return Address;
		}
		const Url = new URL(Address);
		const Fields = Url.search.slice(1).split('&');
		const Kept = Fields.filter(Field => !Capture?.reloadParameters?.includes(Field.split('=', 1)[0]));
		if (Kept.length !== Fields.length)
		{
			Url.search = Kept.length ? '?' + Kept.join('&') : '';
		}
		Url.hash = '';
		return Url.href;
	}

	async function RecordClip(Player, IsCurrent)
	{
		if (Player.paused || Player.ended || !Player.videoWidth || !Player.videoHeight || Player.mediaKeys ||
		typeof Player.requestVideoFrameCallback !== 'function' || !IsCurrent())
		{
			return null;
		}
		let Stream;
		let FrameId;
		let Recorder;
		let bReadable = true;
		try
		{
			const Source = Player.currentSrc || Player.src;
			const StreamSource = Player.srcObject;
			const StartTime = Player.currentTime;
			// 원본 플레이어의 스트림을 캡처하거나 중단하지 않고 별도 캔버스에 복사한 프레임만 녹화합니다.
			const Canvas = Player.ownerDocument.createElement('canvas');
			const Scale = Math.min(MaxWidth / Player.videoWidth, MaxHeight / Player.videoHeight, 1);
			Canvas.width = Math.max(1, Math.round(Player.videoWidth * Scale));
			Canvas.height = Math.max(1, Math.round(Player.videoHeight * Scale));
			const Context = Canvas.getContext('2d');
			function Paint()
			{
				if (!IsCurrent())
				{
					bReadable = false;
					if (Recorder?.state === 'recording') Recorder.stop();
					return;
				}
				try
				{
					Context.drawImage(Player, 0, 0, Canvas.width, Canvas.height);
					FrameId = Player.requestVideoFrameCallback(Paint);
				}
				catch
				{
					bReadable = false;
					if (Recorder?.state === 'recording')
					{
						Recorder.stop();
					}
				}
			}
			Paint();
			if (!bReadable)
			{
				return null;
			}
			Stream = Canvas.captureStream();
			const Video = Stream.getVideoTracks().find(Track => !Track.muted && Track.readyState === 'live');
			if (!Video)
			{
				return null;
			}
			const LocalMimeType = 'video/webm';
			Recorder = new MediaRecorder(new MediaStream([Video]), {
				mimeType: LocalMimeType, videoBitsPerSecond: Capture.bitsPerSecond,
			});
			const Clip = await new Promise(Resolve =>
			{
				const Parts = [];
				let Bytes = 0;
				let End;
				let Deadline;
				function Finish(Value)
				{
					clearTimeout(End);
					clearTimeout(Deadline);
					Resolve(Value);
				}
				Recorder.addEventListener('dataavailable', ({ data: Data }) =>
				{
					Bytes += Data.size;
					if (Data.size && Bytes <= Capture.maxBytes)
					{
						Parts.push(Data);
					}
				});
				Recorder.addEventListener('error', () => Finish(null), { once: true });
				Recorder.addEventListener('stop', () => Finish(Bytes && Bytes <= Capture.maxBytes
				? new Blob(Parts, { type: LocalMimeType }) : null), { once: true });
				Recorder.start();
				End = setTimeout(() =>
				{
					if (Recorder.state !== 'inactive')
					{
						Recorder.stop();
					}
				}, Capture.durationMs);
				Deadline = setTimeout(() => Finish(null), Capture.timeoutMs);
			});
			if (!Clip || !bReadable || Video.muted || (Player.currentSrc || Player.src) !== Source || Player.srcObject !== StreamSource ||
			Player.currentTime <= StartTime || !IsCurrent())
			{
				return null;
			}
			return await new Promise(Resolve =>
			{
				const Reader = new FileReader();
				Reader.onload = () => Resolve(Reader.result);
				Reader.onerror = () => Resolve(null);
				Reader.readAsDataURL(Clip);
			});
		}
		catch
		{
			return null;
		}
		finally
		{
			if (FrameId !== undefined)
			{
				Player.cancelVideoFrameCallback(FrameId);
			}
			if (Recorder && Recorder.state !== 'inactive')
			{
				Recorder.stop();
			}
			// 종료 대상은 위에서 만든 캔버스의 트랙입니다.
			for (const Track of Stream?.getTracks() ?? [])
			{
				Track.stop();
			}
		}
	}

	function Snapshot(Player, Thumbnail, MetaReel)
	{
		const Live = Player.duration === Infinity ? { live: true } : {};
		const Duration = Number.isFinite(Player.duration) && Player.duration > 0 ? Player.duration : undefined;
		const Resolution = Player.videoWidth > 0 && Player.videoHeight > 0
		? { resolution: { width: Player.videoWidth, height: Player.videoHeight } } : {};
		if (Thumbnail) return {still: Thumbnail, duration: Duration, ...Live, ...Resolution};
		const Poster = /^https?:\/\//i.test(Player.poster ?? '') ? Player.poster : undefined;
		// 재생 위치가 처음이면 영상의 첫 프레임 대신 플레이어 표지 이미지를 사용합니다.
		// 재생이 진행된 뒤에는 현재 프레임을 읽습니다.
		if (Poster && Player.currentTime === 0)
		{
			return { still: Poster, duration: Duration, ...Live, ...Resolution };
		}
		let Still, ViewportCrop;
		if (Player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Player.videoWidth)
		{
			try
			{
				const Canvas = Player.ownerDocument.createElement('canvas');
				const Scale = Math.min(MaxWidth / Player.videoWidth, MaxHeight / Player.videoHeight, 1);
				Canvas.width = Math.max(1, Math.round(Player.videoWidth * Scale));
				Canvas.height = Math.max(1, Math.round(Player.videoHeight * Scale));
				Canvas.getContext('2d').drawImage(Player, 0, 0, Canvas.width, Canvas.height);
				Still = Canvas.toDataURL('image/jpeg', JpegQuality);
			}
			catch
			{
				/* 출처가 다른 영상은 Chrome이 캔버스 픽셀 읽기를 거부할 수 있습니다. */
				if (MetaReel && Player.currentSrc)
				{
					const Bounds = Player.getBoundingClientRect();
					const X = Math.max(0, Bounds.left), Y = Math.max(0, Bounds.top);
					ViewportCrop = {source: Player.currentSrc, x: X, y: Y,
						width: Math.min(window.innerWidth, Bounds.right) - X, height: Math.min(window.innerHeight, Bounds.bottom) - Y,
						viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, excludedSelector: ExcludedSelector};
				}
			}
		}
		return { still: Still ?? Poster, duration: Duration, ...Live, ...Resolution, ...(ViewportCrop ? {viewportCrop: ViewportCrop} : {}) };
	}

	for (const Frame of Frames)
	{
		if (!Pending.size)
		{
			break;
		}
		try
		{
			const Players = [...Frame.document.querySelectorAll('video, audio')].filter(Player => !ExcludedSelector || !Player.closest(ExcludedSelector));
			const Active = bSingleStream || bMetadataOnly || SingleStreams.size
			? Players.filter(Entry => !Entry.paused && !Entry.ended && Entry.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) : [];
			const BySource = new Map();
			const ByPlayer = new Map();
			for (const Player of Players)
			{
				const Sources = Player.currentSrc ? [Player.currentSrc] : [Player.src,
					...[...Player.querySelectorAll('source[src]')].map(Source => Source.src)];
				for (const Track of Player.srcObject?.getVideoTracks?.() ?? []) Sources.push('webrtc:' + encodeURIComponent(Track.id));
				for (const Src of Sources)
				{
					if (Src && !BySource.has(Src))
					{
						BySource.set(Src, Player);
					}
				}
			}
			const OnlyPlayer = Players.length === 1 ? Players[0] : undefined;
			const Source = OnlyPlayer?.currentSrc || OnlyPlayer?.src;
			// 목록 미리보기 등 다른 영상 요소가 있어도 현재 프레임을 가진 화면상의 blob 플레이어를 찾습니다.
			// 여러 개가 조건을 충족하면 어떤 플레이어가 재생목록을 썼는지 단정할 수 없습니다.
			const VisibleStreams = OnlyPlayer ? [] : Players.filter(Player =>
			{
				const PlayerSource = Player.currentSrc || Player.src;
				if (!PlayerSource?.startsWith('blob:') || !Player.videoWidth ||
				Player.readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
				{
					return false;
				}
				const Bounds = Player.getBoundingClientRect();
				return Bounds.width > 0 && Bounds.height > 0;
			});
			const StreamPlayer = OnlyPlayer && (!Source || Source.startsWith('blob:'))
			? OnlyPlayer : VisibleStreams.length === 1 ? VisibleStreams[0] : undefined;
			// 정적 썸네일 조회 한 번에서는 같은 프레임의 관측 스냅샷을 공유합니다.
			// 아래 RecordClip의 실시간 소유권 검사는 캡처 도중 문서 전환을 잡아야 하므로 별도로 유지합니다.
			const ResourceEntries = StreamPlayer ? Frame.performance.getEntriesByType('resource') : [];
			// A provider may bind its canonical page (not a media URL) to one decoded visible player.
			// The worker must have validated this exact top-level document; never borrow child/ambiguous players.
			const PagePlayers = Page && Frame === window && PageSources.size === 1 && Candidates.length === 1
				? Players.filter(Player =>
				{
					if (!Player.videoWidth || Player.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
					const Bounds = Player.getBoundingClientRect();
					if (MetaReelSources.size && Frame.getComputedStyle)
					{
						for (let Node = Player; Node; Node = Node.parentElement)
						{
							const Style = Frame.getComputedStyle(Node);
							if (Node === Player && Style.visibility !== 'visible' || Style.opacity === '0') return false;
						}
					}
					return Bounds.width > 0 && Bounds.height > 0 && (!MetaReelSources.size ||
						Bounds.bottom > 0 && Bounds.right > 0 && Bounds.top < Frame.innerHeight && Bounds.left < Frame.innerWidth);
				}) : [];
			for (const [Id, Url] of Pending)
			{
				const Related = new Set([Url, ...(Capture?.variants ?? Variants.get(Id))].map(PlaybackKey));
				const Latest = StreamPlayer && ResourceEntries.findLast(Entry =>
				['fetch', 'xmlhttprequest'].includes(Entry.initiatorType) && [0, 200, 206].includes(Entry.responseStatus) &&
				(/\.(m3u8|mpd)(?:[?#]|$)/i.test(Entry.name) || Related.has(PlaybackKey(Entry.name))));
				// blob URL은 재생목록과 주소가 다르므로 같은 문서에서 요청한 재생목록에만 연결합니다.
				const Direct = BySource.get(Url);
				const FromPlayback = StreamPlayer && Frame.performance.getEntriesByName(Url, 'resource').length && Related.has(PlaybackKey(Latest?.name));
				// 워커에서 요청한 재생목록은 문서의 Resource Timing에 나타나지 않습니다.
				// 이 경우 같은 문서의 스트림 후보와 재생 플레이어가 각각 하나일 때만 제목을 연결합니다.
				// 현재 플레이어의 소유 주소를 별도로 검증한 후보는 서명이 갱신되어도 같은 방송입니다.
				// 이전 서명 주소의 요청 기록 때문에 현재 프레임을 버리지 않습니다. 이 보충 연결은
				// 정확한 문서의 단일 재생 요소에서 이미지·제목을 읽을 때만 쓰며 녹화에는 쓰지 않습니다.
				const bWorkerSource = (bSingleStream || SingleStreams.has(Id)) && (!Latest || SelectedSources.has(Id)) && !Capture && Frame === window && Active.length === 1 && Active[0] === StreamPlayer;
				const PagePlayer = PageSources.has(Id) && PagePlayers.length === 1 ? PagePlayers[0] : undefined;
				const Player = Direct ?? PagePlayer ?? (FromPlayback || bWorkerSource ? StreamPlayer : undefined);
				if (!Player)
				{
					continue;
				}
				const Owner = Frame.MDownloaderMediaPage?.players.get(Player);
				if (Owner && Owner.page !== Frame.location.href)
				{
					continue;
				}
				if (bMetadataOnly)
				{
					// Media Session은 문서 전체의 정보입니다. 현재 재생 중인 플레이어가 하나이고
					// 선택한 주소가 그 플레이어와 연결될 때만 방송 제목을 사용합니다.
					// 이 경로는 캔버스·녹화·재생 상태를 건드리지 않습니다.
					const MediaTitle = Frame.navigator?.mediaSession?.metadata?.title;
					if (Active.length === 1 && Active[0] === Player && MediaTitle)
					{
						Results.set(Id, { id: Id, mediaTitle: MediaTitle });
					}
					continue;
				}
				if (Capture)
				{
					const PageSource = Player.currentSrc || Player.src, PageObject = Player.srcObject;
					const Manifest = Capture.format === 'MPD' ? /\.mpd(?:[?#]|$)/i : /\.m3u8(?:[?#]|$)/i;
					// 플레이어가 다른 영상을 틀어도 이전 리소스 기록은 남습니다.
					// 가장 최근에 요청한 화질만 현재 영상으로 보고 녹화합니다.
					return RecordClip(Player, () =>
					{
						if (Page && location.href !== Page)
						{
							return false;
						}
						if (PagePlayer)
						{
							const CurrentPlayers = [...Frame.document.querySelectorAll('video, audio')].filter(Entry =>
								(!ExcludedSelector || !Entry.closest(ExcludedSelector)) && Entry.videoWidth > 0 &&
								Entry.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Entry.getBoundingClientRect().width > 0 && Entry.getBoundingClientRect().height > 0);
							const CurrentOwner = Frame.MDownloaderMediaPage?.players.get(Player);
							return CurrentPlayers.length === 1 && CurrentPlayers[0] === Player && Player.isConnected !== false &&
								(Player.currentSrc || Player.src) === PageSource && Player.srcObject === PageObject &&
								(!CurrentOwner || CurrentOwner.page === Frame.location.href);
						}
						if (Direct)
						{
							if (Url.startsWith('webrtc:')) return Player.srcObject?.getVideoTracks?.().some(Track =>
								Track.readyState === 'live' && 'webrtc:' + encodeURIComponent(Track.id) === Url);
							return (Player.currentSrc || Player.src) === Url;
						}
						const Latest = Frame.performance.getEntriesByType('resource').findLast(Entry =>
						['fetch', 'xmlhttprequest'].includes(Entry.initiatorType) &&
						// 다른 출처의 요청은 재생이 가능해도 리소스 상태 코드가 0으로 보일 수 있습니다.
						// 후보 주소는 앞서 별도 검증을 거쳤으므로 여기서는 재생목록 연결만 확인합니다.
						[0, 200, 206].includes(Entry.responseStatus) && (Related.has(PlaybackKey(Entry.name)) || Manifest.test(Entry.name)));
						return Related.has(PlaybackKey(Latest?.name));
					});
				}
				if (!ByPlayer.has(Player))
				{
					ByPlayer.set(Player, Snapshot(Player, Thumbnails.get(Id), MetaReelSources.has(Id)));
				}
				const Preview = ByPlayer.get(Player);
				if (Preview.still || Preview.duration || Preview.resolution)
				{
					Results.set(Id, { id: Id, ...Preview });
				}
				if (Preview.still)
				{
					Pending.delete(Id);
				}
			}
			// 제목 조회는 워커가 고른 정확한 문서에서만 합니다. 부모의 후보 수를
			// 자식에게 재사용하면 관계없는 내장 플레이어의 방송 제목이 섞일 수 있습니다.
			if (!bMetadataOnly)
			{
				for (let Index = 0; Index < Frame.length; Index++)
				{
					Frames.push(Frame.frames[Index]);
				}
			}
		}
		catch
		{
			/* 다른 출처의 플레이어는 권한을 확인한 프레임 단위 요청에서 처리합니다. */
		}
	}
	return Capture ? null : [...Results.values()];
}
