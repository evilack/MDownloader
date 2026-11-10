/**
 * 정적 DASH 재생목록을 영상·오디오 조각 주소와 시각 정보로 변환합니다. 파서의 표현 수, 주소 길이, 조각 수에는 상한을 적용합니다.
 * SegmentBase가 별도의 인덱스를 지정하면 SIDX의 바이트 범위를 실제 파일의 절대 범위로 변환합니다.
 */
import { RuntimePolicy, Units } from './runtime-policy.js';
import { LocalizedError } from './i18n.js';
const MpdNamespace = 'urn:mpeg:dash:schema:mpd:2011';
const XlinkNamespace = 'http://www.w3.org/1999/xlink';
const SidxBoxType = 0x73696478;
// MP4 상자 종류를 나타내는 FourCC "sidx" 값입니다.
const Mp4BoxHeaderBytes = 8;
const Mp4ExtendedBoxHeaderBytes = 16;
const SidxV0FieldsBytes = 24;
const SidxV1FieldsBytes = 32;
const SidxReferenceBytes = 12;
const Avc = /^avc[13](?:\.[\da-f]{6})?$/i;
const Aac = /^mp4a\.40\.(?:2|5|29)$/i;
function Children(DomElement, Name)
{
	return [...DomElement.children].filter(Child => Child.localName === Name && Child.namespaceURI === DomElement.namespaceURI);
}

function Child(DomElement, Name)
{
	for (const LocalNode of DomElement.children)
	{
		if (LocalNode.localName === Name && LocalNode.namespaceURI === DomElement.namespaceURI)
		{
			return LocalNode;
		}
	}
}

function Integer(Value, Field, Minimum = 0)
{
	const NumericValue = Number(Value);
	if (!/^-?\d+$/.test(Value ?? '') || !Number.isSafeInteger(NumericValue) || NumericValue < Minimum)
	{
		throw new LocalizedError('stream_dash_invalid_integer', Field);
	}
	return NumericValue;
}

function Seconds(Value)
{
	if (Value === null)
	{
		return null;
	}
	const Match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(Value);
	if (Match?.slice(1).some(Boolean))
	{
		const [, Day = 0, Hour = 0, Minute = 0, Second = 0] = Match;
		const SecondsPerHour = Units.MinutesPerHour * Units.SecondsPerMinute;
		const Total = Day * (Units.HoursPerDay * SecondsPerHour) + Hour * SecondsPerHour +
		Minute * Units.SecondsPerMinute + Number(Second);
		if (Number.isFinite(Total) && Total <= Number.MAX_SAFE_INTEGER)
		{
			return Total;
		}
	}
	throw new LocalizedError('stream_dash_invalid_duration');
}

function HttpUrl(LocalLocation, Base)
{
	let Url;
	try
	{
		Url = new URL(LocalLocation, Base);
	}
	catch
	{
		throw new LocalizedError('stream_dash_invalid_segment_url');
	}
	if (!['http:', 'https:'].includes(Url.protocol) || Url.username || Url.password || Url.href.length > RuntimePolicy.Dash.MaxSegmentUrlLength)
	{
		throw new LocalizedError('stream_dash_segment_scheme');
	}
	Url.hash = '';
	return Url.href;
}

function BaseUrl(Nodes, ManifestUrl)
{
	let Base = ManifestUrl;
	for (const LocalNode of Nodes)
	{
		const XmlBase = LocalNode.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'base');
		if (XmlBase)
		{
			Base = HttpUrl(XmlBase, Base);
		}
		const LocalLocation = Child(LocalNode, 'BaseURL')?.textContent.trim();
		if (LocalLocation)
		{
			Base = HttpUrl(LocalLocation, Base);
		}
	}
	return Base;
}

function RejectExternalLinks(Nodes)
{
	if (Nodes.some(LocalNode => LocalNode.hasAttributeNS(XlinkNamespace, 'href')))
	{
		throw new LocalizedError('stream_dash_xlink_unsupported');
	}
}

