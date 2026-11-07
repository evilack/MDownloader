/**
 * HLS 마스터와 미디어 재생목록을 해석합니다.
 * 지원하지 않는 암호화나 재생목록 구조를 조각 요청 전에 거릅니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { LocalizedError } from './i18n.js';
import {ReadHlsKey} from './hls-encryption.js';
const StreamTag = '#EXT-X-STREAM-INF:';
const VideoCodec = /^(?:avc[13](?:\.[\da-f]{6})?|av01(?:\.[a-z\d]+)+)$/i;
function PlaylistLines(TextValue)
{
	const Lines = TextValue.split(/\r?\n/).map(Line => Line.trim()).filter(Boolean);
	if (Lines[0] !== '#EXTM3U')
	{
		throw new LocalizedError('stream_hls_invalid_playlist_response');
	}
	return Lines;
}
function ReadAttributes(TextValue, Key = 'stream_hls_invalid_master_attributes')
{
	const Fields = new Map();
	while (TextValue)
	{
		const Field = /^([A-Z\d-]+)=("[^"]*"|[^",]+)(,|$)/.exec(TextValue);
		if (!Field || Fields.has(Field[1]) || Field[3] && Field[0].length === TextValue.length)
		{
			throw new LocalizedError(Key);
		}
		Fields.set(Field[1], Field[2].replace(/^"|"$/g, ''));
		TextValue = TextValue.slice(Field[0].length);
	}
	return Fields;
}

function MediaUrl(LocalLocation, Address)
{
	if (!LocalLocation || /\{\$/.test(LocalLocation))
	{
		return;
	}
	try
	{
		const Url = new URL(LocalLocation, Address);
		if (['http:', 'https:'].includes(Url.protocol) && !Url.username && !Url.password)
		{
			return Url.href;
		}
	}
	catch
	{
		// 올바른 URL이 아닌 항목은 화질이나 미디어 자원으로 사용할 수 없습니다.

	}
}

/** 재생 중 추가된 인증 쿼리는 원래 화질의 경로·출처·기존 쿼리를 모두 만족해야 연결할 수 있습니다. */
export function MatchesHlsVariant(Declared, Observed)
{
	const Expected = new URL(Declared);
	const Actual = new URL(Observed);
	return Expected.origin === Actual.origin && Expected.pathname === Actual.pathname &&
	[...Expected.searchParams.keys()].every(Name =>
	JSON.stringify(Expected.searchParams.getAll(Name)) === JSON.stringify(Actual.searchParams.getAll(Name)));
}

/**
 * 다운로드 지원 여부와 별개로 미디어 재생목록의 라이브 상태만 읽습니다.
 * 마스터에는 종료 여부가 없으므로 추측하지 않습니다. 호출부는 실제로 관측한 화질의
 * 상태를 마스터 행에 연결합니다. 명시적 VOD나 ENDLIST는 라이브로 표시하지 않습니다.
 */
