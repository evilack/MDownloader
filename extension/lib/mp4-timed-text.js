import {BufferTarget, StreamTarget} from '../vendor/mediabunny-1.65.2.mjs';

// MP4 tx3g (3GPP timed text). WebVTT remains our acquisition format; desktop
// demuxers commonly need tx3g/mov_text for selectable MP4 subtitles. Only small
// subtitle payloads and the final moov are buffered; encoded AV writes pass through.
const Encoder = new TextEncoder();
const MaxMetadata = 64 * 1024 * 1024;
const Abort = Signal => {if (Signal?.aborted) throw Signal.reason ?? new DOMException('Canceled', 'AbortError');};
function JoinList(Parts)
{
	const Length = Parts.reduce((Sum, Part) => Sum + Part.length, 0);
	if (Length > MaxMetadata) throw new Error('Subtitle MP4 metadata limit exceeded');
	const Bytes = new Uint8Array(Length);
	let Position = 0;
	for (const Part of Parts) {Bytes.set(Part, Position); Position += Part.length;}
	return Bytes;
}
const Join = (...Parts) => JoinList(Parts);
const Text = Value => Encoder.encode(Value);
function NumberBytes(Value, Size = 4)
{
	if (!Number.isSafeInteger(Value) || Value < 0 || Size < 8 && Value >= 2 ** (Size * 8)) throw new Error('Subtitle MP4 integer out of range');
	const Bytes = new Uint8Array(Size), View = new DataView(Bytes.buffer);
	if (Size === 8) View.setBigUint64(0, BigInt(Value));
	else if (Size === 4) View.setUint32(0, Value);
	else View.setUint16(0, Value);
	return Bytes;
}
const Box = (Type, ...Parts) => {const Body = Join(...Parts); return Join(NumberBytes(Body.length + 8), Text(Type), Body);};
const Full = (Type, ...Parts) => Box(Type, new Uint8Array(4), ...Parts);
function Children(Bytes, Start = 8, End = Bytes.length)
{
	const Result = [], View = new DataView(Bytes.buffer, Bytes.byteOffset, Bytes.byteLength);
	for (let Position = Start; Position < End;)
	{
		if (Position + 8 > End) throw new Error('Incomplete MP4 metadata');
		const Size = View.getUint32(Position);
		if (Size < 8 || Position + Size > End) throw new Error('Invalid MP4 metadata bounds');
		Result.push({type: String.fromCharCode(...Bytes.subarray(Position + 4, Position + 8)), start: Position, end: Position + Size});
		Position += Size;
	}
	return Result;
}
function PlainText(Value)
{
	const Entities = {amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f', quot: '"', apos: "'"};
	return Value.replace(/<\/?(?:b|i|u|c|v|lang|ruby|rt)(?:[.\s][^>]*)?>|<(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}>/g, '')
		.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|nbsp|lrm|rlm|quot|apos);/gi, (Match, Key) =>
		{
			if (Key[0] !== '#') return Entities[Key.toLowerCase()];
			const Code = Key[1].toLowerCase() === 'x' ? parseInt(Key.slice(2), 16) : Number(Key.slice(1));
			return Code > 0 && Code <= 0x10ffff && !(Code >= 0xd800 && Code <= 0xdfff) ? String.fromCodePoint(Code) : '\ufffd';
		});
}
function Samples(Subtitle, Budget)
{
	const Events = new Map([[0, {start: [], end: []}]]);
	const Event = Time => {if (!Events.has(Time)) Events.set(Time, {start: [], end: []}); return Events.get(Time);};
	Subtitle.cues.forEach((Cue, Index) =>
	{
		const Start = Math.round(Cue.timestamp * 1000), End = Math.round(Cue.end * 1000);
		if (End <= Start) return;
		const Payload = PlainText(Cue.payload);
		Event(Start).start.push([Index, {text: Payload, bytes: Text(Payload).length}]);
		Event(End).end.push(Index);
	});
	const Boundaries = [...Events.keys()].sort((A, B) => A - B), Active = new Map(), Result = [];
	let ActiveBytes = 0;
	for (let Index = 0; Index + 1 < Boundaries.length; Index++)
	{
		const Start = Boundaries[Index], Changes = Events.get(Start);
		for (const Key of Changes.end) {ActiveBytes -= Active.get(Key)?.bytes ?? 0; Active.delete(Key);}
		for (const [Key, Value] of Changes.start) {Active.set(Key, Value); ActiveBytes += Value.bytes;}
		const Length = ActiveBytes + Math.max(0, Active.size - 1);
		if (Length > 65535) throw new Error('MP4 timed text sample exceeds 65535 UTF-8 bytes');
		Budget.bytes += Length + 2;
		if (Budget.bytes > MaxMetadata || ++Budget.samples > 200000) throw new Error('Subtitle MP4 data limit exceeded');
		const Payload = Text([...Active.entries()].sort((A, B) => A[0] - B[0]).map(Item => Item[1].text).join('\n'));
		Result.push({duration: Boundaries[Index + 1] - Start, bytes: Join(NumberBytes(Payload.length, 2), Payload)});
	}
	if (!Result.length) throw new Error('Subtitle has no representable timed text samples');
	return Result;
}
const Matrix = Join(NumberBytes(65536), new Uint8Array(12), NumberBytes(65536), new Uint8Array(12), NumberBytes(0x40000000));
function Track(Subtitle, SampleList, Id, Offset, MovieScale, First)
{
	const Duration = SampleList.reduce((Sum, Sample) => Sum + Sample.duration, 0);
	const Tkhd = Box('tkhd', new Uint8Array([1, 0, 0, First ? 3 : 2]), new Uint8Array(16), NumberBytes(Id),
		new Uint8Array(4), NumberBytes(Math.ceil(Duration * MovieScale / 1000), 8), new Uint8Array(10), NumberBytes(1, 2),
		new Uint8Array(4), Matrix, new Uint8Array(8));
	const Language = Subtitle.languageCode.split('').reduce((Value, Char) => (Value << 5) | (Char.charCodeAt(0) - 96), 0);
	const Mdhd = Full('mdhd', new Uint8Array(8), NumberBytes(1000), NumberBytes(Duration), NumberBytes(Language, 2), new Uint8Array(2));
	const Hdlr = Full('hdlr', new Uint8Array(4), Text('sbtl'), new Uint8Array(12), Text(Subtitle.name + '\0'));
	// Default tx3g sample description: centered, bottom aligned, white 18px text.
	// Field layout: 3GPP TS 26.245; independently decoded by FFmpeg mov_text.
	const Style = new Uint8Array(30); Style[4] = 1; Style[5] = 255; Style[23] = 1; Style[25] = 18; Style.fill(255, 26);
	const Entry = Box('tx3g', new Uint8Array(6), NumberBytes(1, 2), Style,
		Box('ftab', NumberBytes(1, 2), NumberBytes(1, 2), new Uint8Array([5]), Text('Arial')));
	const Runs = [];
	for (const Sample of SampleList)
	{
		const Last = Runs.at(-1);
		if (Last?.duration === Sample.duration) Last.count++;
		else Runs.push({count: 1, duration: Sample.duration});
	}
	const Stbl = Box('stbl', Full('stsd', NumberBytes(1), Entry),
		Full('stts', NumberBytes(Runs.length), JoinList(Runs.map(Run => Join(NumberBytes(Run.count), NumberBytes(Run.duration))))),
		Full('stsc', NumberBytes(1), NumberBytes(1), NumberBytes(SampleList.length), NumberBytes(1)),
		Full('stsz', NumberBytes(0), NumberBytes(SampleList.length), JoinList(SampleList.map(Sample => NumberBytes(Sample.bytes.length)))),
		Full('co64', NumberBytes(1), NumberBytes(Offset, 8)));
	const Minf = Box('minf', Full('nmhd'), Box('dinf', Full('dref', NumberBytes(1), Box('url ', new Uint8Array([0, 0, 0, 1])))), Stbl);
	return Box('trak', Tkhd, Box('mdia', Mdhd, Hdlr, Minf), Box('udta', Box('name', Text(Subtitle.name))));
}