function SegmentAddressing(Nodes)
{
	let Type;
	let Levels = [];
	for (const LocalNode of Nodes)
	{
		const Matches = [...LocalNode.children].filter(DomElement => DomElement.namespaceURI === LocalNode.namespaceURI &&
		['SegmentTemplate', 'SegmentList', 'SegmentBase'].includes(DomElement.localName));
		if (Matches.length > 1)
		{
			throw new LocalizedError('stream_dash_invalid_addressing');
		}
		if (!Matches.length)
		{
			continue;
		}
		const [DomElement] = Matches;
		if (DomElement.localName !== Type)
		{
			Type = DomElement.localName;
			Levels = [];
		}
		Levels.unshift(DomElement);
	}
	RejectExternalLinks(Levels);
	if (!Type)
	{
		throw new LocalizedError('stream_dash_no_addressing');
	}
	return {
		type: Type,
		attribute: Name => Levels.find(Level => Level.hasAttribute(Name))?.getAttribute(Name) ?? null,
		element: Name => Levels.map(Level => Child(Level, Name)).find(Boolean),
		list: Name => Levels.map(Level => Children(Level, Name)).find(Items => Items.length) ?? [],
	};
}

function FillTemplate(Template, Values)
{
	return Template.replace(/\$\$|\$([^$]+)\$|\$/g, (Match, Token) =>
	{
		if (Match === '$$')
		{
			return '$';
		}
		const [, Name, Width] = /^(RepresentationID|Number|Bandwidth|Time)(?:%0(\d{1,2})d)?$/.exec(Token ?? '') ?? [];
		if (!Name || Values[Name] == null || (Name === 'RepresentationID' && Width) || Number(Width) > RuntimePolicy.Dash.MaxTemplatePadding)
		{
			throw new LocalizedError('stream_dash_invalid_template');
		}
		return String(Values[Name]).padStart(Number(Width) || 0, '0');
	});
}

function ByteRange(Value)
{
	if (Value === null)
	{
		return undefined;
	}
	const [, From, To] = /^(\d+)-(\d+)$/.exec(Value) ?? [];
	const Start = Integer(From, 'range');
	const End = Integer(To, 'range', Start);
	return { start: Start, end: End };
}

function WithRange(LocalLocation, Base, LocalRange)
{
	const Resource = { url: LocalLocation ? HttpUrl(LocalLocation, Base) : Base };
	if (LocalRange)
	{
		Resource.range = LocalRange;
	}
	return Resource;
}

function IndexedPlaylist({ attribute: Attribute, element: DomElement }, Base, HasMediaBase, Init)
{
	const Index = DomElement('RepresentationIndex');
	const Source = Index?.getAttribute('sourceURL');
	if (!HasMediaBase || (Source && HttpUrl(Source, Base) !== Base))
	{
		throw new LocalizedError('stream_dash_index_same_file');
	}
	const LocalRange = ByteRange(Index?.getAttribute('range') ?? Attribute('indexRange'));
	if (!LocalRange || LocalRange.end - LocalRange.start >= RuntimePolicy.Transfer.MaxDashIndexBytes)
	{
		throw new LocalizedError('stream_dash_invalid_index_range');
	}
	if (Init.url === Base && !Init.range)
	{
		throw new LocalizedError('stream_dash_init_range_missing');
	}
	const Timescale = Integer(Attribute('timescale') ?? 1, 'timescale', 1);
	const Offset = Integer(Attribute('presentationTimeOffset') ?? 0, 'presentationTimeOffset');
	return { segments: [], ended: true, presentationTimeOffset: Offset / Timescale, index: { url: Base, range: LocalRange, init: Init } };
}

function CheckedCount(Count)
{
	if (!Number.isSafeInteger(Count) || Count < 1)
	{
		throw new LocalizedError('stream_dash_empty_segments');
	}
	if (Count > RuntimePolicy.Transfer.MaxSegments)
	{
		throw new LocalizedError('stream_dash_too_many_segments');
	}
	return Count;
}

function CeilSegmentCount(Count)
{
	// MPD에 적힌 소수 시간을 나누면 부동소수점 오차로 정수 경계를 조금 넘을 수 있습니다.
	return Math.ceil(Count - Math.abs(Count) * Number.EPSILON);
}

