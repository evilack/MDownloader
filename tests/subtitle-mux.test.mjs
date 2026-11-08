import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as MB from '../extension/vendor/mediabunny-1.65.2.mjs';

const module = await import('../extension/lib/subtitle-mux.js').catch(() => ({}));
const sample = new Blob([await readFile(new URL('../website/sample/media/sample-film.mp4', import.meta.url))]);
const languages = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'es', 'fr', 'de', 'it', 'pt-BR', 'ru', 'ar', 'hi', 'id', 'vi-VN', 'th', 'tr', 'pl', 'nl', 'sv', 'cs', 'el', 'uk'];
const codes = ['eng', 'kor', 'jpn', 'zho', 'zho', 'spa', 'fra', 'deu', 'ita', 'por', 'rus', 'ara', 'hin', 'ind', 'vie', 'tha', 'tur', 'pol', 'nld', 'swe', 'ces', 'ell', 'ukr'];
const captions = languages.map((language, n) => ({ language, label: `Caption ${n}`, content: `WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nLanguage ${language} 日本語 한국어\n\n` }));

function boxes(bytes, start = 0, end = bytes.length) {
  const out = [];
  for (let offset = start; offset < end;) {
    assert.ok(offset + 8 <= end, 'complete ISO box header');
    let size = bytes.readUInt32BE(offset), header = 8;
    if (size === 1) { size = Number(bytes.readBigUInt64BE(offset + 8)); header = 16; }
    if (size === 0) size = end - offset;
    assert.ok(size >= header && offset + size <= end, 'valid ISO box extent');
    out.push({ type: bytes.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + size });
    offset += size;
  }
  return out;
}
function child(bytes, box, type) { return boxes(bytes, box.start, box.end).find(b => b.type === type); }
function inspect(bytes) {
  const moov = boxes(bytes).find(b => b.type === 'moov');
  return boxes(bytes, moov.start, moov.end).filter(b => b.type === 'trak').map(trak => {
    const mdia = child(bytes, trak, 'mdia'), mdhd = child(bytes, mdia, 'mdhd'), hdlr = child(bytes, mdia, 'hdlr');
    const stbl = child(bytes, child(bytes, mdia, 'minf'), 'stbl'), stsd = child(bytes, stbl, 'stsd');
    const version = bytes[mdhd.start], langPos = mdhd.start + (version === 1 ? 32 : 20), packed = bytes.readUInt16BE(langPos);
    const udta = child(bytes, trak, 'udta'), name = udta && child(bytes, udta, 'name');
    return {
      type: bytes.toString('ascii', hdlr.start + 8, hdlr.start + 12),
      language: [10, 5, 0].map(shift => String.fromCharCode(96 + ((packed >> shift) & 31))).join(''),
      name: name ? bytes.toString('utf8', name.start, name.end) : '',
      codec: bytes.toString('ascii', stsd.start + 12, stsd.start + 16),
      duration: version === 1 ? Number(bytes.readBigUInt64BE(mdhd.start + 24)) / bytes.readUInt32BE(mdhd.start + 20) : bytes.readUInt32BE(mdhd.start + 16) / bytes.readUInt32BE(mdhd.start + 12),
    };
  });
}
async function mux(file = sample, tracks = captions, signal) {
  assert.equal(typeof module.MuxSubtitles, 'function', 'MuxSubtitles export exists');
  const writes = []; let closed = false;
  await module.MuxSubtitles(file, tracks, new WritableStream({ write(part) { writes.push({ position: part.position, data: Buffer.from(part.data) }); }, close() { closed = true; } }), signal);
  assert.equal(closed, true, 'destination finalized');
  const buffer = Buffer.alloc(Math.max(0, ...writes.map(p => p.position + p.data.length)));
  for (const part of writes) part.data.copy(buffer, part.position);
  return buffer;
}
async function packetSummary(file) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  try {
    const result = [];
    for (const track of await input.getTracks()) {
      const packets = [];
      for await (const packet of new MB.EncodedPacketSink(track).packets()) packets.push({ data: Buffer.from(packet.data).toString('base64'), timestamp: packet.timestamp, duration: packet.duration, type: packet.type });
      result.push({ type: track.type, codec: await track.getCodec(), packets });
    }
    return result;
  } finally { input.dispose(); }
}

