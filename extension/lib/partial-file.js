import {RuntimePolicy} from './runtime-policy.js';
import {LocalizedError} from './i18n.js';
import {IsHtmlMediaType} from './media.js';
import {HlsHttpError} from './hls-http.js';
function ResponseValidator(Response)
{
	const Etag = Response.headers.get('etag');
	return Etag && !Etag.startsWith('W/') ? Etag : Response.headers.get('last-modified');
}

/** Chrome의 미완성 파일에는 접근할 수 없으므로 클릭 시점의 고정 범위를 다시 읽습니다.
 * Range를 지원하지 않는 서버도 필요한 prefix까지만 읽고 스트림을 닫습니다.
 */
export async function ReadFilePrefix(Source, Workspace, Signal, Progress)
{
	const Limit = Math.floor(Source.bytes);
	if (!Number.isSafeInteger(Limit) || !(Limit > 0))
	{
		throw new LocalizedError('job_snapshot_unavailable');
	}
	const Request = new AbortController();
	const RequestSignal = AbortSignal.any([Signal, Request.signal]);
	let Deadline = setTimeout(() => Request.abort(new LocalizedError('stream_http_timeout')), RuntimePolicy.Transfer.RequestTimeoutMs);
	let Response;
	try
	{
		Response = await fetch(Source.url, {credentials: 'include', signal: RequestSignal, headers: {Range: 'bytes=0-' + (Limit - 1)}});
	}
	finally
	{
		clearTimeout(Deadline);
	}
	if (![200, 206].includes(Response.status) || !Response.body)
	{
		await Response.body?.cancel();
		throw new HlsHttpError('job_browser_error', Response.status, false, Response.status);
	}
	if (IsHtmlMediaType(Response.headers.get('content-type')))
	{
		await Response.body.cancel();
		throw new LocalizedError('job_not_video');
	}
	const Range = /^bytes 0-([0-9]+)\/([0-9]+)$/.exec(Response.headers.get('content-range') ?? '');
	if (Response.status === 206 && (!Range || Number(Range[1]) + 1 !== Limit))
	{
		await Response.body.cancel();
		throw new LocalizedError('job_snapshot_source_changed');
	}
	const HeaderLength = Number(Response.headers.get('content-length'));
	const TotalKnown = !!Range || HeaderLength > 0 || Source.totalBytes > 0;
	const Total = Range ? Number(Range[2]) : HeaderLength || (Source.totalBytes > 0 ? Source.totalBytes : Limit);
	if (!Number.isSafeInteger(Total) || Total < Limit || (Source.totalBytes > 0 && Source.totalBytes !== Total))
	{
		await Response.body.cancel();
		throw new LocalizedError('job_snapshot_source_changed');
	}
	const Reader = Response.body.getReader();
	let Handle, Writer;
	let Received = 0;
	let NextReportAt = 0;
	try
	{
		Handle = await Workspace.getFileHandle('prefix.bin', {create: true});
		Writer = await Handle.createWritable();
		while (Received < Limit)
		{
			Signal.throwIfAborted();
			Deadline = setTimeout(() => Request.abort(new LocalizedError('stream_http_timeout')), RuntimePolicy.Transfer.RequestTimeoutMs);
			let PieceValue;
			try
			{
				PieceValue = await Reader.read();
			}
			finally
			{
				clearTimeout(Deadline);
			}
			const {done: Done, value: Value} = PieceValue;
			if (Done)
			{
				throw new LocalizedError('stream_segment_incomplete');
			}
			const Piece = Value.subarray(0, Limit - Received);
			await Writer.write(Piece);
			Received += Piece.byteLength;
			if (performance.now() >= NextReportAt || Received === Limit)
			{
				NextReportAt = performance.now() + RuntimePolicy.Transfer.ProgressReportIntervalMs;
				await Progress?.({received: Received, finished: Received, count: Limit});
			}
		}
		await Writer.close();
	}
	catch (ErrorValue)
	{
		await Writer?.abort().catch(() =>
		{
		});
		throw ErrorValue;
	}
	finally
	{
		await Reader.cancel().catch(() =>
		{
		});
		Reader.releaseLock();
	}
	return {file: await Handle.getFile(), total: Total, partial: !TotalKnown || Limit < Total, url: Response.url || Source.url,
		validator: ResponseValidator(Response)};
}