// $Time$ 주소 템플릿에는 원본 시각을 유지합니다. 실제 전송에 쓰는 재생 길이만 초 단위로 바꿉니다.
function TimelineSegments(Timeline, Timescale, PeriodDuration, Offset, Limit)
{
	const Entries = Children(Timeline, 'S');
	const Segments = [];
	let Time = 0;
	for (let Index = 0; Index < Entries.length && Segments.length < Limit; Index++)
	{
		const Entry = Entries[Index];
		const Start = Integer(Entry.getAttribute('t') ?? Time, 'SegmentTimeline S@t');
		const Duration = Integer(Entry.getAttribute('d'), 'SegmentTimeline S@d', 1);
		const Repeat = Integer(Entry.getAttribute('r') ?? 0, 'SegmentTimeline S@r', Number.MIN_SAFE_INTEGER);
		if (Start < Time)
		{
			throw new LocalizedError('stream_dash_overlapping_timeline');
		}
		let Count = Repeat + 1;
		if (Repeat < 0)
		{
			const Next = Entries[Index + 1];
			let End;
			if (Next)
			{
				End = Integer(Next.getAttribute('t'), 'SegmentTimeline S@t');
			}
			else if (PeriodDuration !== null)
			{
				End = Offset + PeriodDuration * Timescale;
			}
			else if (Number.isFinite(Limit))
			{
				End = Start + (Limit - Segments.length) * Duration;
			}
			else
			{
				throw new LocalizedError('stream_dash_repeat_end_missing');
			}
			Count = CeilSegmentCount((End - Start) / Duration);
		}
		Count = Math.min(Count, Limit - Segments.length);
		CheckedCount(Count);
		CheckedCount(Segments.length + Count);
		for (let Position = 0; Position < Count; Position++)
		{
			const SegmentTime = Integer(Start + Position * Duration, 'SegmentTimeline S@t');
			Segments.push({ time: SegmentTime, duration: Duration / Timescale });
		}
		Time = Integer(Start + Count * Duration, 'SegmentTimeline S@t');
	}
	CheckedCount(Segments.length);
	return Segments;
}

function SegmentTiming(Addressing, PeriodDuration, ListLength)
{
	const { attribute: Attribute, element: DomElement } = Addressing;
	const Timescale = Integer(Attribute('timescale') ?? 1, 'timescale', 1);
	const Offset = Integer(Attribute('presentationTimeOffset') ?? 0, 'presentationTimeOffset');
	const Start = Integer(Attribute('startNumber') ?? 1, 'startNumber');
	const End = Attribute('endNumber');
	const Limit = End === null ? Infinity : Integer(End, 'endNumber', Start) - Start + 1;
	const TrackTiming = { start: Start, presentationTimeOffset: Offset / Timescale };
	const Timeline = DomElement('SegmentTimeline');
	if (Timeline)
	{
		return { ...TrackTiming, timing: TimelineSegments(Timeline, Timescale, PeriodDuration, Offset, Limit) };
	}
	const DurationAttribute = Attribute('duration');
	if (DurationAttribute === null && ListLength === 1 && PeriodDuration !== null)
	{
		return { ...TrackTiming, timing: [{ time: 0, duration: PeriodDuration }] };
	}
	if (Attribute('eptDelta') !== null && Integer(Attribute('eptDelta'), 'eptDelta', Number.MIN_SAFE_INTEGER) !== 0)
	{
		throw new LocalizedError('stream_dash_ept_delta');
	}
	const Duration = Integer(DurationAttribute, 'duration', 1);
	const Nominal = Duration / Timescale;
	const PeriodCount = PeriodDuration === null ? Infinity : CeilSegmentCount(PeriodDuration * Timescale / Duration);
	const Count = CheckedCount(ListLength ?? Math.min(PeriodCount, Limit));
	return { ...TrackTiming, timing: Array.from({ length: Count }, (_, Index) =>
		{
			const DurationSeconds = Index === Count - 1 && PeriodDuration !== null && PeriodCount === Count
			? Math.min(Nominal, PeriodDuration - Index * Nominal) : Nominal;
			return { time: Integer(Index * Duration, '$Time$'), duration: DurationSeconds };
		}) };
}