test('embeds every language as MP4 timed text recognized by desktop subtitle demuxers without changing AV', async () => {
  const result = await mux();
  const tracks = inspect(result), subs = tracks.filter(t => t.type === 'sbtl');
  assert.equal(subs.length, 23);
  assert.deepEqual(subs.map(t => t.language), codes);
  subs.forEach((track, n) => { assert.equal(track.codec, 'tx3g'); assert.ok(track.name.includes(`Caption ${n}`)); assert.ok(result.includes(Buffer.from(`Language ${languages[n]} 日本語 한국어`))); });
  assert.ok(subs[14].name.includes('vi-VN'), 'regional language identifier retained');
  assert.deepEqual(await packetSummary(new Blob([result])), await packetSummary(sample));
});
test('empty WebVTT clearing cues do not prevent timed text mux or alter AV',async()=>{
 const result=await mux(sample,[{language:'ko',content:'WEBVTT\n\n00:00:00.100 --> 00:00:00.200 align:start\n\n00:00:00.200 --> 00:00:01.000\nActual caption\n'}]);
 assert.equal(inspect(result).filter(t=>t.codec==='tx3g').length,1);assert.ok(result.includes(Buffer.from('Actual caption')));assert.deepEqual(await packetSummary(new Blob([result])),await packetSummary(sample));
});
test('space-only ASR payload lines retain following caption text when muxing',async()=>{
 const result=await mux(sample,[{language:'ko',content:'WEBVTT\n\n00:00:00.100 --> 00:00:01.000\n \nActual caption\n'}]);
 assert.ok(result.includes(Buffer.from('Actual caption')));assert.deepEqual(await packetSummary(new Blob([result])),await packetSummary(sample));
});

test('offsets and clips cues to media timeline without extending media duration', async () => {
  const result = await mux(sample, [{ language: 'en', label: 'Mapped', offset: -10, content: 'WEBVTT\n\n00:00:09.000 --> 00:00:11.000\nClipped start\n\n00:00:00.000 --> 00:00:01.000\nBefore media\n\n00:00:11.000 --> 01:00:00.000\nClipped end\n\n' }]);
  assert.ok(result.includes(Buffer.from('Clipped start')));
  assert.equal(result.includes(Buffer.from('Before media')), false);
  const originalDuration = Math.max(...inspect(Buffer.from(await sample.arrayBuffer())).map(t => t.duration));
  assert.ok(inspect(result).every(t => t.duration <= originalDuration + 0.002));
});

test('does not silently discard existing embedded subtitles', async () => {
  const result = await mux(sample, captions.slice(0, 1));
  await assert.rejects(() => mux(new Blob([result]), captions.slice(1, 2)), /existing|embedded|subtitle|preserv/i);
});

test('uses bounded Blob slices instead of materializing the entire media', async () => {
  class SliceOnlyBlob extends Blob { arrayBuffer() { throw new Error('Full media buffering forbidden'); } }
  await mux(new SliceOnlyBlob([sample]), captions.slice(0, 1));
});

