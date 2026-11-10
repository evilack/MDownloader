import {LocalizedError} from './i18n.js';
import {AssertMediaAllowed} from './youtube-source-policy.js';

// Limits apply to the complete operation, not just individual fetches.
export const SubtitleLimits = Object.freeze({tracks:128, resourceBytes:8*1024*1024, totalBytes:64*1024*1024, cues:100000, segments:4096, concurrency:4, timeoutMs:30000});
const Fail = (Key, Detail) => new LocalizedError(Key, Detail || '');
const Invalid = Detail => { throw Fail('subtitle_invalid', Detail); };
const Unsupported = Detail => { throw Fail('subtitle_unsupported', Detail); };
const Limit = Detail => { throw Fail('subtitle_limit', Detail); };
const Encoder = new TextEncoder();

function HttpUrl(Value, Base)
{
	let Url;
	try { Url = new URL(Value, Base); } catch { Invalid('url'); }
	if (!['http:', 'https:'].includes(Url.protocol) || Url.username || Url.password) Unsupported('url_protocol');
	return Url.href;
}

function Attributes(Text)
{
	const Result = {};
	const Pattern = /([\w-]+)=(?:"([^"]*)"|([^,]*))(?:,|$)/g;
	for (const Match of Text.matchAll(Pattern)) Result[Match[1]] = Match[2] ?? Match[3];
	return Result;
}

/** The URL of the actual selected variant determines its subtitle group. */
export function FindHlsSubtitles(Text, Address, SelectedUrl)
{
	CheckSize(Text);
	const Lines = Text.replace(/^\uFEFF/, '').split(/\r?\n/).map(Line => Line.trim());
	let SelectedGroup;
	if (SelectedUrl)
	{
		const Selected = HttpUrl(SelectedUrl, Address);
		for (let Index = 0; Index < Lines.length; Index++)
		{
			if (!Lines[Index].startsWith('#EXT-X-STREAM-INF:')) continue;
			const Attr = Attributes(Lines[Index].slice(18));
			let Next = Index + 1;
			while (Next < Lines.length && (!Lines[Next] || Lines[Next].startsWith('#'))) Next++;
			if (Next < Lines.length && HttpUrl(Lines[Next], Address) === Selected) SelectedGroup = Attr.SUBTITLES || null;
		}
	}
	const Result = [];
	for (const Line of Lines)
	{
		if (!Line.startsWith('#EXT-X-MEDIA:')) continue;
		const Attr = Attributes(Line.slice(13));
		if (Attr.TYPE !== 'SUBTITLES' || (SelectedGroup !== undefined && Attr['GROUP-ID'] !== SelectedGroup)) continue;
		Result.push({...(Attr.URI ? {url:HttpUrl(Attr.URI, Address)} : {unsupported:'hls_subtitle_uri'}), language:Attr.LANGUAGE || 'und', label:Attr.NAME || Attr.LANGUAGE || 'Subtitles', format:'hls'});
	}
	if (Result.length > SubtitleLimits.tracks) Limit('tracks');
	return Result;
}

function CheckSize(Text)
{
	if (typeof Text !== 'string') Invalid('text');
	if (Text.length > SubtitleLimits.resourceBytes || Encoder.encode(Text).byteLength > SubtitleLimits.resourceBytes) Limit('resource_bytes');
}