function Playlist(Candidate, PeriodDuration, Address)
{
	const { nodes: Nodes, representation: Representation, bandwidth: Bandwidth } = Candidate;
	RejectExternalLinks(Nodes);
	const Addressing = SegmentAddressing(Nodes);
	const { type: Type, attribute: Attribute, element: DomElement, list: List } = Addressing;
	const ManifestUrl = HttpUrl(Address);
	const Base = BaseUrl(Nodes, ManifestUrl);
	// 범위만 지정한 항목은 상속받은 미디어 파일을 가리킵니다. MPD 응답 자체를 조각으로 읽으면 안 됩니다.
	const bHasMediaBase = Base !== ManifestUrl;
	const Values = { RepresentationID: Representation.getAttribute('id'), Bandwidth: Bandwidth };
	const Initialization = DomElement('Initialization');
	const InitTemplate = Attribute('initialization');
	let Init;
	if (InitTemplate)
	{
		Init = { url: HttpUrl(FillTemplate(InitTemplate, Values), Base) };
	}
	else if (Initialization)
	{
		const Source = Initialization.getAttribute('sourceURL');
		const LocalRange = ByteRange(Initialization.getAttribute('range'));
		if (!Source && (!LocalRange || !bHasMediaBase))
		{
			throw new LocalizedError('stream_dash_init_url_missing');
		}
		Init = WithRange(Source, Base, LocalRange);
	}

	if (!Init)
	{
		throw new LocalizedError('stream_dash_init_url_missing');
	}
	if (Type === 'SegmentBase')
	{
		return IndexedPlaylist(Addressing, Base, bHasMediaBase, Init);
	}
	const Entries = Type === 'SegmentList' ? List('SegmentURL') : null;
	if (Entries)
	{
		CheckedCount(Entries.length);
	}
	const { start: Start, timing: Timing, presentationTimeOffset: PresentationTimeOffset } = SegmentTiming(Addressing, PeriodDuration, Entries?.length);
	if (Entries && Entries.length !== Timing.length)
	{
		throw new LocalizedError('stream_dash_list_timeline_mismatch');
	}
	const Media = Attribute('media');
	if (!Entries && (!Media || Attribute('index')))
	{
		throw new LocalizedError('stream_dash_template_missing');
	}
	const Segments = Timing.map(({ time: Time, duration: Duration }, Index) =>
	{
		const Sequence = Integer(Start + Index, '$Number$');
		const Segment = { duration: Duration, sequence: Sequence, init: Init };
		if (Entries)
		{
			const Source = Entries[Index].getAttribute('media');
			const LocalRange = ByteRange(Entries[Index].getAttribute('mediaRange'));
			if (!Source && (!LocalRange || !bHasMediaBase))
			{
				throw new LocalizedError('stream_dash_segment_url_missing');
			}
			Object.assign(Segment, WithRange(Source, Base, LocalRange));
		}
		else
		{
			Segment.url = HttpUrl(FillTemplate(Media, { ...Values, Number: Sequence, Time: Time }), Base);
		}
		return Segment;
	});
	if (!Entries && new Set(Segments.map(Segment => Segment.url)).size !== Segments.length)
	{
		throw new LocalizedError('stream_dash_template_not_unique');
	}
	return { segments: Segments, ended: true, presentationTimeOffset: PresentationTimeOffset };
}

function CodecInformation(Adaptation, Representation)
{
	const Get = Name => Representation.getAttribute(Name) ?? Adaptation.getAttribute(Name) ?? '';
	const Codecs = Get('codecs').split(',').map(Codec => Codec.trim()).filter(Boolean);
	const LocalMimeType = Get('mimeType').trim().toLowerCase();
	const Declared = Get('contentType') || LocalMimeType.split('/')[0];
	const VideoCodec = Codecs.some(Codec => Avc.test(Codec));
	const AudioCodec = Codecs.some(Codec => Aac.test(Codec));
	const IdentifiedAudio = Codecs.some(Codec => /^(?:mp4a|ac-3|ec-3|opus|flac)(?:\.|$)/i.test(Codec));
	const Type = ['video', 'audio'].includes(Declared) ? Declared : VideoCodec ? 'video' : IdentifiedAudio ? 'audio' : '';
	const bMp4 = !LocalMimeType || ['video/mp4', 'audio/mp4', 'application/mp4'].includes(LocalMimeType);
	const Supported = bMp4 && (Type === 'video' && VideoCodec && Codecs.every(Codec => Avc.test(Codec) || Aac.test(Codec)) ||
	Type === 'audio' && AudioCodec && Codecs.every(Codec => Aac.test(Codec)));
	return { type: Type, supported: Supported, muxed: Type === 'video' && AudioCodec };
}