test('preserves secondary audio and video tracks and their names and languages', async () => {
  const input = new MB.Input({ source: new MB.BlobSource(sample), formats: MB.ALL_FORMATS });
  const target = new MB.BufferTarget(), output = new MB.Output({ format: new MB.Mp4OutputFormat(), target });
  try {
    const sources = [];
    for (const track of await input.getTracks()) for (let n = 0; n < 2; n++) {
      const source = track.isVideoTrack() ? new MB.EncodedVideoPacketSource(await track.getCodec()) : new MB.EncodedAudioPacketSource(await track.getCodec());
      const metadata = { decoderConfig: await track.getDecoderConfig(), name: `${track.type} ${n}`, languageCode: n === 0 ? 'eng' : 'kor' };
      if (track.isVideoTrack()) output.addVideoTrack(source, metadata); else output.addAudioTrack(source, metadata);
      sources.push({ source, track });
    }
    await output.start();
    await Promise.all(sources.map(async ({ source, track }) => { for await (const packet of new MB.EncodedPacketSink(track).packets()) await source.add(packet); source.close(); }));
    await output.finalize();
    const sourceFile = new Blob([target.buffer]), result = await mux(sourceFile, captions.slice(0, 1));
    assert.deepEqual(inspect(result).slice(0, 4).map(t => [t.name, t.language]), [['video 0', 'eng'], ['video 1', 'kor'], ['audio 0', 'eng'], ['audio 1', 'kor']]);
    assert.deepEqual(await packetSummary(new Blob([result])), await packetSummary(sourceFile));
  } finally { input.dispose(); }
});

test('pre-abort does not start the destination and invalid VTT fails visibly', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => mux(sample, captions, controller.signal), { name: 'AbortError' });
  await assert.rejects(() => mux(sample, [{ language: 'en', content: 'not a valid subtitle' }]), /WebVTT|subtitle/i);
});

test('keeps packet read-ahead bounded when an AV track reads slowly', async () => {
  const originalNext = MB.EncodedPacketSink.prototype.getNextPacket;
  const originalAudioAdd = MB.EncodedAudioPacketSource.prototype.add;
  const originalVideoAdd = MB.EncodedVideoPacketSource.prototype.add;
  let videoTime = 0, maximumAudioLead = 0;
  MB.EncodedPacketSink.prototype.getNextPacket = async function (...args) {
    if (this._track.isVideoTrack()) await new Promise(resolve => setTimeout(resolve, 1));
    return originalNext.apply(this, args);
  };
  MB.EncodedVideoPacketSource.prototype.add = function (packet, ...args) { videoTime = packet.timestamp; return originalVideoAdd.call(this, packet, ...args); };
  MB.EncodedAudioPacketSource.prototype.add = function (packet, ...args) { maximumAudioLead = Math.max(maximumAudioLead, packet.timestamp - videoTime); return originalAudioAdd.call(this, packet, ...args); };
  try { await mux(sample, captions.slice(0, 1)); assert.ok(maximumAudioLead < 0.2, `audio ran ${maximumAudioLead}s ahead of video`); }
  finally { MB.EncodedPacketSink.prototype.getNextPacket = originalNext; MB.EncodedAudioPacketSource.prototype.add = originalAudioAdd; MB.EncodedVideoPacketSource.prototype.add = originalVideoAdd; }
});

async function matroskaFixture(withSubtitle = false) {
  const input = new MB.Input({ source: new MB.BlobSource(sample), formats: MB.ALL_FORMATS });
  const target = new MB.BufferTarget(), output = new MB.Output({ format: new MB.MkvOutputFormat(), target });
  try {
    const sources = [];
    for (const track of await input.getTracks()) {
      const source = track.isVideoTrack() ? new MB.EncodedVideoPacketSource(await track.getCodec()) : new MB.EncodedAudioPacketSource(await track.getCodec());
      const metadata = { decoderConfig: await track.getDecoderConfig() };
      if (track.isVideoTrack()) output.addVideoTrack(source, metadata); else output.addAudioTrack(source, metadata);
      sources.push({ source, track });
    }
    const subtitle = withSubtitle ? new MB.TextSubtitleSource('webvtt') : null;
    if (subtitle) output.addSubtitleTrack(subtitle, { languageCode: 'eng' });
    await output.start();
    if (subtitle) { await subtitle.add(captions[0].content); subtitle.close(); }
    await Promise.all(sources.map(async ({ source, track }) => { for await (const packet of new MB.EncodedPacketSink(track).packets()) await source.add(packet); source.close(); }));
    await output.finalize();
    return new Blob([target.buffer]);
  } finally { input.dispose(); }
}

