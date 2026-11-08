import {
  ADTS, ALL_FORMATS, BlobSource, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource,
  FLAC, Input, IsobmffInputFormat, MatroskaInputFormat, MP3, Mp4OutputFormat, Output,
  WAVE,
} from '../vendor/mediabunny-1.65.2.mjs';
import {TimedTextTarget} from './mp4-timed-text.js';

// ISO 639-1 -> ISO 639-2/T. MP4 mdhd has a three-letter language field; this
// Mediabunny version cannot write elng. Keep the original BCP47 tag in the name.
const languageCodes = new Map(`aa aar ab abk ae ave af afr ak aka am amh an arg ar ara as asm av ava ay aym az aze ba bak be bel bg bul bh bih bi bis bm bam bn ben bo bod br bre bs bos ca cat ce che ch cha co cos cr cre cs ces cu chu cv chv cy cym da dan de deu dv div dz dzo ee ewe el ell en eng eo epo es spa et est eu eus fa fas ff ful fi fin fj fij fo fao fr fra fy fry ga gle gd gla gl glg gn grn gu guj gv glv ha hau he heb hi hin ho hmo hr hrv ht hat hu hun hy hye hz her ia ina id ind ie ile ig ibo ii iii ik ipk io ido is isl it ita iu iku ja jpn jv jav ka kat kg kon ki kik kj kua kk kaz kl kal km khm kn kan ko kor kr kau ks kas ku kur kv kom kw cor ky kir la lat lb ltz lg lug li lim ln lin lo lao lt lit lu lub lv lav mg mlg mh mah mi mri mk mkd ml mal mn mon mr mar ms msa mt mlt my mya na nau nb nob nd nde ne nep ng ndo nl nld nn nno no nor nr nbl nv nav ny nya oc oci oj oji om orm or ori os oss pa pan pi pli pl pol ps pus pt por qu que rm roh rn run ro ron ru rus rw kin sa san sc srd sd snd se sme sg sag si sin sk slk sl slv sm smo sn sna so som sq sqi sr srp ss ssw st sot su sun sv swe sw swa ta tam te tel tg tgk th tha ti tir tk tuk tl tgl tn tsn to ton tr tur ts tso tt tat tw twi ty tah ug uig uk ukr ur urd uz uzb ve ven vi vie vo vol wa wln wo wol xh xho yi yid yo yor za zha zh zho zu zul`.split(' ').reduce((pairs, value, i, all) => i % 2 ? pairs : [...pairs, [value, all[i + 1]]], []));
const aliases = { iw: 'heb', in: 'ind', ji: 'yid', chi: 'zho', cze: 'ces', dut: 'nld', fre: 'fra', ger: 'deu', gre: 'ell', rum: 'ron', slo: 'slk', wel: 'cym', baq: 'eus', per: 'fas', arm: 'hye', geo: 'kat', ice: 'isl', mac: 'mkd', mao: 'mri', may: 'msa', bur: 'mya', tib: 'bod' };
const encoder = new TextDecoder();

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Subtitle embedding canceled', 'AbortError');
}

async function boxHeader(blob, position, end, signal) {
  checkAbort(signal);
  const bytes = new DataView(await blob.slice(position, Math.min(position + 16, end)).arrayBuffer());
  if (bytes.byteLength < 8) throw new Error('Incomplete MP4 box header');
  let size = bytes.getUint32(0), header = 8;
  if (size === 1) { if (bytes.byteLength < 16) throw new Error('Incomplete MP4 extended box'); size = Number(bytes.getBigUint64(8)); header = 16; }
  if (size === 0) size = end - position;
  if (!Number.isSafeInteger(size) || size < header || position + size > end) throw new Error('Invalid MP4 box bounds');
  return { type: String.fromCharCode(...new Uint8Array(bytes.buffer, 4, 4)), start: position + header, end: position + size };
}