/** MP4/MOV에서 mdat 전체를 다시 받지 않고 top-level box 크기로 moov를 찾습니다.
 * 메타데이터 요청의 응답 크기·자원 크기·검증자를 함께 확인해 다른 파일을 섞지 않습니다.
 */
export async function ReadMp4Metadata(Prefix, Signal)
{
	const BaseHeaderBytes = 8, ExtendedHeaderBytes = 16;
	let Requested = 0;
	async function Read(Start, End)
	{
		if (End <= Prefix.file.size)
		{
			return new Uint8Array(await Prefix.file.slice(Start, End).arrayBuffer());
		}
		Requested += End - Start;
		if (Requested > RuntimePolicy.Transfer.MaxSnapshotMetadataBytes)
		{
			throw new LocalizedError('job_snapshot_metadata');
		}
		const Response = await fetch(Prefix.url, {credentials: 'include', signal: AbortSignal.any([Signal, AbortSignal.timeout(RuntimePolicy.Transfer.RequestTimeoutMs)]),
			headers: {Range: 'bytes=' + Start + '-' + (End - 1), ...(Prefix.validator ? {'If-Range': Prefix.validator} : {})}});
		const Expected = `bytes ${Start}-${End - 1}/${Prefix.total}`;
		if (Response.status !== 206 || Response.headers.get('content-range') !== Expected)
		{
			await Response.body?.cancel();
			throw new HlsHttpError('job_snapshot_metadata', Response.status);
		}
		const Validator = ResponseValidator(Response);
		if (Prefix.validator && Validator && Validator !== Prefix.validator)
		{
			await Response.body?.cancel();
			throw new LocalizedError('job_snapshot_source_changed');
		}
		const Reader = Response.body.getReader();
		const Parts = [];
		let Size = 0;
		try
		{
			for (; ; )
			{
				const {done: Done, value: Value} = await Reader.read();
				if (Done)
				{
					break;
				}
				Size += Value.byteLength;
				if (Size > End - Start)
				{
					throw new LocalizedError('job_snapshot_metadata');
				}
				Parts.push(Value);
			}
		}
		finally
		{
			await Reader.cancel().catch(() =>
			{
			});
			Reader.releaseLock();
		}
		if (Size !== End - Start)
		{
			throw new LocalizedError('job_snapshot_metadata');
		}
		const Result = new Uint8Array(Size);
		let Offset = 0;
		for (const Part of Parts)
		{
			Result.set(Part, Offset);
			Offset += Part.byteLength;
		}
		return Result;
	}
	for (let Position = 0; Position + BaseHeaderBytes <= Prefix.total; )
	{
		Signal.throwIfAborted();
		const Header = await Read(Position, Position + BaseHeaderBytes);
		const View = new DataView(Header.buffer, Header.byteOffset, Header.byteLength);
		const Type = String.fromCharCode(...Header.subarray(4, BaseHeaderBytes));
		let Size = View.getUint32(0);
		if (Size === 1)
		{
			const Extra = await Read(Position + BaseHeaderBytes, Position + ExtendedHeaderBytes);
			Size = Number(new DataView(Extra.buffer, Extra.byteOffset, Extra.byteLength).getBigUint64(0));
		}
		if (!Size)
		{
			Size = Prefix.total - Position;
		}
		if (!Number.isSafeInteger(Size) || Size < BaseHeaderBytes || Position + Size > Prefix.total)
		{
			throw new LocalizedError('job_snapshot_metadata');
		}
		if (Type === 'moov')
		{
			return [{start: Position, data: await Read(Position, Position + Size)}];
		}
		Position += Size;
	}
	throw new LocalizedError('job_snapshot_metadata');
}