test('converts Matroska AV input to MP4 while copying every encoded packet', async () => {
  const source = await matroskaFixture(), result = await mux(source, captions.slice(0, 2));
  assert.equal(boxes(result)[0].type, 'ftyp');
  assert.equal(inspect(result).filter(track => track.codec === 'tx3g').length, 2);
  const actual = await packetSummary(new Blob([result])), expected = await packetSummary(source);
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(actual[i].codec, expected[i].codec);
    assert.equal(actual[i].packets.length, expected[i].packets.length);
    for (let n = 0; n < expected[i].packets.length; n++) {
      const a = actual[i].packets[n], e = expected[i].packets[n];
      assert.equal(a.data, e.data); assert.equal(a.type, e.type);
      // Matroska fixture timestamps/durations are quantized to milliseconds;
      // MP4 quantizes again to its own video/audio track timescale.
      assert.ok(Math.abs(a.timestamp - e.timestamp) < 0.0011);
      assert.ok(Math.abs(a.duration - e.duration) < 0.0011);
    }
  }
});

test('rejects Matroska embedded subtitles instead of silently dropping them', async () => {
  const source = await matroskaFixture(true);
  await assert.rejects(() => mux(source, captions.slice(0, 1)), /existing|embedded|preserv/i);
});

test('accepts a WebM Opus input and preserves its encoded audio in MP4', async () => {
  const target = new MB.BufferTarget(), output = new MB.Output({ format: new MB.WebMOutputFormat(), target });
  const audio = new MB.EncodedAudioPacketSource('opus');
  const description = new Uint8Array([79, 112, 117, 115, 72, 101, 97, 100, 1, 2, 0, 0, 128, 187, 0, 0, 0, 0, 0]);
  output.addAudioTrack(audio, { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description } });
  await output.start();
  for (let n = 0; n < 50; n++) await audio.add(new MB.EncodedPacket(new Uint8Array([0xf8, 0xff, 0xfe]), 'key', n * 0.02, 0.02));
  audio.close(); await output.finalize();
  const source = new Blob([target.buffer]);
  const result = await mux(source, [{ language: 'en', label: 'WebM captions', content: 'WEBVTT\n\n00:00:00.100 --> 00:00:00.500\nWebM subtitle\n\n' }]);
  assert.deepEqual(inspect(result).map(track => track.codec), ['Opus', 'tx3g']);
  assert.deepEqual(await packetSummary(new Blob([result])), await packetSummary(source));
});

test('partial exports can retain an empty language track before its first cue', async () => {
  const track = { language: 'en', label: 'Later captions', allowEmptyAfterClip: true, content: 'WEBVTT\n\n01:00:00.000 --> 01:00:01.000\nOutside partial save\n\n' };
  const result = await mux(sample, [track]);
  assert.equal(inspect(result).filter(item => item.codec === 'tx3g').length, 1);
  assert.equal(result.includes(Buffer.from('Outside partial save')), false);
  assert.ok(inspect(result).find(item => item.codec === 'tx3g').name.includes('Later captions'));
  await assert.rejects(() => mux(sample, [{ ...track, content: 'WEBVTT\n\ninvalid cue' }]), /invalid/i);
});

test('cancellation while writing and destination errors reject without hanging', { timeout: 5000 }, async () => {
  assert.equal(typeof module.MuxSubtitles, 'function');
  const controller = new AbortController();
  await assert.rejects(() => module.MuxSubtitles(sample, captions, new WritableStream({ write() { controller.abort(); } }), controller.signal), { name: 'AbortError' });
  await assert.rejects(() => module.MuxSubtitles(sample, captions, new WritableStream({ write() { throw new Error('Disk full'); } })), /Disk full/);
});