// Input.getTracks() in 1.65.2 returns only AV. Inspect handlers before remuxing
// so an existing subtitle/other unsupported track can never disappear silently.
async function assertPreservableMp4(blob, signal) {
  let avCount = 0, sawMoov = false;
  async function visit(start, end, level) {
    for (let p = start; p < end;) {
      const box = await boxHeader(blob, p, end, signal);
      if (box.type === 'moov' && level === 0) { sawMoov = true; await visit(box.start, box.end, 1); }
      else if ((box.type === 'trak' && level === 1) || (box.type === 'mdia' && level === 2)) await visit(box.start, box.end, level + 1);
      else if (box.type === 'hdlr' && level === 3) {
        const bytes = new Uint8Array(await blob.slice(box.start + 8, box.start + 12).arrayBuffer());
        const handler = encoder.decode(bytes);
        if (handler !== 'vide' && handler !== 'soun') throw new Error(`Cannot preserve existing embedded ${handler} track: Mediabunny 1.65.2 reads only video/audio tracks. Subtitle embedding stopped to prevent track loss.`);
        avCount++;
      }
      p = box.end;
    }
  }
  await visit(0, blob.size, 0);
  if (!sawMoov || !avCount) throw new Error('Subtitle embedding requires an MP4 containing video or audio');
  return avCount;
}

async function ebmlHeader(blob, position, end, signal) {
  checkAbort(signal);
  const bytes = new Uint8Array(await blob.slice(position, Math.min(position + 16, end)).arrayBuffer());
  function length(first, limit) {
    for (let count = 1; count <= limit; count++) if (first & (1 << (8 - count))) return count;
    throw new Error('Invalid Matroska element header');
  }
  const idLength = length(bytes[0], 4), sizeLength = length(bytes[idLength], 8);
  if (idLength + sizeLength > bytes.length) throw new Error('Incomplete Matroska element header');
  let id = 0, size = BigInt(bytes[idLength] & ((1 << (8 - sizeLength)) - 1));
  for (let n = 0; n < idLength; n++) id = id * 256 + bytes[n];
  for (let n = 1; n < sizeLength; n++) size = size * 256n + BigInt(bytes[idLength + n]);
  const unknown = size === (1n << BigInt(7 * sizeLength)) - 1n;
  const start = position + idLength + sizeLength, stop = unknown ? end : start + Number(size);
  if (!Number.isSafeInteger(stop) || stop < start || stop > end) throw new Error('Invalid Matroska element bounds');
  return { id, start, end: stop, unknown };
}

// Matroska/WebM demux also hides subtitle tracks. Read only EBML headers and
// TrackType scalars, skipping media payloads; an unknown-sized media cluster
// before the track table is an explicit unsupported preservation case.
async function assertPreservableMatroska(blob, signal) {
  async function readTracks(element) {
    let count = 0;
    for (let p = element.start; p < element.end;) {
      const entry = await ebmlHeader(blob, p, element.end, signal);
      if (entry.unknown) throw new Error('Cannot preserve unknown-sized Matroska track entries');
      if (entry.id === 0xae) {
        let type;
        for (let q = entry.start; q < entry.end;) {
          const field = await ebmlHeader(blob, q, entry.end, signal);
          if (field.unknown) throw new Error('Cannot preserve unknown-sized Matroska track fields');
          if (field.id === 0x83) {
            if (field.end - field.start < 1 || field.end - field.start > 8) throw new Error('Invalid Matroska TrackType');
            const bytes = new Uint8Array(await blob.slice(field.start, field.end).arrayBuffer());
            type = bytes.reduce((value, byte) => value * 256 + byte, 0);
          }
          q = field.end;
        }
        if (type !== 1 && type !== 2) throw new Error(`Cannot preserve existing embedded Matroska track type ${type}: only video/audio input tracks are supported by Mediabunny 1.65.2`);
        count++;
      }
      p = entry.end;
    }
    if (!count) throw new Error('Cannot find Matroska audio/video tracks');
    return count;
  }
  for (let p = 0; p < blob.size;) {
    const top = await ebmlHeader(blob, p, blob.size, signal);
    if (top.id === 0x18538067) {
      for (let q = top.start; q < top.end;) {
        const element = await ebmlHeader(blob, q, top.end, signal);
        if (element.id === 0x1654ae6b) return readTracks(element);
        if (element.unknown) throw new Error('Cannot preserve Matroska tracks behind an unknown-sized element');
        q = element.end;
      }
    }
    if (top.unknown) break;
    p = top.end;
  }
  throw new Error('Cannot find Matroska track table for subtitle preservation');
}