function Candidates(Mpd, Period)
{
	const Tracks = { video: [], audio: [] };
	const bPeriodEncrypted = Boolean(Child(Mpd, 'ContentProtection') || Child(Period, 'ContentProtection'));
	let Count = 0;
	for (const Adaptation of Children(Period, 'AdaptationSet'))
	{
		RejectExternalLinks([Adaptation]);
		const bMain = Children(Adaptation, 'Role').some(Role => Role.getAttribute('schemeIdUri') === 'urn:mpeg:dash:role:2011' &&
		Role.getAttribute('value') === 'main');
		const bTrickMode = Children(Adaptation, 'EssentialProperty').some(Property =>
		Property.getAttribute('schemeIdUri') === 'http://dashif.org/guidelines/trickmode');
		if (bTrickMode)
		{
			continue;
		}
		const bAdaptationEncrypted = bPeriodEncrypted || Boolean(Child(Adaptation, 'ContentProtection'));
		for (const Representation of Children(Adaptation, 'Representation'))
		{
			if (++Count > RuntimePolicy.Dash.MaxRepresentations)
			{
				throw new LocalizedError('stream_dash_too_many_tracks');
			}
			const { type: Type, supported: Supported, muxed: Muxed } = CodecInformation(Adaptation, Representation);
			if (!Type)
			{
				continue;
			}
			const Nodes = [Mpd, Period, Adaptation, Representation];
			const bEncrypted = bAdaptationEncrypted || Boolean(Child(Representation, 'ContentProtection'));
			const Bandwidth = Supported && !bEncrypted ? Integer(Representation.getAttribute('bandwidth'), 'bandwidth', 1) : 0;
			Tracks[Type].push({ representation: Representation, nodes: Nodes, bandwidth: Bandwidth, supported: Supported, muxed: Muxed, main: bMain, encrypted: bEncrypted });
		}
	}
	return Tracks;
}

function SelectTrack(Tracks, Type, PeriodDuration, Address)
{
	const Options = Tracks.filter(Candidate => Candidate.supported && !Candidate.encrypted)
	.sort((Left, Right) => (Type === 'audio' ? Number(Right.main) - Number(Left.main) : 0) || Right.bandwidth - Left.bandwidth);
	let Failure;
	for (const Candidate of Options)
	{
		try
		{
			return { track: Playlist(Candidate, PeriodDuration, Address), muxed: Candidate.muxed };
		}
		catch (ErrorValue)
		{
			Failure ??= ErrorValue;
		}
	}
	if (Failure)
	{
		throw Failure;
	}
	if (Tracks.some(Candidate => Candidate.encrypted))
	{
		throw new LocalizedError('stream_dash_encrypted');
	}
	const Codec = Type === 'video' ? 'H.264' : 'AAC';
	throw new LocalizedError('stream_dash_no_track', Codec);
}

// 오프스크린 문서에서 호출합니다. 파서는 주소와 시각 정보만 계산하고 실제 요청은 호출자가 담당합니다.
export function ParseDash(TextValue, Address)
{
	if (typeof TextValue !== 'string' || TextValue.length > RuntimePolicy.Dash.MaxMpdCodeUnits)
	{
		throw new LocalizedError('stream_dash_mpd_size');
	}
	if (/<!DOCTYPE\b/i.test(TextValue))
	{
		throw new LocalizedError('stream_dash_doctype');
	}
	const LocalOwnerDocument = new DOMParser().parseFromString(TextValue, 'application/xml');
	const Mpd = LocalOwnerDocument.documentElement;
	if (Mpd?.localName !== 'MPD' || (Mpd.namespaceURI && Mpd.namespaceURI !== MpdNamespace) ||
	LocalOwnerDocument.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length)
	{
		throw new LocalizedError('stream_dash_invalid_mpd');
	}
	if ((Mpd.getAttribute('type') ?? 'static') !== 'static')
	{
		throw new LocalizedError('stream_dash_static_only');
	}
	const Periods = Children(Mpd, 'Period');
	if (Periods.length !== 1)
	{
		// 광고/안내 구간 뒤의 보호된 본편도 실제 DRM 제한을 안내합니다.
		if (Periods.some(LocalPeriod => Object.values(Candidates(Mpd, LocalPeriod)).flat().some(Track => Track.encrypted)))
		{
			throw new LocalizedError('stream_dash_encrypted');
		}
		throw new LocalizedError('stream_dash_single_period');
	}
	const [Period] = Periods;
	RejectExternalLinks([Mpd, Period]);
	const PresentationDuration = Seconds(Mpd.getAttribute('mediaPresentationDuration'));
	const PeriodStart = Seconds(Period.getAttribute('start')) ?? 0;
	const PeriodDuration = Seconds(Period.getAttribute('duration')) ??
	(PresentationDuration === null ? null : PresentationDuration - PeriodStart);
	if (PeriodDuration !== null && PeriodDuration <= 0)
	{
		throw new LocalizedError('stream_dash_invalid_duration');
	}
	const Tracks = Candidates(Mpd, Period);
	const Video = SelectTrack(Tracks.video, 'video', PeriodDuration, Address);
	const Result = { video: Video.track };
	if (Tracks.audio.length && !Video.muxed)
	{
		Result.audio = SelectTrack(Tracks.audio, 'audio', PeriodDuration, Address).track;
	}
	return Result;
}