test('timed text decodes gaps, overlapping cues, Unicode and VTT entities on its actual sample timeline', async () => {
  const result = await mux(sample, [{language: 'en', content: 'WEBVTT\n\n00:00:00.500 --> 00:00:01.500\n<b>Hello &amp; 日本語</b>\n\n00:00:01.000 --> 00:00:02.000\nOther\n\n00:00:02.500 --> 00:00:03.000\nLast\n\n'}]);
  const moov = boxes(result).find(b => b.type === 'moov');
  const track = boxes(result, moov.start, moov.end).filter(b => b.type === 'trak').at(-1);
  const stbl = child(result, child(result, child(result, track, 'mdia'), 'minf'), 'stbl');
  const stts = child(result, stbl, 'stts'), stsz = child(result, stbl, 'stsz'), co64 = child(result, stbl, 'co64');
  const durations = [];
  for (let n = 0; n < result.readUInt32BE(stts.start + 4); n++) {
    const pos = stts.start + 8 + n * 8;
    for (let i = 0; i < result.readUInt32BE(pos); i++) durations.push(result.readUInt32BE(pos + 4));
  }
  let position = Number(result.readBigUInt64BE(co64.start + 8)), time = 0;
  const decoded = durations.map((duration, index) => {
    const size = result.readUInt32BE(stsz.start + 12 + index * 4), length = result.readUInt16BE(position);
    assert.equal(size, length + 2);
    const value = {start: time, end: time + duration, text: result.toString('utf8', position + 2, position + 2 + length)};
    position += size; time += duration; return value;
  });
  assert.deepEqual(decoded, [
    {start: 0, end: 500, text: ''}, {start: 500, end: 1000, text: 'Hello & 日本語'},
    {start: 1000, end: 1500, text: 'Hello & 日本語\nOther'}, {start: 1500, end: 2000, text: 'Other'},
    {start: 2000, end: 2500, text: ''}, {start: 2500, end: 3000, text: 'Last'},
  ]);
});

test('explicit BufferTarget callers receive compatible text, and oversized UTF-8 samples fail before locking a stream', async () => {
  const target = new MB.BufferTarget();
  await module.MuxSubtitles(sample, captions.slice(0, 1), target);
  assert.equal(inspect(Buffer.from(target.buffer)).at(-1).codec, 'tx3g');
  const destination = new WritableStream();
  await assert.rejects(module.MuxSubtitles(sample, [{language: 'ja', content: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n' + '語'.repeat(22000) + '\n\n'}], destination), /65535/);
  assert.equal(destination.locked, false);
});

test('metadata and sink failures release the destination writer even before mux startup or after a stream error', async () => {
  const metadata = MB.Input.prototype.getMetadataTags;
  const early = new WritableStream();
  MB.Input.prototype.getMetadataTags = async () => { throw new Error('Metadata unavailable'); };
  try { await assert.rejects(module.MuxSubtitles(sample, captions.slice(0, 1), early), /Metadata unavailable/); }
  finally { MB.Input.prototype.getMetadataTags = metadata; }
  assert.equal(early.locked, false);
  const disk = new WritableStream({write() { throw new Error('Disk full'); }});
  await assert.rejects(module.MuxSubtitles(sample, captions.slice(0, 1), disk), /Disk full/);
  assert.equal(disk.locked, false);
});

test('overlapping-cue expansion is bounded before starting or copying media', async () => {
  const stamp = milliseconds => `00:00:${String(Math.floor(milliseconds / 1000)).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
  const content = 'WEBVTT\n\n' + Array.from({length: 2000}, (_, i) => `${stamp(i)} --> ${stamp(2000 + i)}\n${'x'.repeat(25)}\n\n`).join('');
  let writes = 0;
  const destination = new WritableStream({write() { writes++; }});
  await assert.rejects(module.MuxSubtitles(sample, [{language: 'en', content}], destination), /limit exceeded/);
  assert.equal(writes, 0, 'reject expansion during caption preparation, before AV transfer');
  assert.equal(destination.locked, false);
});