function timestamp(text) {
  const parts = text.split(':').map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}
function timeText(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

function prepareSubtitle(track, duration) {
  if (!track || typeof track.content !== 'string') throw new TypeError('Subtitle content must be WebVTT text');
  const content = track.content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t][^\n]*)?\n/.test(content)) throw new Error('Subtitle has an invalid WebVTT header');
  const offset = track.offset ?? 0;
  if (!Number.isFinite(offset)) throw new TypeError('Subtitle offset must be a finite number');
  const blocks = content.trimEnd().split(/\n{2,}/), preamble = [blocks.shift()], cues = [];
  let rawCueCount = 0;
  for (const block of blocks) {
    if (/^(?:NOTE(?:[ \t\n]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) { preamble.push(block); continue; }
    if (!block.trim()) continue;
    const lines = block.split('\n'), index = lines[0].includes('-->') ? 0 : 1;
    const match = /^(\d{2,}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})[ \t]+-->[ \t]+(\d{2,}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})(.*)$/.exec(lines[index] ?? '');
    if (!match) throw new Error('Subtitle contains an invalid WebVTT cue');
    const rawStart = timestamp(match[1]), rawEnd = timestamp(match[2]);
    if (rawEnd <= rawStart) throw new Error('Subtitle cue ends before it starts');
    rawCueCount++;
    const start = Math.max(0, rawStart + offset), end = Math.min(duration, rawEnd + offset);
    if (end <= start) continue;
    lines[index] = `${timeText(start)} --> ${timeText(end)}${match[3]}`;
    cues.push({ timestamp: start, end, payload: lines.slice(index + 1).join('\n'), text: lines.join('\n') + '\n\n' });
  }
  if (!cues.length && track.allowEmptyAfterClip === true && rawCueCount > 0) {
    // An empty payload retains the selectable language track in early partial
    // exports. No out-of-range text is pulled into the partial file.
    cues.push({ timestamp: 0, end: duration, payload: '', text: `00:00:00.000 --> ${timeText(duration)}\n\n\n` });
  }
  if (!cues.length) throw new Error(`Subtitle ${track.label || track.language || ''} has no cues overlapping the media timeline`);
  cues.sort((a, b) => a.timestamp - b.timestamp);
  const language = String(track.language || 'und').trim(), base = language.toLowerCase().split(/[-_]/)[0];
  const languageCode = languageCodes.get(base) || aliases[base] || (/^[a-z]{3}$/.test(base) ? base : 'und');
  const label = String(track.label || language || 'Subtitles');
  const name = language.includes('-') || language.includes('_') || languageCode === 'und' && language !== 'und' ? `${label} [${language}]` : label;
  return { cues, preamble: preamble.join('\n\n') + '\n\n', languageCode, name };
}

/** Copy compatible input AV encoded data into MP4 with tx3g/mov_text tracks.
 * Cross-container timestamps are quantized to the MP4 track timescales.
 * Destination accepts a seekable FileSystemWritableFileStream (write commands
 * with position) or a Mediabunny BufferTarget. Resolves only after finalization.
 * Existing embedded non-AV tracks are explicitly rejected, never discarded.
 */