/** Wrap an AV-only, non-fragmented MP4 stream; append tx3g data and rebuild its
 * final moov while keeping all AV offsets intact. onMoov is a public Mediabunny
 * data callback. No vendor internals, full-video buffer, or second media copy. */
export function TimedTextTarget(Destination, Subtitles, Signal)
{
	// Overlaps can expand a small caption source into many large samples. Share
	// the budget across languages and reject before locking or transferring AV.
	const Budget = {bytes: 0, samples: 0};
	const Lists = Subtitles.map(Subtitle => Samples(Subtitle, Budget));
	let Buffer = new Uint8Array();
	const Stream = Destination instanceof WritableStream ? Destination : Destination instanceof BufferTarget ? new WritableStream({
		write(Part) {const Next = new Uint8Array(Math.max(Buffer.length, Part.position + Part.data.length)); Next.set(Buffer); Next.set(Part.data, Part.position); Buffer = Next;},
		close() {Destination.buffer = Buffer.buffer;},
	}) : null;
	if (!Stream) throw new TypeError('Subtitle destination must be a WritableStream or BufferTarget');
	let Writer, Released = false;
	const GetWriter = () => Writer ??= Stream.getWriter();
	const Release = () => {if (Writer && !Released) {Released = true; Writer.releaseLock();}};
	let Moov, MoovPosition, End = 0, Finished = false;
	async function Cancel(Reason)
	{
		if (Finished) return;
		Finished = true;
		try {if (Writer) await Writer.abort(Reason).catch(() => {});}
		finally {Release();}
	}
	async function Write(Position, Bytes)
	{
		Abort(Signal);
		await GetWriter().write({type: 'write', position: Position, data: Bytes});
		End = Math.max(End, Position + Bytes.length);
		Abort(Signal);
	}
	async function Finish()
	{
		try
		{
			Abort(Signal);
			if (!Moov || !Number.isSafeInteger(MoovPosition)) throw new Error('Subtitle output has no final MP4 movie metadata');
			const Items = Children(Moov), Mvhd = Items.find(Item => Item.type === 'mvhd');
			if (!Mvhd || Items.some(Item => Item.type === 'mvex')) throw new Error('Subtitle output requires non-fragmented MP4');
			const View = new DataView(Moov.buffer, Moov.byteOffset, Moov.byteLength);
			const MovieScale = View.getUint32(Mvhd.start + (Moov[Mvhd.start + 8] === 1 ? 28 : 20));
			let NextId = 1;
			for (const Item of Items.filter(Item => Item.type === 'trak'))
			{
				const Header = Children(Moov, Item.start + 8, Item.end).find(Child => Child.type === 'tkhd');
				if (!Header) throw new Error('Missing MP4 track identity');
				NextId = Math.max(NextId, View.getUint32(Header.start + (Moov[Header.start + 8] === 1 ? 28 : 20)) + 1);
			}
			View.setUint32(Mvhd.end - 4, NextId + Subtitles.length);
			const PayloadSize = Lists.reduce((Sum, List) => Sum + List.reduce((Size, Sample) => Size + Sample.bytes.length, 0), 0);
			if (PayloadSize > MaxMetadata) throw new Error('Subtitle MP4 data limit exceeded');
			const DataPosition = End;
			let Offset = DataPosition + 8;
			const Tracks = Lists.map((List, Index) =>
			{
				const Result = Track(Subtitles[Index], List, NextId + Index, Offset, MovieScale, Index === 0);
				Offset += List.reduce((Sum, Sample) => Sum + Sample.bytes.length, 0);
				return Result;
			});
			const Movie = Box('moov', ...Items.map(Item => Moov.subarray(Item.start, Item.end)), ...Tracks);
			await Write(MoovPosition + 4, Text('free')); // Retain original byte offsets; exactly one active moov.
			await Write(DataPosition, Join(NumberBytes(PayloadSize + 8), Text('mdat')));
			let Position = DataPosition + 8;
			for (const List of Lists)
			{
				const Bytes = JoinList(List.map(Sample => Sample.bytes));
				await Write(Position, Bytes); Position += Bytes.length;
			}
			await Write(Position, Movie);
			await GetWriter().close(); Finished = true;
		}
		catch (ErrorValue) {await Cancel(ErrorValue); throw ErrorValue;}
		finally {Release();}
	}
	const Target = new StreamTarget(new WritableStream({write: Part => Write(Part.position, Part.data), close: Finish,
		abort: Cancel}), {chunked: true, chunkSize: 1024 * 1024});
	return {target: Target, abort: Cancel, onMoov(Bytes, Position)
	{
		if (Bytes.byteLength > MaxMetadata) throw new Error('Subtitle MP4 metadata limit exceeded');
		Moov = Bytes.slice(); MoovPosition = Position;
	}};
}
