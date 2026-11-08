/**
 * 원본 문서가 이미 받은 HLS 주소에서 미리보기 구간을 읽습니다.
 * Chrome이 문서의 출처를 적용하므로 일시정지 상태에서도 플레이어나 다운로드의 헤더 규칙을 건드리지 않습니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { LocalizedError } from './i18n.js';
import { ValidHlsRequestContext } from './hls-request-context.js';
import {AssertMediaAllowed} from './youtube-source-policy.js';
const PageRequestsKey = 'MDownloaderPreviewRequests';
export async function ReadPagePreviewResource(Source, { url: Url, range: Range }, Limit, Signal)
{
	AssertMediaAllowed({...Source, url: Url, requestContext: Source.context});
	Signal.throwIfAborted();
	if (!ValidHlsRequestContext(Source.context) || new URL(Url).origin !== Source.context.serverOrigin)
	{
		throw new LocalizedError('stream_preview_host_permission');
	}
	const RequestId = crypto.randomUUID();
	const Target = { tabId: Source.tabId, documentIds: [Source.documentId] };
	let OnAbort;
	const Canceled = new Promise((_resolve, Reject) =>
	{
		OnAbort = () =>
		{
			// 호출자 대기만 끝내지 않고 원본 문서에서 시작한 이 미리보기 요청도 중단합니다.
			void chrome.scripting.executeScript({ target: Target, func: CancelInDocument,
				args: [PageRequestsKey, RequestId, RuntimePolicy.Preview.StreamTimeoutMs] }).catch(() =>
			{
			});
			Reject(Signal.reason);
		};
		Signal.addEventListener('abort', OnAbort, { once: true });
	});
	let Frame;
	try
	{
		[Frame] = await Promise.race([Canceled, chrome.scripting.executeScript({
				target: Target, func: ReadInDocument,
				args: [Source.context.origin, Url, Range ?? null, Limit, RuntimePolicy.Preview.StreamTimeoutMs, Source.page, PageRequestsKey, RequestId],
			})]);
	}
	finally
	{
		Signal.removeEventListener('abort', OnAbort);
	}
	Signal.throwIfAborted();
	const Encoded = Frame?.result;
	if (!Encoded)
	{
		throw new LocalizedError('stream_preview_empty_segment');
	}
	const Binary = atob(Encoded);
	const Bytes = new Uint8Array(Binary.length);
	for (let Index = 0; Index < Bytes.length; Index++)
	{
		Bytes[Index] = Binary.charCodeAt(Index);
	}
	return Bytes;
}

// Chrome은 이 함수를 원본 문서에 주입합니다. 요청은 CORS를 따르며 자격 증명과 리디렉션을 사용하지 않습니다.
// 응답은 읽는 도중 크기를 검사하고, Chrome의 스크립트 결과로 전달할 수 있도록 문자열로 인코딩합니다.
async function ReadInDocument(PageOrigin, Url, Range, Limit, TimeoutMs, Page, RegistryKey, RequestId)
{
	if (location.origin !== PageOrigin || (Page && location.href !== Page) || Limit <= 0)
	{
		return null;
	}
	const Requests = globalThis[RegistryKey] ??= new Map();
	if (Requests.get(RequestId) === null)
	{
		Requests.delete(RequestId);
		return null;
	}
	const Controller = new AbortController();
	Requests.set(RequestId, Controller);
	const Timer = setTimeout(() => Controller.abort(), TimeoutMs);
	try
	{
		const HttpResponse = await fetch(Url, {
			credentials: 'omit', redirect: 'error', cache: 'no-store', signal: Controller.signal,
			...(Range ? { headers: { Range: `bytes=${Range.start}-${Range.end}` } } : {}),
		});
		const Reader = HttpResponse.body?.getReader();
		if (!Reader)
		{
			return null;
		}
		const Pieces = [];
		let Size = 0;
		try
		{
			const ExpectedStatus = Range ? 206 : 200;
			if (HttpResponse.status !== ExpectedStatus)
			{
				return null;
			}
			if (Range && !new RegExp(`^bytes ${Range.start}-${Range.end}/(?:\\d+|\\*)$`, 'i')
			.test(HttpResponse.headers.get('content-range') ?? ''))
			{
				return null;
			}
			for (; ; )
			{
				const { done: bDone, value: Chunk } = await Reader.read();
				if (bDone)
				{
					break;
				}
				Size += Chunk.byteLength;
				if (Size > Limit)
				{
					return null;
				}
				Pieces.push(Chunk);
			}
			if (!Size || (Page && location.href !== Page) || (Range && Size !== Range.end - Range.start + 1))
			{
				return null;
			}
		}
		finally
		{
			await Reader.cancel().catch(() =>
			{
			});
			Reader.releaseLock();
		}
		return await new Promise(Resolve =>
		{
			const Encoder = new FileReader();
			Encoder.onload = () => Resolve(Encoder.result.split(',', 2)[1]);
			Encoder.onerror = () => Resolve(null);
			Encoder.readAsDataURL(new Blob(Pieces));
		});
	}
	finally
	{
		clearTimeout(Timer);
		if (Requests.get(RequestId) === Controller)
		{
			Requests.delete(RequestId);
		}
	}
}

/** 요청 시작보다 취소 주입이 먼저 실행되어도 짧은 취소 표식을 남겨 새 fetch를 막습니다. */
function CancelInDocument(RegistryKey, RequestId, TimeoutMs)
{
	const Requests = globalThis[RegistryKey] ??= new Map();
	const Active = Requests.get(RequestId);
	if (Active)
	{
		Active.abort();
		return;
	}
	Requests.set(RequestId, null);
	setTimeout(() =>
	{
		if (Requests.get(RequestId) === null)
		{
			Requests.delete(RequestId);
		}
	}, TimeoutMs);
}
