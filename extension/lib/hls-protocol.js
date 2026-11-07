/**
 * 표준 HLS 앞에 붙는 명시적 URL 메타데이터를 해석합니다.
 * 방송 ID나 CDN 주소를 만들지 않으며, 응답이 지정한 버전과 등록된 데이터만 사용합니다.
 * 미디어 본문의 암호화/DRM 처리는 이 모듈의 역할이 아닙니다.
 */
import { LocalizedError } from './i18n.js';
let CatalogPromise;
const Digests = new Map();
export function LoadHlsProtocols()
{
	if (!CatalogPromise)
	{
		CatalogPromise = (async () =>
		{
			const Response = await fetch(chrome.runtime.getURL('data/hls-protocols.json'));
			if (!Response.ok)
			{
				throw new LocalizedError('stream_hls_unsupported_media');
			}
			return Response.json();
		})().catch(ErrorValue =>
		{
			CatalogPromise = undefined;
			throw ErrorValue;
		});
	}
	return CatalogPromise;
}

function Unsupported()
{
	return new LocalizedError('stream_hls_unsupported_media');
}

/** 기존 쿼리의 인코딩을 보존합니다. 이미 다른 식별자가 지정된 주소는 바꾸지 않습니다. */
function AppendProtocolParameters(Address, Parameters)
{
	const Url = new URL(Address);
	const Additions = [];
	for (const [Name, Value] of Parameters)
	{
		if (Url.searchParams.has(Name))
		{
			if (Url.searchParams.get(Name) !== Value)
			{
				throw Unsupported();
			}
		}
		else
		{
			Additions.push(encodeURIComponent(Name) + '=' + encodeURIComponent(Value));
		}
	}
	if (!Additions.length)
	{
		return Address;
	}
	const [BeforeHash, Hash] = Address.split('#', 2);
	return BeforeHash + (BeforeHash.includes('?') ? '&' : '?') + Additions.join('&') + (Hash === undefined ? '' : '#' + Hash);
}

async function RestoreUri(Value, Address, Protocol, TokenKey)
{
	const Pattern = new RegExp(Protocol.tokenPattern);
	const Match = Pattern.exec(Value);
	if (Match)
	{
		// 공개 플레이어 v2의 규칙은 토큰의 Base64 문자 순서를 되돌린 뒤 SHA-256 마스크와 XOR하는 것입니다.
		// 원본 경로와 서명 쿼리는 그대로 두고 토큰 필드만 교체합니다.
		let Digest = Digests.get(TokenKey);
		if (!Digest)
		{
			Digest = crypto.subtle.digest('SHA-256', new TextEncoder().encode(TokenKey));
			Digests.set(TokenKey, Digest);
		}
		const Mask = new Uint8Array(await Digest);
		let Binary;
		try
		{
			Binary = atob([...Match[1]].reverse().join(''));
		}
		catch
		{
			throw Unsupported();
		}
		const Bytes = Uint8Array.from(Binary, (Character, Index) => Character.charCodeAt(0) ^ Mask[Index % Mask.length]);
		let Token;
		try
		{
			Token = new TextDecoder('utf-8', { fatal: true }).decode(Bytes);
		}
		catch
		{
			throw Unsupported();
		}
		// 복원된 필드는 경로 하나의 식별자여야 합니다. 슬래시·제어 문자·경로 이동을 넣을 수 없습니다.
		if (!/^[a-z\d_-]+$/i.test(Token))
		{
			throw Unsupported();
		}
		const Start = Match.index + 1;
		Value = Value.slice(0, Start) + Token + Value.slice(Start + Match[1].length);
	}
	const Url = new URL(Value, Address);
	if (!['https:', 'http:'].includes(Url.protocol) || Url.username || Url.password)
	{
		throw Unsupported();
	}
	return Url.href;
}

export async function NormalizeHlsProtocol(TextValue, Address, Catalog)
{
	// 일반 HLS에서는 설정 파일 읽기나 재직렬화를 수행하지 않습니다.
	if (!TextValue.includes('#EXT-X-MOUFLON:'))
	{
		return TextValue;
	}
	const Protocol = (Catalog ?? await LoadHlsProtocols()).mouflon;
	if (!Protocol)
	{
		throw Unsupported();
	}
	const Lines = TextValue.split(/\r?\n/);
	const Schemes = Lines.filter(Line => Line.startsWith(Protocol.schemeTag))
	.map(Line => Line.slice(Protocol.schemeTag.length).trim().split(':'));
	if (!Schemes.length && !Lines.some(Line => Line.startsWith(Protocol.uriTag)))
	{
		return TextValue;
	}
	const Scheme = Schemes.find(([Version, Key]) => Version === Protocol.version && Object.hasOwn(Protocol.tokenKeys, Key));
	if (!Scheme)
	{
		throw Unsupported();
	}
	const [Version, KeyId] = Scheme;
	const Result = [];
	let PendingUri;
	let bVariant = false;
	for (let Line of Lines)
	{
		if (Line.startsWith(Protocol.schemeTag))
		{
			continue;
		}
		if (Line.startsWith(Protocol.uriTag))
		{
			if (PendingUri)
			{
				throw Unsupported();
			}
			PendingUri = await RestoreUri(Line.slice(Protocol.uriTag.length).trim(), Address, Protocol, Protocol.tokenKeys[KeyId]);
			continue;
		}
		if (PendingUri && /^#EXT-X-(PART|MAP|PRELOAD-HINT):/.test(Line))
		{
			if (!/URI="[^"]*"/.test(Line))
			{
				throw Unsupported();
			}
			Line = Line.replace(/URI="[^"]*"/, 'URI="' + PendingUri + '"');
			PendingUri = undefined;
		}
		else if (Line && !Line.startsWith('#'))
		{
			Line = PendingUri ?? Line;
			PendingUri = undefined;
			if (bVariant)
			{
				Line = AppendProtocolParameters(new URL(Line, Address).href, [
					[Protocol.requestParameters.scheme, Version], [Protocol.requestParameters.key, KeyId],
				]);
			}
			bVariant = false;
		}
		if (Line.startsWith('#EXT-X-STREAM-INF:'))
		{
			bVariant = true;
		}
		Result.push(Line);
	}
	if (PendingUri)
	{
		throw Unsupported();
	}
	return Result.join('\n');
}