function DecodeEntities(Text)
{
	return Text.replace(/&([^;]+);/g, (_, Entity) =>
	{
		const Known = {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'"};
		if (Entity in Known) return Known[Entity];
		if (/^#(?:x[\da-f]+|\d+)$/i.test(Entity))
		{
			const Value = Entity[1].toLowerCase() === 'x' ? parseInt(Entity.slice(2),16) : Number(Entity.slice(1));
			if (Value > 0 && Value <= 0x10ffff && !(Value >= 0xd800 && Value <= 0xdfff)) return String.fromCodePoint(Value);
		}
		Invalid('xml_entity');
	});
}

// Small non-validating XML reader for DASH/TTML. No DOM, external entities, or DTDs.
function Xml(Text)
{
	CheckSize(Text);
	const Root = {name:'#document', attrs:{}, children:[]}, Stack = [Root];
	let Index = 0, Count = 0;
	while (Index < Text.length)
	{
		if (++Count > SubtitleLimits.cues * 4) Limit('xml_nodes');
		if (Text[Index] !== '<')
		{
			const End = Text.indexOf('<', Index);
			Stack.at(-1).children.push(DecodeEntities(Text.slice(Index, End < 0 ? Text.length : End)));
			Index = End < 0 ? Text.length : End;
			continue;
		}
		if (Text.startsWith('<!--', Index) || Text.startsWith('<?', Index) || Text.startsWith('<![CDATA[',Index))
		{
			const Cdata = Text.startsWith('<![CDATA[',Index), Comment = Text.startsWith('<!--',Index);
			const EndToken = Cdata ? ']]>' : Comment ? '-->' : '?>';
			const End = Text.indexOf(EndToken,Index+2);
			if (End < 0) Invalid('xml');
			if (Cdata) Stack.at(-1).children.push(Text.slice(Index+9,End));
			Index = End + EndToken.length;
			continue;
		}
		if (Text.startsWith('<!',Index)) Unsupported('xml_doctype');
		let End = Index + 1, Quote = '';
		for (; End < Text.length; End++)
		{
			if (Quote) { if (Text[End] === Quote) Quote = ''; }
			else if (Text[End] === '"' || Text[End] === "'") Quote = Text[End];
			else if (Text[End] === '>') break;
		}
		if (End >= Text.length) Invalid('xml');
		const Tag = Text.slice(Index+1,End).trim(); Index = End+1;
		if (Tag[0] === '/')
		{
			if (Stack.length === 1 || Stack.at(-1).qualified !== Tag.slice(1).trim()) Invalid('xml_nesting');
			Stack.pop(); continue;
		}
		const Match = /^([\w:.-]+)([\s\S]*?)(\/)?$/.exec(Tag);
		if (!Match) Invalid('xml_tag');
		const Attrs = {}, Pattern = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
		let Offset = 0;
		while (Offset < Match[2].length)
		{
			if (!Match[2].slice(Offset).trim()) break;
			Pattern.lastIndex = Offset;
			const Attr = Pattern.exec(Match[2]);
			if (!Attr) Invalid('xml_attribute');
			Attrs[Attr[1]] = DecodeEntities(Attr[2] ?? Attr[3]); Offset = Pattern.lastIndex;
		}
		const Node = {name:Match[1].split(':').at(-1), qualified:Match[1], attrs:Attrs, children:[]};
		Stack.at(-1).children.push(Node);
		if (!Match[3]) Stack.push(Node);
	}
	if (Stack.length !== 1) Invalid('xml_nesting');
	return Root;
}
const Children = (Node, Name) => Node.children.filter(Child => typeof Child !== 'string' && (!Name || Child.name === Name));
const PlainText = Node => typeof Node === 'string' ? Node : Node.children.map(PlainText).join('');
const Attr = (Node, Name) => Object.entries(Node.attrs).find(([Key]) => Key.split(':').at(-1) === Name)?.[1];

function DashInteger(Value, Default, Minimum = 0)
{
	if (Value === undefined) return Default;
	if (!/^-?\d+$/.test(Value) || !Number.isSafeInteger(Number(Value)) || Number(Value) < Minimum) Invalid('dash_integer');
	return Number(Value);
}
function DashDuration(Value)
{
	if (Value === undefined) return undefined;
	const Match = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(Value);
	if (!Match || !Match.slice(1).some(Part => Part !== undefined)) Unsupported('dash_duration');
	const Seconds = Number(Match[1] || 0)*86400 + Number(Match[2] || 0)*3600 + Number(Match[3] || 0)*60 + Number(Match[4] || 0);
	if (!Number.isFinite(Seconds)) Invalid('dash_duration');
	return Seconds;
}
const CeilCount = Value => Math.ceil(Value - Math.abs(Value)*Number.EPSILON);
function DashCount(Count)
{
	if (!Number.isSafeInteger(Count) || Count < 1) Invalid('dash_segment_count');
	if (Count > SubtitleLimits.segments) Limit('segments');
	return Count;
}
function DashTemplate(Template, Values)
{
	let Result = '', Index = 0;
	while (Index < Template.length)
	{
		if (Template[Index] !== '$') { Result += Template[Index++]; continue; }
		if (Template[Index+1] === '$') { Result += '$'; Index += 2; continue; }
		const End = Template.indexOf('$',Index+1);
		if (End < 0) Invalid('dash_template');
		const Match = /^(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?$/.exec(Template.slice(Index+1,End));
		if (!Match || Values[Match[1]] === undefined) Unsupported('dash_template');
		const Width = Number(Match[2] || 0);
		if (Width > 32 || (Match[1] === 'RepresentationID' && Width)) Unsupported('dash_template_format');
		Result += String(Values[Match[1]]).padStart(Width,'0'); Index = End+1;
	}
	return Result;
}
function DashSegments(Nodes, Base, PeriodStart, PeriodDuration, Representation)
{
	const Addressing = [];
	let Type;
	for (const Node of Nodes)
	{
		const Local = Children(Node).filter(Child => ['SegmentTemplate','SegmentList','SegmentBase'].includes(Child.name));
		if (Local.length > 1) Invalid('dash_addressing');
		if (Local.length)
		{
			if (Type && Type !== Local[0].name) Addressing.length = 0;
			Type = Local[0].name; Addressing.push(Local[0]);
		}
	}
	if (!Type) return undefined;
	if (Type === 'SegmentBase') Unsupported('dash_segment_base_text');
	const Value = Name => Addressing.toReversed().map(Node => Attr(Node,Name)).find(Item => Item !== undefined);
	const Element = Name => Addressing.toReversed().map(Node => Children(Node,Name)[0]).find(Boolean);
	if (Value('initialization') || Element('Initialization') || Value('index') || Value('indexRange')) Unsupported('dash_text_initialization');
	if (Value('eptDelta') && Number(Value('eptDelta')) !== 0) Unsupported('dash_ept_delta');
	const Scale = DashInteger(Value('timescale'),1,1), Pto = DashInteger(Value('presentationTimeOffset'),0);
	const Offset = PeriodStart - Pto/Scale;
	const StartNumber = DashInteger(Value('startNumber'),1), EndNumber = DashInteger(Value('endNumber'),undefined,StartNumber);
	const Bound = EndNumber === undefined ? Infinity : DashCount(EndNumber-StartNumber+1);
	const ListNode = Type === 'SegmentList' ? Addressing.toReversed().find(Node => Children(Node,'SegmentURL').length) : undefined;
	const Entries = ListNode ? Children(ListNode,'SegmentURL') : undefined;
	if (Type === 'SegmentList' && !Entries) Invalid('dash_segment_list');
	if (Entries) DashCount(Entries.length);
	const Timeline = Element('SegmentTimeline'), Times = [];
	if (Timeline)
	{
		const Points = Children(Timeline,'S');
		let NextTime = 0;
		for (let Index = 0; Index < Points.length && Times.length < Bound; Index++)
		{
			const Point = Points[Index];
			const Time = DashInteger(Attr(Point,'t'),NextTime), Duration = DashInteger(Attr(Point,'d'),undefined,1), Repeat = DashInteger(Attr(Point,'r'),0,-1);
			if (Duration === undefined || Time < NextTime) Invalid('dash_timeline');
			let Count = Repeat+1;
			if (Repeat === -1)
			{
				const Next = Points[Index+1];
				const End = Next ? DashInteger(Attr(Next,'t'),undefined) : PeriodDuration === undefined ? undefined : Pto+PeriodDuration*Scale;
				const ListRemaining = Entries ? Entries.length-Times.length : Bound-Times.length;
				if (End !== undefined) Count = CeilCount((End-Time)/Duration);
				else if (Number.isFinite(ListRemaining)) Count = ListRemaining;
				else Unsupported('dash_unbounded_timeline');
			}
			Count = Math.min(Count,Bound-Times.length);
			DashCount(Count); DashCount(Times.length+Count);
			for (let Position = 0; Position < Count; Position++)
			{
				const SegmentTime = Time+Position*Duration;
				if (!Number.isSafeInteger(SegmentTime)) Invalid('dash_timeline');
				Times.push(SegmentTime);
			}
			NextTime = Time+Count*Duration;
		}
		DashCount(Times.length);
		if (Entries && Entries.length !== Times.length) Invalid('dash_list_timeline');
	}
	else if (!Entries)
	{
		const Duration = DashInteger(Value('duration'),undefined,1);
		if (!Duration) Unsupported('dash_segment_duration');
		const Count = Math.min(Bound,PeriodDuration === undefined ? Infinity : CeilCount(PeriodDuration*Scale/Duration));
		if (!Number.isFinite(Count)) Unsupported('dash_unbounded_segments');
		DashCount(Count);
		for (let Index = 0; Index < Count; Index++)
		{
			const Time = Index*Duration;
			if (!Number.isSafeInteger(Time)) Invalid('dash_segment_time');
			Times.push(Time);
		}
	}
	const Segments = [];
	if (Entries)
	{
		for (const Entry of Entries)
		{
			if (Attr(Entry,'mediaRange') || Attr(Entry,'index') || Attr(Entry,'indexRange')) Unsupported('dash_text_range');
			if (!Attr(Entry,'media')) Invalid('dash_text_url');
			Segments.push({url:HttpUrl(Attr(Entry,'media'),Base),offset:Offset});
		}
	}
	else
	{
		const Template = Value('media');
		if (!Template) Invalid('dash_media_template');
		const Values = {RepresentationID:Attr(Representation,'id'),Bandwidth:Attr(Representation,'bandwidth')};
		for (let Index = 0; Index < Times.length; Index++)
		{
			const Sequence = StartNumber+Index;
			if (!Number.isSafeInteger(Sequence)) Invalid('dash_segment_number');
			Segments.push({url:HttpUrl(DashTemplate(Template,{...Values,Number:Sequence,Time:Times[Index]}),Base),offset:Offset});
		}
		if (new Set(Segments.map(Segment=>Segment.url)).size !== Segments.length) Invalid('dash_nonunique_template');
	}
	return Segments;
}

/** Standalone and static segmented text renditions; fMP4 text stays explicit. */
export function FindDashSubtitles(Text, Address)
{
	const Document = Xml(Text), Result = [];
	const Mpd = Children(Document,'MPD')[0];
	if (!Mpd) Invalid('dash_xml');
	function Base(Node, Parent)
	{
		const Value = Children(Node,'BaseURL')[0];
		return Value ? HttpUrl(PlainText(Value).trim(),Parent) : Parent;
	}
	const MpdBase = Base(Mpd,Address), Periods = Children(Mpd,'Period');
	const TotalDuration = DashDuration(Attr(Mpd,'mediaPresentationDuration'));
	let PreviousEnd = 0;
	for (let PeriodIndex = 0; PeriodIndex < Periods.length; PeriodIndex++)
	{
		const Period = Periods[PeriodIndex];
		const PeriodStart = DashDuration(Attr(Period,'start')) ?? PreviousEnd;
		const NextStart = Periods[PeriodIndex+1] && DashDuration(Attr(Periods[PeriodIndex+1],'start'));
		const PeriodDuration = DashDuration(Attr(Period,'duration')) ?? (NextStart !== undefined && PeriodStart !== undefined ? NextStart-PeriodStart : TotalDuration !== undefined && PeriodStart !== undefined ? TotalDuration-PeriodStart : undefined);
		if (PeriodDuration !== undefined && PeriodDuration <= 0) Invalid('dash_period_duration');
		PreviousEnd = PeriodStart !== undefined && PeriodDuration !== undefined ? PeriodStart+PeriodDuration : undefined;
		const PeriodBase = Base(Period,MpdBase);
		for (const Set of Children(Period,'AdaptationSet'))
		{
			const Reps = Children(Set,'Representation');
			for (const Rep of Reps.length ? Reps : [Set])
			{
				const Mime = Attr(Rep,'mimeType') || Attr(Set,'mimeType') || '';
				const Codecs = Attr(Rep,'codecs') || Attr(Set,'codecs') || '';
				if (!(Attr(Set,'contentType') === 'text' || Mime.startsWith('text/') || /ttml|vtt|stpp|wvtt/i.test(Mime+' '+Codecs))) continue;
				const Language = Attr(Rep,'lang') || Attr(Set,'lang') || Attr(Period,'lang') || Attr(Mpd,'lang') || 'und';
				const Label = PlainText(Children(Rep,'Label')[0] || Children(Set,'Label')[0] || {children:[Language]}).trim();
				const SetBase = Base(Set,PeriodBase), Url = Rep === Set ? SetBase : Base(Rep,SetBase);
				const Nodes = [Mpd,Period,Set,Rep];
				const Direct = Nodes.slice(2).some(Node => Children(Node,'BaseURL').length) && !/\/$/.test(new URL(Url).pathname);
				const Descriptor = {language:Language,label:Label,format:/vtt/i.test(Mime+' '+Codecs) ? 'vtt' : 'ttml'};
				try
				{
					if (Attr(Mpd,'type') === 'dynamic') Unsupported('dash_dynamic_text');
					if (Nodes.some(Node => Children(Node,'ContentProtection').length)) Unsupported('dash_encrypted_text');
					if (/mp4|stpp|wvtt/i.test(Mime+' '+Codecs)) Unsupported('dash_fragmented_text');
					if (PeriodStart === undefined) Unsupported('dash_period_timing');
					const Segments = DashSegments(Nodes,Url,PeriodStart,PeriodDuration,Rep);
					if (Segments) Descriptor.segments = Segments;
					else if (Direct)
					{
						if (PeriodStart) Descriptor.segments = [{url:Url,offset:PeriodStart}];
						else Descriptor.url = Url;
					}
					else Unsupported('dash_text_url');
				}
				catch (ErrorValue)
				{
					if (ErrorValue.key !== 'subtitle_unsupported') throw ErrorValue;
					Descriptor.unsupported = ErrorValue.args[0];
				}
				Result.push(Descriptor);
			}
		}
	}
	if (Result.length > SubtitleLimits.tracks) Limit('tracks');
	return Result;
}

function Timestamp(Value)
{
	const Match = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(Value);
	if (!Match || Number(Match[2]) > 59 || Number(Match[3]) > 59) Invalid('timestamp');
	const Time = Number(Match[1] || 0)*3600 + Number(Match[2])*60 + Number(Match[3]) + Number(Match[4])/1000;
	if (!Number.isFinite(Time)) Invalid('timestamp');
	return Time;
}
function FormatTime(Time)
{
	if (!Number.isFinite(Time) || Time < 0) Invalid('timestamp');
	const Millis = Math.round(Time*1000);
	return `${String(Math.floor(Millis/3600000)).padStart(2,'0')}:${String(Math.floor(Millis/60000)%60).padStart(2,'0')}:${String(Math.floor(Millis/1000)%60).padStart(2,'0')}.${String(Millis%1000).padStart(3,'0')}`;
}
export function ParseVtt(Text, Srt = false)
{
	const Normal = Text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
	if (!Srt && !/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(Normal)) Invalid('webvtt_header');
	// WebVTT space-only lines belong to the payload; only genuinely empty lines separate cues.
	const Blocks = Normal.split(Srt ? /\n[ \t]*\n/ : /\n{2,}/), Cues = [], Extras = [];
	let Map;
	if (!Srt)
	{
		const Header = Blocks.shift();
		if (Header.includes('-->')) Invalid('webvtt_header_separator');
		const MapText = Header.split('\n').find(Line => Line.startsWith('X-TIMESTAMP-MAP='));
		if (MapText)
		{
			const Local = /LOCAL:([^,\s]+)/.exec(MapText), Mpeg = /MPEGTS:(\d+)/.exec(MapText);
			if (!Local || !Mpeg || Number(Mpeg[1]) >= 2**33) Invalid('timestamp_map');
			Map = {local:Timestamp(Local[1]),mpeg:Number(Mpeg[1])/90000};
		}
	}
	for (const Block of Blocks)
	{
		if (!Block.trim()) continue;
		if (!Srt && /^(?:NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(Block))
		{
			if (!Block.startsWith('NOTE')) Extras.push(Block);
			continue;
		}
		const Lines = Block.split('\n');
		let Id = '';
		if (!Lines[0].includes('-->')) Id = Lines.shift();
		const Timing = /^(\S+)\s+-->\s+(\S+)(.*)$/.exec(Lines.shift() || '');
		// WebVTT allows an empty cue payload (YouTube ASR uses it to clear text).
		if (!Timing || Srt && !Lines.length) Invalid('cue');
		const Start = Timestamp(Timing[1]), End = Timestamp(Timing[2]);
		if (End <= Start) Invalid('cue_duration');
		Cues.push({start:Start,end:End,id:Srt?'':Id,settings:Timing[3],text:Lines.join('\n')});
		if (Cues.length > SubtitleLimits.cues) Limit('cues');
	}
	return {cues:Cues,extras:Extras,map:Map};
}
function Ttml(Text)
{
	const Root = Children(Xml(Text),'tt')[0];
	if (!Root) Invalid('ttml_root');
	const FrameRate = Number(Attr(Root,'frameRate') || 30), Multiplier = (Attr(Root,'frameRateMultiplier') || '1 1').split(/\s+/).map(Number);
	const Fps = FrameRate*Multiplier[0]/Multiplier[1], Tick = Number(Attr(Root,'tickRate') || Fps*(Number(Attr(Root,'subFrameRate')) || 1));
	if (!(Fps > 0) || !(Tick > 0) || !Number.isFinite(Fps+Tick)) Invalid('ttml_rate');
	function Time(Value)
	{
		let Match = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(Value);
		if (Match) return Number(Match[1])*({h:3600,m:60,s:1,ms:.001,f:1/Fps,t:1/Tick}[Match[2]]);
		Match = /^(\d{2,}):(\d{2}):(\d{2})(?:(\.\d+)|:(\d{2})(?:\.(\d+))?)?$/.exec(Value);
		if (!Match || Number(Match[2])>59 || Number(Match[3])>59) Invalid('ttml_time');
		return Number(Match[1])*3600+Number(Match[2])*60+Number(Match[3])+Number(Match[4]||0)+(Number(Match[5]||0)+Number('0.'+(Match[6]||'0')))/Fps;
	}
	const Cues = [];
	const Escape = Value => Value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
	function Content(Node, Preserve)
	{
		if (typeof Node === 'string') return Escape(Preserve ? Node : Node.replace(/\s+/g,' '));
		if (['begin','end','dur'].some(Name => Attr(Node,Name) !== undefined)) Unsupported('ttml_timed_span');
		if (Node.name === 'br') return '\n';
		if (!['span'].includes(Node.name)) Unsupported('ttml_inline_element');
		return Node.children.map(Child => Content(Child,Attr(Node,'space') === 'preserve' || Preserve)).join('');
	}
	function Visit(Node, ParentStart, ParentEnd, Preserve)
	{
		if (Attr(Node,'timeContainer') === 'seq') Unsupported('ttml_sequential_time');
		const Start = ParentStart + (Attr(Node,'begin') ? Time(Attr(Node,'begin')) : 0);
		const End = Math.min(ParentEnd, Attr(Node,'end') ? ParentStart+Time(Attr(Node,'end')) : Infinity, Attr(Node,'dur') ? Start+Time(Attr(Node,'dur')) : Infinity);
		Preserve = Attr(Node,'space') === 'preserve' || Preserve;
		if (Node.name === 'p')
		{
			if (!Number.isFinite(End) || End <= Start) Invalid('ttml_duration');
			const TextValue = Node.children.map(Child => Content(Child,Preserve)).join('').trim();
			if (TextValue) Cues.push({start:Start,end:End,id:'',settings:'',text:TextValue});
			if (Cues.length > SubtitleLimits.cues) Limit('cues');
		}
		else for (const Child of Children(Node)) if (['body','div','p'].includes(Child.name)) Visit(Child,Start,End,Preserve);
	}
	Visit(Root,0,Infinity,false);
	return {cues:Cues,extras:[]};
}
export function Serialize(Parsed)
{
	return 'WEBVTT\n\n'+[...new Set(Parsed.extras || []), ...Parsed.cues.map(Cue => `${Cue.id ? Cue.id+'\n' : ''}${FormatTime(Cue.start)} --> ${FormatTime(Cue.end)}${Cue.settings || ''}\n${Cue.text}`)].join('\n\n')+'\n';
}
function ParseText(Text, Format)
{
	if (/^\uFEFF?WEBVTT/.test(Text) || Text.startsWith('WEBVTT')) return ParseVtt(Text);
	if (['ttml','dfxp','xml'].includes(Format) || /^\s*(?:<\?xml[^>]*>\s*)?<(?:\w+:)?tt(?:\s|>)/.test(Text)) return Ttml(Text);
	if (Format === 'srt' || /^\s*(?:\d+\s*\r?\n)?\d{2,}:\d{2}:\d{2},\d{3}\s*-->/.test(Text)) return ParseVtt(Text,true);
	Unsupported(Format || 'format');
}

/** Strict by default; an explicit onError receipt lets callers retain successful tracks. */
export async function ReadSubtitles(Descriptors, {signal, authorize, onProgress, onError, fetch: Fetch = globalThis.fetch} = {})
{
	if (!Array.isArray(Descriptors)) Invalid('descriptors');
	if (Descriptors.length > SubtitleLimits.tracks) Limit('tracks');
	const Controller = new AbortController();
	const Signal = signal ? AbortSignal.any([signal,Controller.signal]) : Controller.signal;
	Signal.throwIfAborted();
	let TotalBytes = 0;
	function Count(Text)
	{
		CheckSize(Text); TotalBytes += Encoder.encode(Text).byteLength;
		if (TotalBytes > SubtitleLimits.totalBytes) Limit('total_bytes');
		return Text;
	}
	async function FetchText(Address)
	{
		Signal.throwIfAborted();
		Address = HttpUrl(Address);
		AssertMediaAllowed({url:Address});
		if (typeof authorize !== 'function') throw Fail('subtitle_download_failed','authorization_required');
		await authorize([Address]);
		Signal.throwIfAborted();
		const RequestSignal = AbortSignal.any([Signal,AbortSignal.timeout(SubtitleLimits.timeoutMs)]);
		let Response;
		try { Response = await Fetch(Address,{signal:RequestSignal,redirect:'error',credentials:'include',cache:'no-store'}); }
		catch (ErrorValue)
		{
			Signal.throwIfAborted();
			throw Fail('subtitle_download_failed',ErrorValue.name === 'TimeoutError' ? 'timeout' : 'network');
		}
		if (Response.url) AssertMediaAllowed({url:Response.url});
		if (!Response.ok || !Response.body)
		{
			await Response.body?.cancel();
			const ErrorValue = Fail('subtitle_download_failed',`http_${Response.status}`);
			throw ErrorValue;
		}
		if (Number(Response.headers.get('content-length')) > SubtitleLimits.resourceBytes) { await Response.body.cancel(); Limit('resource_bytes'); }
		const Reader = Response.body.getReader(), Decoder = new TextDecoder('utf-8',{fatal:true});
		let Text = '', Bytes = 0;
		try
		{
			for (;;)
			{
				RequestSignal.throwIfAborted();
				const {value,done} = await Reader.read();
				if (done) break;
				Bytes += value.byteLength; TotalBytes += value.byteLength;
				if (Bytes > SubtitleLimits.resourceBytes || TotalBytes > SubtitleLimits.totalBytes) Limit('resource_bytes');
				Text += Decoder.decode(value,{stream:true});
			}
			return Text + Decoder.decode();
		}
		catch (ErrorValue)
		{
			await Reader.cancel().catch(()=>{});
			Signal.throwIfAborted();
			if (ErrorValue.key) throw ErrorValue;
			throw Fail('subtitle_download_failed',ErrorValue.name === 'TimeoutError' ? 'timeout' : 'body');
		}
		finally { Reader.releaseLock(); }
	}
	async function ReadHls(Text, Address)
	{
		const Lines = Text.replace(/^\uFEFF/,'').split(/\r?\n/).map(Line=>Line.trim());
		if (!Lines.includes('#EXT-X-ENDLIST')) Unsupported('hls_live_subtitles');
		const Segments = [];
		for (const Line of Lines)
		{
			if (Line.startsWith('#EXT-X-KEY:') && Attributes(Line.slice(11)).METHOD !== 'NONE') Unsupported('hls_encrypted_subtitles');
			if (/^#EXT-X-(?:MAP|BYTERANGE|DISCONTINUITY(?::|$)|GAP|STREAM-INF|MEDIA:)/.test(Line)) Unsupported('hls_subtitle_layout');
			if (Line && !Line.startsWith('#')) Segments.push(HttpUrl(Line,Address));
		}
		if (Segments.length > SubtitleLimits.segments) Limit('segments');
		if (!Segments.length) Invalid('hls_segments');
		const Cues = [], Extras = [], Seen = new Set();
		let LastMpeg, Mapped;
		for (const Url of Segments)
		{
			const Parsed = ParseVtt(await FetchText(Url));
			if (Mapped !== undefined && Mapped !== !!Parsed.map) Unsupported('hls_inconsistent_timestamp_map');
			Mapped = !!Parsed.map;
			let Offset = 0;
			if (Parsed.map)
			{
				let Mpeg = Parsed.map.mpeg;
				const Wrap = 2**33/90000;
				if (LastMpeg !== undefined) Mpeg += Math.round((LastMpeg-Mpeg)/Wrap)*Wrap;
				LastMpeg = Mpeg; Offset = Mpeg - Parsed.map.local;
			}
			Extras.push(...Parsed.extras);
			for (const Cue of Parsed.cues)
			{
				Cue.start += Offset; Cue.end += Offset;
				const Key = JSON.stringify([Cue.start,Cue.end,Cue.settings,Cue.text]);
				if (!Seen.has(Key)) { Seen.add(Key); Cues.push(Cue); }
				if (Cues.length > SubtitleLimits.cues) Limit('cues');
			}
		}
		Cues.sort((A,B)=>A.start-B.start || A.end-B.end);
		// RFC 8216 defines the missing timestamp map as LOCAL 0 / MPEGTS 0.
		return {cues:Cues,extras:Extras,timeBase:'media'};
	}
	async function Read(Descriptor)
	{
		Signal.throwIfAborted();
		if (!Descriptor || typeof Descriptor !== 'object') Invalid('descriptor');
		let RecordingClock;
		if (Descriptor.recordingClock !== undefined)
		{
			const Clock = Descriptor.recordingClock;
			if (!Clock || typeof Clock !== 'object' || !Number.isFinite(Clock.time) || Clock.time < 0 || !Number.isFinite(Clock.sampledAt) || Clock.sampledAt < 0 || Clock.rate !== 1) Invalid('recording_clock');
			RecordingClock = {time:Clock.time,sampledAt:Clock.sampledAt,rate:1};
		}
		if (Descriptor.unsupported) Unsupported(Descriptor.unsupported);
		const Format = (Descriptor.format || '').toLowerCase();
		let Parsed;
		if (Descriptor.segments !== undefined)
		{
			if (!Array.isArray(Descriptor.segments)) Invalid('segments');
			DashCount(Descriptor.segments.length);
			Parsed = {cues:[],extras:[]};
			const Seen = new Set();
			for (const Segment of Descriptor.segments)
			{
				if (!Segment || typeof Segment !== 'object' || !Number.isFinite(Segment.offset ?? 0)) Invalid('segment');
				const Source = ParseText(await FetchText(Segment.url),Format);
				Parsed.extras.push(...Source.extras);
				for (const Cue of Source.cues)
				{
					Cue.start += Segment.offset || 0; Cue.end += Segment.offset || 0;
					// Presentation offsets may move preroll before the output's zero.
					if (Cue.end <= 0) continue;
					Cue.start = Math.max(0,Cue.start);
					const Key = JSON.stringify([Cue.start,Cue.end,Cue.settings,Cue.text]);
					if (!Seen.has(Key)) { Seen.add(Key); Parsed.cues.push(Cue); }
					if (Parsed.cues.length > SubtitleLimits.cues) Limit('cues');
				}
			}
			Parsed.cues.sort((A,B)=>A.start-B.start || A.end-B.end);
		}
		else
		{
			const Text = Descriptor.text !== undefined ? Count(Descriptor.text) : await FetchText(Descriptor.url);
			Parsed = Text.trimStart().startsWith('#EXTM3U') ? await ReadHls(Text,Descriptor.url) : ParseText(Text,Format);
		}
		Signal.throwIfAborted();
		const Content = Serialize(Parsed); CheckSize(Content);
		return {language:Descriptor.language || 'und',label:Descriptor.label || Descriptor.language || 'Subtitles',content:Content,...(Parsed.timeBase ? {timeBase:Parsed.timeBase} : {}),...(RecordingClock ? {recordingClock:RecordingClock} : {})};
	}
	const Results = new Array(Descriptors.length);
	let Next = 0, Completed = 0, Failed = 0, Progress = Promise.resolve();
	const Workers = Array.from({length:Math.min(SubtitleLimits.concurrency,Descriptors.length)},async()=>
	{
		for (;;)
		{
			Signal.throwIfAborted();
			const Index = Next++;
			if (Index >= Descriptors.length) return;
			const Descriptor = Descriptors[Index];
			try { Results[Index] = await Read(Descriptor); }
			catch (ErrorValue)
			{
				Signal.throwIfAborted();
				if (typeof onError !== 'function') throw ErrorValue;
				const Receipt = {failed: ++Failed, total: Descriptors.length};
				Progress = Progress.then(() => onError(Receipt));
				await Progress;
				continue;
			}
			const Update = {completed: ++Completed, total: Descriptors.length};
			if (onProgress)
			{
				Progress = Progress.then(() => onProgress(Update));
				await Progress;
			}
		}
	});
	try { await Promise.all(Workers); }
	catch (ErrorValue) { Controller.abort(); await Promise.allSettled(Workers); throw ErrorValue; }
	return Results.filter(Boolean);
}