export async function MuxSubtitles(MediaFile, Tracks, Destination, Signal) {
  checkAbort(Signal);
  if (!(MediaFile instanceof Blob)) throw new TypeError('Subtitle media must be a Blob');
  if (!Array.isArray(Tracks) || !Tracks.length) throw new TypeError('At least one subtitle track is required');
  const input = new Input({ source: new BlobSource(MediaFile, { maxCacheSize: 8 * 1024 * 1024, useStreamReader: false }), formats: ALL_FORMATS });
  let output, timedText;
  const cancel = () => { input.dispose(); if (output && output.state !== 'finalized') output.cancel().catch(() => {}); };
  Signal?.addEventListener('abort', cancel, { once: true });
  try {
    checkAbort(Signal);
    const inputFormat = await input.getFormat();
    let avCount;
    if (inputFormat instanceof IsobmffInputFormat) avCount = await assertPreservableMp4(MediaFile, Signal);
    else if (inputFormat instanceof MatroskaInputFormat) avCount = await assertPreservableMatroska(MediaFile, Signal);
    else if (![MP3, ADTS, FLAC, WAVE].includes(inputFormat)) throw new Error(`Cannot inspect ${inputFormat.name} embedded tracks for preservation; subtitle embedding stopped`);
    const inputTracks = await input.getTracks();
    if (!inputTracks.length || avCount !== undefined && inputTracks.length !== avCount) throw new Error('Cannot preserve every source media track; subtitle embedding stopped');
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Cannot determine subtitle media duration');
    const subtitles = Tracks.map(track => prepareSubtitle(track, duration));
    timedText = TimedTextTarget(Destination, subtitles, Signal);
    const format = new Mp4OutputFormat({ fastStart: false, onMoov: timedText.onMoov });
    output = new Output({ format, target: timedText.target });
    output.setMetadataTags(await input.getMetadataTags());
    const av = [];
    for (const track of inputTracks) {
      checkAbort(Signal);
      const codec = await track.getCodec();
      if (!codec || !format.getSupportedCodecs().includes(codec)) throw new Error(`Cannot preserve source ${track.type} codec ${codec || await track.getInternalCodecId()}`);
      const source = track.isVideoTrack() ? new EncodedVideoPacketSource(codec) : new EncodedAudioPacketSource(codec);
      const config = await track.getDecoderConfig();
      const metadata = { decoderConfig: config, languageCode: await track.getLanguageCode(), name: await track.getName() ?? '', disposition: await track.getDisposition() };
      if (track.isVideoTrack()) { metadata.transformationMatrix = await track.getTransformationMatrix(); output.addVideoTrack(source, metadata); }
      else output.addAudioTrack(source, metadata);
      av.push({ track, source });
    }
    checkAbort(Signal);
    await output.start();
    // Caption samples are appended when the AV target finalizes. Gaps in the
    // subtitle timeline cannot stall AV packet interleaving or retain the video.
    // One lookahead packet per AV track. Independent producers can run an
    // entire fast audio track ahead of slow video even when each add is awaited.
    const readers = av.map(item => ({ ...item, sink: new EncodedPacketSink(item.track), packet: null }));
    await Promise.all(readers.map(async reader => { reader.packet = await reader.sink.getFirstPacket(); if (!reader.packet) reader.source.close(); }));
    for (;;) {
      checkAbort(Signal);
      const reader = readers.filter(item => item.packet).sort((a, b) => a.packet.timestamp - b.packet.timestamp)[0];
      if (!reader) break;
      const packet = reader.packet;
      await reader.source.add(packet);
      reader.packet = await reader.sink.getNextPacket(packet);
      if (!reader.packet) reader.source.close();
    }
    checkAbort(Signal);
    await output.finalize();
    checkAbort(Signal);
    return { videoTracks: inputTracks.filter(t => t.isVideoTrack()).length, audioTracks: inputTracks.filter(t => t.isAudioTrack()).length, subtitleTracks: subtitles.length };
  } catch (error) {
    input.dispose();
    if (output && output.state !== 'finalized') await output.cancel().catch(() => {});
    await timedText?.abort(error);
    checkAbort(Signal);
    throw error;
  } finally {
    Signal?.removeEventListener('abort', cancel);
    input.dispose();
  }
}