export function ReadHlsLiveState(TextValue)
{
	const Lines = PlaylistLines(TextValue);
	if (Lines.some(Line => /^#EXT-X-(STREAM-INF|I-FRAME-STREAM-INF|MEDIA):/.test(Line)) ||
	!Lines.some(Line => /^#EXT(INF|-X-(PART|TARGETDURATION|MEDIA-SEQUENCE)):/.test(Line)))
	{
		return undefined;
	}
	return !Lines.includes('#EXT-X-ENDLIST') && !Lines.includes('#EXT-X-PLAYLIST-TYPE:VOD');
}

/**
 * 다운로드 지원 여부와 별개로 재생목록에 명시된 조각의 소유 관계를 읽습니다.
 * 초기화·완전 조각·저지연 부분 조각을 독립 파일 후보에서 제외하는 데 사용하며 키 주소는 읽지 않습니다.
 */
export function ReadHlsMediaResources(TextValue, Address)
{
	const Resources = new Set();
	let bSegment = false;
	for (const Line of PlaylistLines(TextValue))
	{
		let Location;
		if (Line.startsWith('#EXTINF:'))
		{
			bSegment = true;
		}
		else if (!Line.startsWith('#') && bSegment)
		{
			Location = Line;
			bSegment = false;
		}
		else if (/^#EXT-X-(MAP|PART|PRELOAD-HINT):/.test(Line))
		{
			const Fields = ReadAttributes(Line.slice(Line.indexOf(':') + 1));
			if (!Line.startsWith('#EXT-X-PRELOAD-HINT:') || ['PART', 'MAP'].includes(Fields.get('TYPE')))
			{
				Location = Fields.get('URI');
			}
		}
		const Url = MediaUrl(Location, Address);
		if (Url)
		{
			Resources.add(Url);
		}
		if (Resources.size > RuntimePolicy.Transfer.MaxSegments)
		{
			throw new LocalizedError('stream_hls_too_many_segments');
		}
	}
	return [...Resources];
}

function SelectAudio(Renditions, Group, Address, AllowSeparateAudio)
{
	let Fallback;
	for (const Rendition of Renditions)
	{
		if (Rendition.get('TYPE') !== 'AUDIO' || Rendition.get('GROUP-ID') !== Group)
		{
			continue;
		}
		// URI가 없는 AUDIO 항목은 해당 화질에 오디오가 포함되어 있다는 뜻입니다.
		const Url = Rendition.has('URI') ? MediaUrl(Rendition.get('URI'), Address) : null;
		if (Url === undefined || (Url && !AllowSeparateAudio))
		{
			continue;
		}
		if (Rendition.get('DEFAULT') === 'YES')
		{
			return Url;
		}
		if (Fallback === undefined)
		{
			Fallback = Url;
		}
	}
	return Fallback;
}

// null은 마스터가 아니라 미디어 재생목록을 뜻합니다. 호출부에서 그 형식으로 다시 검사합니다.
export function ParseMaster(TextValue, Address, { allowSeparateAudio: bAllowSeparateAudio = true } = {})
{
	const Lines = PlaylistLines(TextValue);
	if (!Lines.some(Line => /^#EXT-X-(STREAM-INF|I-FRAME-STREAM-INF|MEDIA)(?=:|$)/.test(Line)))
	{
		return null;
	}
	if (Lines.some(Line => /^#EXT(INF|\-X-(TARGETDURATION|MEDIA-SEQUENCE|ENDLIST|DEFINE|MAP|BYTERANGE|DISCONTINUITY|PART|SKIP))(?=:|$)/.test(Line)))
	{
		throw new LocalizedError('stream_hls_invalid_master');
	}
	if (Lines.some(Line => /^#EXT-X-KEY(?=:|$)/.test(Line)))
	{
		throw new LocalizedError('stream_hls_encrypted');
	}
	// SESSION-KEY는 선행 로딩 힌트입니다. 실제 조각에는 미디어 목록의 KEY 선언을 적용합니다.
	for (const Line of Lines.filter(Line => Line.startsWith('#EXT-X-SESSION-KEY:')))
	{
		if (ReadHlsKey(ReadAttributes(Line.slice(19), 'stream_hls_invalid_key'), Address).method === 'NONE')
		{
			throw new LocalizedError('stream_hls_invalid_key');
		}
	}
	const Renditions = Lines.filter(Line => Line.startsWith('#EXT-X-MEDIA:'))
	.map(Line => ReadAttributes(Line.slice('#EXT-X-MEDIA:'.length)));
	const Variants = new Map();
	for (let I = 1; I < Lines.length; I++)
	{
		const Line = Lines[I];
		if (!Line.startsWith(StreamTag))
		{
			if (Line.startsWith('#'))
			{
				continue;
			}
			throw new LocalizedError('stream_hls_variant_info_missing');
		}
		const Fields = ReadAttributes(Line.slice(StreamTag.length));
		const LocalLocation = Lines[++I];
		if (!LocalLocation || LocalLocation.startsWith('#'))
		{
			throw new LocalizedError('stream_hls_variant_url_missing');
		}
		const Bandwidth = Number(Fields.get('BANDWIDTH'));
		if (!/^\d+$/.test(Fields.get('BANDWIDTH')) || !Number.isSafeInteger(Bandwidth) || Bandwidth <= 0)
		{
			throw new LocalizedError('stream_hls_variant_bitrate');
		}
		if (Fields.has('VIDEO'))
		{
			// URI 없는 VIDEO 그룹은 현재 화질 안에 영상이 있다는 이름표입니다.
			// 별도 주소를 요구하는 대체 영상 그룹만 이 전송 경로에서 제외합니다.
			const VideoGroup = Renditions.filter(Rendition => Rendition.get('TYPE') === 'VIDEO' && Rendition.get('GROUP-ID') === Fields.get('VIDEO'));
			if (!VideoGroup.length || VideoGroup.some(Rendition => Rendition.has('URI')))
			{
				continue;
			}
		}
		const Codecs = Fields.get('CODECS')?.split(',').map(Codec => Codec.trim());
		if (Codecs && (!Codecs.some(Codec => VideoCodec.test(Codec)) ||
		Codecs.some(Codec => !VideoCodec.test(Codec) && !/^mp4a\.40\.\d+$/i.test(Codec))))
		{
			continue;
		}
		const Url = MediaUrl(LocalLocation, Address);
		if (!Url)
		{
			continue;
		}
		const LocalAudio = Fields.get('AUDIO');
		const AudioUrl = LocalAudio ? SelectAudio(Renditions, LocalAudio, Address, bAllowSeparateAudio) : null;
		if (AudioUrl === undefined)
		{
			continue;
		}
		const Resolution = Fields.get('RESOLUTION') || '';
		if (!Variants.has(Url))
		{
			Variants.set(Url, {
				url: Url, bandwidth: Bandwidth, resolution: /^[1-9]\d*x[1-9]\d*$/.test(Resolution) ? Resolution : '',
				...(AudioUrl && { audioUrl: AudioUrl }),
			});
		}
		if (Variants.size > RuntimePolicy.Transfer.MaxVariants)
		{
			throw new LocalizedError('stream_hls_too_many_variants');
		}
	}
	if (!Variants.size)
	{
		throw new LocalizedError('stream_hls_no_variants');
	}
	return [...Variants.values()].sort((A, B) => A.bandwidth - B.bandwidth);
}

function DecimalInteger(Value)
{
	return /^\d+$/.test(Value) ? Number(Value) : NaN;
}

function ByteRange(Value, ImplicitStart)
{
	const Match = /^(\d+)(?:@(\d+))?$/.exec(Value);
	const Length = Number(Match?.[1]);
	const Start = Match?.[2] === undefined ? ImplicitStart : Number(Match[2]);
	const End = Start + (Length - 1);
	if (!Number.isSafeInteger(Length) || Length <= 0 || !Number.isSafeInteger(Start) || !Number.isSafeInteger(End))
	{
		throw new LocalizedError('stream_hls_invalid_byte_range');
	}
	return { start: Start, end: End };
}

export function ParseMediaPlaylist(TextValue, Address)
{
	const Lines = PlaylistLines(TextValue);
	// URL을 플레이어 내부에서 별도로 변환하는 구조는 표준 URI로 다운로드할 수 없습니다.
	// 메타데이터의 문자열을 실제 조각 주소로 오인해 404 요청을 반복하지 않습니다.
	if (Lines.some(Line => Line.startsWith('#EXT-X-MOUFLON:PSCH:')))
	{
		throw new LocalizedError('stream_hls_unsupported_media');
	}
	const Segments = [];
	let TargetDuration, FirstSequence, Duration, Init, RangeValue;
	let bDiscontinuity = false;
	let bEnded = false;
	let bPartial = false;
	let Parts = [];
	const Keys = new Map();
	function Encryption()
	{
		if (!Keys.size)
		{
			return undefined;
		}
		const Key = Keys.get('identity');
		if (!Key || Key.unsupported)
		{
			throw new LocalizedError('stream_hls_encrypted');
		}
		return Key;
	}
	for (let Index = 1; Index < Lines.length; Index++)
	{
		const Line = Lines[Index];
		if (!Line.startsWith('#'))
		{
			if (Duration === undefined)
			{
				throw new LocalizedError('stream_hls_segment_duration_missing');
			}
			if (Segments.length === RuntimePolicy.Transfer.MaxSegments)
			{
				throw new LocalizedError('stream_hls_too_many_segments');
			}
			const Sequence = (FirstSequence ?? 0) + Segments.length;
			if (!Number.isSafeInteger(Sequence))
			{
				throw new LocalizedError('stream_hls_invalid_sequence');
			}
			const Url = MediaUrl(Line, Address);
			if (!Url)
			{
				throw new LocalizedError('stream_hls_segment_scheme');
			}
			const Segment = { url: Url, duration: Duration, sequence: Sequence };
			const Key = Encryption();
			if (Key)
			{
				Segment.encryption = Key;
			}
			// 완성된 미디어 시퀀스에 속한 부분 조각만 합칩니다. 아직 완성되지 않은 마지막 그룹은 다음 갱신을 기다립니다.
			if (Parts.length && !Key)
			{
				Segment.url = Parts[0].url;
				Segment.parts = Parts;
				Parts = [];
			}
			// 전체 조각 암호화는 부모 조각의 경계에서 복호화합니다. 부분 조각을 독립 CBC로 오인하지 않습니다.
			Parts = [];
			if (Init)
			{
				Segment.init = Init;
			}
			if (RangeValue !== undefined)
			{
				const Previous = Segments.at(-1);
				const ImplicitStart = Previous?.url === Url && Previous.range ? Previous.range.end + 1 : undefined;
				Segment.range = ByteRange(RangeValue, ImplicitStart);
			}
			if (bDiscontinuity)
			{
				Segment.discontinuity = true;
			}
			Segments.push(Segment);
			Duration = undefined;
			RangeValue = undefined;
			bDiscontinuity = false;
			continue;
		}

		const Separator = Line.indexOf(':');
		const Tag = Separator === -1 ? Line : Line.slice(0, Separator);
		const Value = Separator === -1 ? '' : Line.slice(Separator + 1);
		switch (Tag)
		{
			case '#EXT-X-KEY':
			{
				const Key = ReadHlsKey(ReadAttributes(Value, 'stream_hls_invalid_key'), Address);
				if (Key.method === 'NONE')
				{
					Keys.clear();
				}
				else
				{
					Keys.set(Key.format, Key);
				}
				break;
			}
			case '#EXT-X-SESSION-KEY':
			throw new LocalizedError('stream_hls_encrypted');
			case '#EXT-X-STREAM-INF':
			case '#EXT-X-I-FRAME-STREAM-INF':
			case '#EXT-X-MEDIA':
			case '#EXT-X-I-FRAMES-ONLY':
			case '#EXT-X-GAP':
			case '#EXT-X-SKIP':
			case '#EXT-X-DEFINE':
			throw new LocalizedError('stream_hls_unsupported_media');
			case '#EXT-X-TARGETDURATION':
			{
				const Seconds = DecimalInteger(Value);
				if (TargetDuration !== undefined || !Number.isSafeInteger(Seconds) || Seconds <= 0)
				{
					throw new LocalizedError('stream_hls_invalid_target_duration');
				}
				TargetDuration = Seconds;
				break;
			}
			case '#EXT-X-MEDIA-SEQUENCE':
			{
				const Sequence = DecimalInteger(Value);
				if (FirstSequence !== undefined || Segments.length || !Number.isSafeInteger(Sequence))
				{
					throw new LocalizedError('stream_hls_invalid_sequence');
				}
				FirstSequence = Sequence;
				break;
			}
			case '#EXTINF':
			{
				if (Duration !== undefined)
				{
					throw new LocalizedError('stream_hls_segment_url_missing');
				}
				const Seconds = Value.split(',', 1)[0];
				Duration = Number(Seconds);
				if (!/^(?:\d+\.?\d*|\.\d+)$/.test(Seconds) || !Number.isFinite(Duration) || Duration <= 0)
				{
					throw new LocalizedError('stream_hls_invalid_segment_duration');
				}
				break;
			}
			case '#EXT-X-MAP':
			{
				const Fields = ReadAttributes(Value, 'stream_hls_invalid_init_attributes');
				const Url = MediaUrl(Fields.get('URI'), Address);
				if (!Url)
				{
					throw new LocalizedError('stream_hls_init_scheme');
				}
				Init = { url: Url };
				const Key = Encryption();
				if (Key)
				{
					if (!Key.iv && Key.method !== 'AES-256-GCM')
					{
						throw new LocalizedError('stream_hls_invalid_key');
					}
					Init.encryption = Key;
				}
				if (Fields.has('BYTERANGE'))
				{
					Init.range = ByteRange(Fields.get('BYTERANGE'));
				}
				break;
			}
			case '#EXT-X-BYTERANGE':
			if (RangeValue !== undefined)
			{
				throw new LocalizedError('stream_hls_duplicate_byte_range');
			}
			RangeValue = Value;
			break;
			case '#EXT-X-DISCONTINUITY':
			bDiscontinuity = true;
			break;
			case '#EXT-X-ENDLIST':
			bEnded = true;
			break;
			case '#EXT-X-PART':
			{
				bPartial = true;
				const Fields = ReadAttributes(Value);
				const Url = MediaUrl(Fields.get('URI'), Address);
				const Seconds = Number(Fields.get('DURATION'));
				if (!Url || !Number.isFinite(Seconds) || Seconds <= 0 || Fields.get('GAP') === 'YES')
				{
					throw new LocalizedError('stream_hls_unsupported_media');
				}
				const Part = { url: Url };
				if (Fields.has('BYTERANGE'))
				{
					const Previous = Parts.at(-1);
					Part.range = ByteRange(Fields.get('BYTERANGE'), Previous?.url === Url ? Previous.range?.end + 1 : undefined);
				}
				Parts.push(Part);
				if (Parts.length > RuntimePolicy.Transfer.MaxSegments)
				{
					throw new LocalizedError('stream_hls_too_many_segments');
				}
				break;
			}
			case '#EXT-X-PRELOAD-HINT':
			bPartial = true;
			break;
		}
	}

	if (!Segments.length && bPartial)
	{
		throw new LocalizedError('stream_hls_partial_only');
	}
	if (!Segments.length || Duration !== undefined || RangeValue !== undefined)
	{
		throw new LocalizedError('stream_hls_empty_segments');
	}
	if (TargetDuration === undefined)
	{
		if (!bEnded)
		{
			throw new LocalizedError('stream_hls_target_duration_missing');
		}
		TargetDuration = Math.ceil(Math.max(...Segments.map(Segment => Segment.duration)));
	}
	return { segments: Segments, ended: bEnded, targetDuration: TargetDuration };
}

export function ParseVod(TextValue, Address)
{
	const Lines = PlaylistLines(TextValue);
	if (!Lines.includes('#EXT-X-ENDLIST'))
	{
		throw new LocalizedError('stream_hls_vod_end_required');
	}
	const Segments = Lines.some(Line => Line.startsWith('#EXT-X-KEY:') && Line !== '#EXT-X-KEY:METHOD=NONE') ? ParseMediaPlaylist(TextValue, Address).segments : undefined;
	const Urls = [];
	let bExpectingSegment = false;
	const Local = Lines.map(Line =>
	{
		if (Line.startsWith('#EXT-X-KEY:'))
		{
			return '';
		}
		if (/^#EXT-X-SESSION-KEY(?=:|$)/.test(Line))
		{
			throw new LocalizedError('stream_hls_encrypted');
		}
		if (/^#EXT-X-(STREAM-INF|I-FRAME-STREAM-INF|MEDIA|MAP|BYTERANGE|DISCONTINUITY|DISCONTINUITY-SEQUENCE|GAP|PART|SKIP|DEFINE)(?=:|$)/.test(Line))
		{
			throw new LocalizedError('stream_hls_ts_only');
		}
		if (Line.startsWith('#EXTINF:'))
		{
			if (bExpectingSegment)
			{
				throw new LocalizedError('stream_hls_segment_url_missing');
			}
			const Duration = Number(Line.slice(8).split(',', 1)[0]);
			if (!Number.isFinite(Duration) || Duration <= 0)
			{
				throw new LocalizedError('stream_hls_invalid_segment_duration');
			}
			bExpectingSegment = true;
		}
		if (Line.startsWith('#'))
		{
			return Line;
		}
		if (!bExpectingSegment)
		{
			throw new LocalizedError('stream_hls_unsupported_playlist');
		}
		const Url = new URL(Line, Address);
		if (!['http:', 'https:'].includes(Url.protocol) || Url.username || Url.password)
		{
			throw new LocalizedError('stream_hls_segment_scheme');
		}
		bExpectingSegment = false;
		if (Urls.length === RuntimePolicy.Transfer.MaxSegments)
		{
			throw new LocalizedError('stream_hls_too_many_segments');
		}
		return 'segment-' + (Urls.push(Url.href) - 1) + '.ts';
	});
	if (!Urls.length || bExpectingSegment)
	{
		throw new LocalizedError('stream_hls_empty_segments');
	}
	return { urls: Urls, local: Local.join('\n') + '\n', ...(Segments ? {segments: Segments} : {}) };
}
