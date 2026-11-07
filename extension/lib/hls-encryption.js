/**
 * identity 키로 암호화한 HLS 전체 조각을 Web Crypto로 복호화합니다.
 * 키는 작업 안의 메모리에만 두고 선언별로 구분하여 같은 URI의 키 교체도 반영합니다.
 */
import {LocalizedError} from './i18n.js';
import {CopyResponse, FetchMedia} from './hls-http.js';
const Methods = new Map([
	['AES-128', {name: 'AES-CBC', bytes: 16}],
	['AES-256', {name: 'AES-CBC', bytes: 32}],
	['AES-256-CTR', {name: 'AES-CTR', bytes: 32}],
	['AES-256-GCM', {name: 'AES-GCM', bytes: 32}],
]);
export function ReadHlsKey(Fields, Address)
{
	const Method = Fields.get('METHOD');
	const Format = Fields.get('KEYFORMAT') ?? 'identity';
	if (!Method || !Format || Method === 'NONE' && Fields.size !== 1 || !Fields.get('URI') && Method !== 'NONE')
	{
		throw new LocalizedError('stream_hls_invalid_key');
	}
	if (Method === 'NONE')
	{
		return {method: Method, format: Format};
	}
	if (Format !== 'identity' || !Methods.has(Method))
	{
		return {method: Method, format: Format, unsupported: true};
	}
	let Url;
	try
	{
		Url = new URL(Fields.get('URI'), Address);
	}
	catch
	{
		throw new LocalizedError('stream_hls_invalid_key');
	}
	const Iv = Fields.get('IV');
	const Versions = Fields.get('KEYFORMATVERSIONS') ?? '1';
	if (!['http:', 'https:'].includes(Url.protocol) || Url.username || Url.password ||
	!Versions.split('/').includes('1') || !/^[1-9]\d*(?:\/[1-9]\d*)*$/.test(Versions) ||
	Iv !== undefined && (!/^0x[\da-f]{1,32}$/i.test(Iv) || Method === 'AES-256-GCM'))
	{
		throw new LocalizedError('stream_hls_invalid_key');
	}
	return {method: Method, format: Format, url: Url.href, ...(Iv === undefined ? {} : {iv: Iv.slice(2).padStart(32, '0').toLowerCase()}), id: crypto.randomUUID()};
}

export function HlsResourceUrls(Resource)
{
	return (Resource.parts ?? [Resource]).flatMap(Part => [Part.url, ...(Part.encryption ? [Part.encryption.url] : [])]);
}

export async function ReadHlsBytes(Resource, Limit, Signal, bObservedContext = false)
{
	const Pieces = [];
	const Size = await CopyResponse(await FetchMedia(Resource.url, Signal, bObservedContext, Resource.range, true), Limit, Signal, Chunk => Pieces.push(Chunk));
	if (!Size || Resource.range && Size !== Resource.range.end - Resource.range.start + 1)
	{
		throw new LocalizedError('stream_segment_incomplete');
	}
	const Bytes = new Uint8Array(Size);
	let Offset = 0;
	for (const Piece of Pieces)
	{
		Bytes.set(Piece, Offset);
		Offset += Piece.byteLength;
	}
	return Bytes;
}

function SequenceIv(Sequence)
{
	if (!Number.isSafeInteger(Sequence) || Sequence < 0)
	{
		throw new LocalizedError('stream_hls_invalid_key');
	}
	return Sequence.toString(16).padStart(32, '0');
}

export class HlsDecryptor
{
	#Keys = new WeakMap();
	#ReadKey;
	constructor(ReadKey)
	{
		this.#ReadKey = ReadKey;
	}

	async Decrypt(Resource, Bytes, Signal)
	{
		Signal.throwIfAborted();
		const Key = Resource.encryption;
		if (!Key)
		{
			return Bytes;
		}
		const Policy = Methods.get(Key.method);
		if (!Policy)
		{
			throw new LocalizedError('stream_hls_encrypted');
		}
		let Pending = this.#Keys.get(Key);
		if (!Pending)
		{
			Pending = (async () =>
			{
				const Raw = await this.#ReadKey({url: Key.url}, Policy.bytes);
				try
				{
					Signal.throwIfAborted();
					if (Raw.byteLength !== Policy.bytes)
					{
						throw new LocalizedError('stream_hls_invalid_key');
					}
					return await crypto.subtle.importKey('raw', Raw, Policy.name, false, ['decrypt']);
				}
				finally
				{
					Raw.fill(0);
				}
			})();
			this.#Keys.set(Key, Pending);
			// 실패한 키 요청은 조각의 기존 재시도 정책에 따라 다시 받을 수 있습니다.
			Pending.catch(() => this.#Keys.delete(Key));
		}
		const Imported = await Pending;
		Signal.throwIfAborted();
		const Iv = Key.method === 'AES-256-GCM' ? Bytes.slice(0, 16) :
		Uint8Array.from((Key.iv ?? SequenceIv(Resource.sequence)).match(/../g), Value => parseInt(Value, 16));
		const Params = Policy.name === 'AES-CTR' ? {name: Policy.name, counter: Iv, length: 64} : {name: Policy.name, iv: Iv};
		let Plain;
		try
		{
			Plain = new Uint8Array(await crypto.subtle.decrypt(Params, Imported, Key.method === 'AES-256-GCM' ? Bytes.subarray(16) : Bytes));
		}
		catch
		{
			Signal.throwIfAborted();
			throw new LocalizedError('stream_hls_decryption_failed');
		}
		Signal.throwIfAborted();
		return Plain;
	}
}

export async function CopyHlsResource(Resource, Limit, Signal, Consume, Decryptor, bObservedContext = false)
{
	if (Resource.encryption)
	{
		const Bytes = await ReadHlsBytes(Resource, Limit, Signal, bObservedContext);
		const Plain = await Decryptor.Decrypt(Resource, Bytes, Signal);
		if (!Plain.byteLength)
		{
			throw new LocalizedError('stream_segment_incomplete');
		}
		await Consume(Plain);
		return Plain.byteLength;
	}
	const Size = await CopyResponse(await FetchMedia(Resource.url, Signal, bObservedContext, Resource.range), Limit, Signal, Consume);
	if (!Size || Resource.range && Size !== Resource.range.end - Resource.range.start + 1)
	{
		throw new LocalizedError('stream_segment_incomplete');
	}
	return Size;
}