function ReadIndexBox(View)
{
	for (let Start = 0; Start < View.byteLength; )
	{
		const Remaining = View.byteLength - Start;
		if (Remaining < Mp4BoxHeaderBytes)
		{
			break;
		}
		const Size = View.getUint32(Start);
		const Header = Size === 1 ? Mp4ExtendedBoxHeaderBytes : Mp4BoxHeaderBytes;
		if (Remaining < Header)
		{
			break;
		}
		const Length = Size === 1 ? Number(View.getBigUint64(Start + Mp4BoxHeaderBytes)) : Size;
		if (Length < Header || Length > Remaining)
		{
			break;
		}
		const End = Start + Length;
		if (View.getUint32(Start + 4) === SidxBoxType)
		{
			return { start: Start + Header, end: End };
		}
		Start = End;
	}
	throw new LocalizedError('stream_dash_sidx_missing');
}

function IndexedSegments(Bytes, { url: Url, range: LocalRange, init: Init })
{
	if (!(Bytes instanceof Uint8Array) || Bytes.byteLength !== LocalRange.end - LocalRange.start + 1)
	{
		throw new LocalizedError('stream_dash_sidx_range_mismatch');
	}
	const View = new DataView(Bytes.buffer, Bytes.byteOffset, Bytes.byteLength);
	const { start: Start, end: End } = ReadIndexBox(View);
	if (End - Start < SidxV0FieldsBytes)
	{
		throw new LocalizedError('stream_dash_sidx_header_truncated');
	}
	const Version = View.getUint8(Start);
	if (Version !== 0 && Version !== 1)
	{
		throw new LocalizedError('stream_dash_sidx_version');
	}
	const FieldsLength = Version === 1 ? SidxV1FieldsBytes : SidxV0FieldsBytes;
	if (End - Start < FieldsLength)
	{
		throw new LocalizedError('stream_dash_sidx_header_truncated');
	}
	const Timescale = View.getUint32(Start + 8);
	const Count = View.getUint16(Start + FieldsLength - 2);
	if (!Timescale || !Count || FieldsLength + SidxReferenceBytes * Count !== End - Start)
	{
		throw new LocalizedError('stream_dash_sidx_invalid_segments');
	}
	CheckedCount(Count);
	const FirstOffset = Version === 1 ? View.getBigUint64(Start + 20) : BigInt(View.getUint32(Start + 16));
	// SIDX 조각 오프셋의 기준은 상자의 끝입니다. HTTP 범위의 시작 주소와 다를 수 있습니다.
	let MediaStart = BigInt(LocalRange.start) + BigInt(End) + FirstOffset;
	return Array.from({ length: Count }, (_, Index) =>
	{
		const Position = Start + FieldsLength + Index * SidxReferenceBytes;
		const Reference = View.getUint32(Position);
		if (Reference >>> 31)
		{
			throw new LocalizedError('stream_dash_sidx_hierarchical');
		}
		const Duration = View.getUint32(Position + 4);
		if (!Reference || !Duration)
		{
			throw new LocalizedError('stream_dash_sidx_segment_invalid');
		}
		const MediaEnd = MediaStart + BigInt(Reference) - 1n;
		if (MediaEnd > BigInt(Number.MAX_SAFE_INTEGER))
		{
			throw new LocalizedError('stream_dash_sidx_segment_range');
		}
		const SegmentRange = { start: Number(MediaStart), end: Number(MediaEnd) };
		MediaStart = MediaEnd + 1n;
		return { url: Url, range: SegmentRange, duration: Duration / Timescale, sequence: Index + 1, init: Init };
	});
}

export async function ResolveDash(TextValue, Address, ReadRange)
{
	const { video: Video, audio: LocalAudio } = ParseDash(TextValue, Address);
	async function ResolveTrack(Track)
	{
		const { index: Index, ...Playlist } = Track;
		if (!Index)
		{
			return Track;
		}
		const Bytes = await ReadRange(Index.url, Index.range);
		return { ...Playlist, segments: IndexedSegments(Bytes, Index) };
	}

	const [ResolvedVideo, ResolvedAudio] = await Promise.all([ResolveTrack(Video), LocalAudio && ResolveTrack(LocalAudio)]);
	return ResolvedAudio ? { video: ResolvedVideo, audio: ResolvedAudio } : { video: ResolvedVideo };
}
