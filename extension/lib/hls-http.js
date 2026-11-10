/**
 * 스트림 요청의 시간 제한, 응답 상태, 바이트 범위 검증을 한곳에서 수행합니다. 응답은 조각 단위로 소비하며 상한을 넘거나 취소되면 읽기를 중단합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { RetryableTransferError } from './segment-transfer.js';
import { LocalizedError } from './i18n.js';
import { NormalizeHlsProtocol } from './hls-protocol.js';
import {AssertMediaAllowed} from './youtube-source-policy.js';
import {HlsResourceRequestContext} from './hls-request-context.js';
export class HlsHttpError extends LocalizedError
{
	constructor(Key, Status, bChallenge = false, ...Args)
	{
		super(Key, ...Args);
		this.status = Status;
		this.challenge = bChallenge;
	}
}

export async function FetchMedia(Address, Signal, ObservedContext = false, LocalRange, bFresh = false)
{
	AssertMediaAllowed({url: Address});
	// A captured cookie mode belongs only to the observed CDN. Do not spread it
	// to a different asset/key host declared by that server's playlist.
	const IncludeCredentials = !ObservedContext || HlsResourceRequestContext(ObservedContext, Address)?.includeCredentials === true;
	let HttpResponse;
	const Deadline = new AbortController();
	const Timer = setTimeout(() => Deadline.abort(new DOMException('Media response timed out', 'TimeoutError')), RuntimePolicy.Transfer.RequestTimeoutMs);
	try
	{
		HttpResponse = await fetch(Address, {
			signal: AbortSignal.any([Signal, Deadline.signal]),
			redirect: 'error',
			credentials: IncludeCredentials ? 'include' : 'omit',
			...(ObservedContext || bFresh ? { cache: 'no-store' } : {}),
			...(LocalRange ? { headers: { Range: `bytes=${LocalRange.start}-${LocalRange.end}` } } : {}),
		});
	}
	catch (ErrorValue)
	{
		if (!Signal.aborted && ErrorValue.name === 'TimeoutError')
		{
			throw new RetryableTransferError('stream_http_timeout');
		}
		throw ErrorValue;
	}
	finally { clearTimeout(Timer); }
	if (HttpResponse.status === 429 || HttpResponse.status >= 500)
	{
		await HttpResponse.body?.cancel();
		throw new RetryableTransferError('stream_http_server_error', HttpResponse.status, HttpResponse.status);
	}
	if (HttpResponse.status === 403)
	{
		const bChallenge = HttpResponse.headers.get('cf-mitigated') === 'challenge';
		await HttpResponse.body?.cancel();
		throw new HlsHttpError(bChallenge ? 'stream_http_challenge' : 'stream_http_forbidden', HttpResponse.status, bChallenge);
	}
	// 범위를 요청했는데 전체 파일이 오면 의도한 바이트가 아니므로 MP4로 합치기 전에 거릅니다.
	const Expected = LocalRange ? 206 : 200;
	if (HttpResponse.status !== Expected || !HttpResponse.body)
	{
		await HttpResponse.body?.cancel();
		throw new HlsHttpError('stream_http_missing_resource', HttpResponse.status, false, HttpResponse.status);
	}
	if (LocalRange && !new RegExp(`^bytes ${LocalRange.start}-${LocalRange.end}/(?:\\d+|\\*)$`, 'i')
	.test(HttpResponse.headers.get('content-range') ?? ''))
	{
		await HttpResponse.body.cancel();
		throw new HlsHttpError('stream_http_range_mismatch', HttpResponse.status);
	}
	return HttpResponse;
}

async function ReadResponseChunk(Reader, Signal)
{
	let Timer, OnAbort;
	try
	{
		Signal.throwIfAborted();
		return await Promise.race([Reader.read(), new Promise((_Resolve, Reject) =>
		{
			OnAbort = () => Reject(Signal.reason);
			Signal.addEventListener('abort', OnAbort, {once: true});
			Timer = setTimeout(() => Reject(new DOMException('Media response stalled', 'TimeoutError')), RuntimePolicy.Transfer.RequestTimeoutMs);
		})]);
	}
	finally
	{
		clearTimeout(Timer);
		if (OnAbort) Signal.removeEventListener('abort', OnAbort);
	}
}

export async function CopyResponse(HttpResponse, Limit, Signal, Consume)
{
	const Reader = HttpResponse.body.getReader();
	let Count = 0;
	try
	{
		for (; ; )
		{
			Signal.throwIfAborted();
			// Each delivered chunk renews the idle deadline. A slow but progressing
			// segment must not be aborted by the earlier response-header deadline.
			const { value: Value, done: Done } = await ReadResponseChunk(Reader, Signal);
			Signal.throwIfAborted();
			if (Done)
			{
				break;
			}
			Count += Value.byteLength;
			if (Count > Limit)
			{
				throw new LocalizedError('stream_http_resource_limit');
			}
			await Consume(Value);
		}
	}
	catch (ErrorValue)
	{
		await Reader.cancel().catch(() =>
		{
		});
		if (!Signal.aborted && ErrorValue.name === 'TimeoutError')
		{
			throw new RetryableTransferError('stream_http_timeout');
		}
		throw ErrorValue;
	}
	finally
	{
		Reader.releaseLock();
	}
	return Count;
}

export async function ReadPlaylist(Url, Signal = new AbortController().signal, bObservedContext = false)
{
	const Decoder = new TextDecoder();
	let Playlist = '';
	await CopyResponse(await FetchMedia(Url, Signal, bObservedContext, undefined, true), RuntimePolicy.Transfer.MaxPlaylistBytes, Signal, Chunk =>
	{
		Playlist += Decoder.decode(Chunk, { stream: true });
	});
	return NormalizeHlsProtocol(Playlist + Decoder.decode(), Url);
}

export async function ReadIndexRange(Url, LocalRange, Signal, bFresh = false)
{
	const Length = LocalRange.end - LocalRange.start + 1;
	if (!Number.isSafeInteger(Length) || Length < 1 || Length > RuntimePolicy.Transfer.MaxDashIndexBytes)
	{
		throw new LocalizedError('stream_dash_index_limit');
	}
	const Bytes = new Uint8Array(Length);
	let Offset = 0;
	const Count = await CopyResponse(await FetchMedia(Url, Signal, false, LocalRange, bFresh), Length, Signal, Chunk =>
	{
		Bytes.set(Chunk, Offset);
		Offset += Chunk.length;
	});
	if (Count !== Length)
	{
		throw new LocalizedError('stream_dash_index_truncated');
	}
	return Bytes;
}
