/**
 * 기본 HLS 요청이나 관측기 설치 전에 끝난 Blob 플레이어의 요청은 본문 관측에서 빠질 수 있습니다.
 * 실제 영상 요소와 같은 문서에서 이미 관측한 주소만 제한적으로 다시 읽어
 * 마스터-화질 관계를 기존 네트워크 캐시에 보충합니다. 영상의 src나 재생 상태는 변경하지 않습니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { ClassifyMediaUrl, MediaResourceKey } from './media.js';
import { ObserveManifest } from '../network.js';

// 재시도 간격과 진행 중인 조회의 공유만 담당하는 임시 캐시입니다.
// 화질·주소 관계의 실제 결과는 기존 chrome.storage.session 네트워크 캐시에 남습니다.
const Probes = new Map();
export async function DiscoverNativeHls(TabId, DocumentId, Page, Sources, Observed, Options = {})
{
	const NativeUrls = new Set(Sources.filter(Url => ClassifyMediaUrl(Url)?.format === 'M3U8').map(MediaResourceKey));
	if (!NativeUrls.size && !Options.opaquePlayer)
	{
		return false;
	}
	const Origin = new URL(Page).origin;
	const Items = Observed.filter(Item => Item.format === 'M3U8' && Item.documentId === DocumentId &&
	Item.initiator === Origin && (NativeUrls.has(MediaResourceKey(Item.url)) ||
	(Options.opaquePlayer && !Item.qualities?.length && typeof Item.live !== 'boolean' &&
	!Observed.some(Master => Master.documentId === DocumentId && Master.variants?.some(Url => MediaResourceKey(Url) === MediaResourceKey(Item.url))))));
	// 네트워크 캐시는 최신 응답부터 저장합니다. Blob의 초기 마스터를 먼저 읽어
	// 화질·파일명 추측 없이 실제 마스터-화질 관계를 복구합니다.
	if (Options.opaquePlayer) Items.reverse();
	const Work = Items.map(Item =>
	{
		const Key = JSON.stringify([TabId, DocumentId, Page, Item.url]);
		return { Item, Key, Previous: Probes.get(Key) };
	}).filter(({ Previous }) => Previous?.pending || !Previous || Date.now() - Previous.started >= RuntimePolicy.Detection.NativeManifestRetryMs);
	const Results = await Promise.all(Work.slice(0, RuntimePolicy.Detection.NativeManifestProbesPerScan).map(async ({ Item, Key, Previous }) =>
	{
		if (Previous?.pending)
		{
			return Previous.pending;
		}
		if (Previous && Date.now() - Previous.started < RuntimePolicy.Detection.NativeManifestRetryMs)
		{
			return false;
		}
		const Probe = { started: Date.now() };
		Probes.set(Key, Probe);
		if (Probes.size > RuntimePolicy.Detection.MaxObservedMedia)
		{
			Probes.delete(Probes.keys().next().value);
		}
		Probe.pending = (async () =>
		{
			try
			{
				const [Frame] = await chrome.scripting.executeScript({
					target: { tabId: TabId, documentIds: [DocumentId] }, func: ReadNativeHlsManifest,
					args: [Page, Item.url, RuntimePolicy.Detection.MaxObservedManifestBytes, RuntimePolicy.Detection.NativeManifestTimeoutMs,
						{...Options, includeCredentials: Item.requestContext?.includeCredentials === true}],
				});
				if (Frame?.documentId !== DocumentId || typeof Frame.result !== 'string')
				{
					return false;
				}
				await ObserveManifest({ tab: { id: TabId }, documentId: DocumentId, frameId: 0, origin: Origin },
				{ url: Item.url, text: Frame.result, page: Page });
				return true;
			}
			catch
			{
				// 접근 거절·CORS·페이지 변경은 기존 후보를 유지합니다. 관계를 추측해 다른 영상을 숨기지 않습니다.
				return false;
			}
			finally
			{
				Probe.pending = undefined;
			}
		})();
		return Probe.pending;
	}));
	return Results.some(Boolean);
}

/** 주입 함수이므로 외부 스코프를 사용하지 않습니다. 요청 전후의 페이지와 실제 선택 소스를 모두 확인합니다. */
export async function ReadNativeHlsManifest(Page, Address, MaxBytes, TimeoutMs, Options = {})
{
	const Key = Value =>
	{
		try
		{
			const Url = new URL(Value);
			Url.hash = '';
			return Url.href;
		}
		catch
		{
			return null;
		}
	};
	const Expected = Key(Address);
	let OpaquePlayer, OpaqueSource;
	const IsCurrent = () =>
	{
		if (location.href !== Page) return false;
		const Players = [...document.querySelectorAll('video, audio')];
		if (Players.some(Player => Key(Player.currentSrc || Player.src) === Expected)) return true;
		if (!Options.opaquePlayer) return false;
		const Main = Players.filter(Player => (!Options.excludedSelector || !Player.closest(Options.excludedSelector)) &&
			(Player.currentSrc || Player.srcObject || Player.getAttribute?.('src') || Player.querySelector?.('source[src]')));
		if (Main.length !== 1 || !Main[0].currentSrc?.startsWith('blob:')) return false;
		const Scope = globalThis.MDownloaderMediaPage;
		const Owner = Scope?.players?.get(Main[0]);
		if (Scope?.previewOnly || (Owner && Owner.page !== Page)) return false;
		if (OpaquePlayer && (Main[0] !== OpaquePlayer || Main[0].currentSrc !== OpaqueSource)) return false;
		// status 0은 교차 출처 타이밍 제한일 수 있습니다. 워커가 이미 같은 문서의
		// 성공 응답을 확인한 URL만 넘기며, 여기서는 현재 페이지의 실제 요청 기록도 확인합니다.
		if (!performance.getEntriesByType('resource').some(Entry => Key(Entry.name) === Expected &&
		['fetch', 'xmlhttprequest'].includes(Entry.initiatorType) && [0, 200, 206].includes(Entry.responseStatus) &&
		(Entry.startTime ?? 0) >= (Scope?.since ?? 0))) return false;
		OpaquePlayer = Main[0];
		OpaqueSource = Main[0].currentSrc;
		return true;
	};
	if (!Expected || !IsCurrent())
	{
		return null;
	}
	const HttpResponse = await fetch(Address, { credentials: Options.includeCredentials === true ? 'include' : 'omit', redirect: 'error',
		cache: Options.opaquePlayer ? 'force-cache' : 'no-store', signal: AbortSignal.timeout(TimeoutMs) });
	const Reader = HttpResponse.body?.getReader();
	if (!Reader)
	{
		return null;
	}
	let Size = 0;
	let TextValue = '';
	const Decoder = new TextDecoder();
	try
	{
		if (HttpResponse.status !== 200)
		{
			return null;
		}
		for (; ; )
		{
			const { done: bDone, value: Part } = await Reader.read();
			if (bDone)
			{
				break;
			}
			Size += Part.byteLength;
			if (Size > MaxBytes)
			{
				return null;
			}
			TextValue += Decoder.decode(Part, { stream: true });
		}
		TextValue += Decoder.decode();
		return IsCurrent() && TextValue.trimStart().split(/\r?\n/, 1)[0] === '#EXTM3U' ? TextValue : null;
	}
	finally
	{
		await Reader.cancel().catch(() =>
		{
		});
		Reader.releaseLock();
	}
}
