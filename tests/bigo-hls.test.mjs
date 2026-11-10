import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {ParseMaster, ParseMediaPlaylist, ParseVod} from '../extension/lib/hls.js';
import {CopyHlsResource, HlsDecryptor} from '../extension/lib/hls-encryption.js';
import {DownloadTracks} from '../extension/lib/stream-transfer.js';
const Address = 'https://media.test:1454/live.m3u8';
const Tag = Seed => '#EXT-X-BIGO-WEB-PROTECTION:VERSION=1,SEED=' + Seed;
const Playlist = (Seed, Sequence = 10, Extra = '') => '#EXTM3U\n' + Tag(Seed) +
 '\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:' + Sequence + '\n' + Extra + '#EXTINF:1,\n' + Sequence + '.ts\n';
// Fixed protocol vectors obtained from BIGO's public web player loader (2026-11-09).
// These masks cover each of the first two packets; the rest of the TS is unchanged.
const Masks = new Map([
 [3142190640, ['2fda79a04df2b0095e6c3c787aa4d90e', '04b95d033fdca1a24ee8e1c1c85171e0']],
 [1, ['383ffffacee7ca0d1ccc258359924dee', '135cdb59bcc9dba60c48f83aeb67e5a5']],
 [4294967295, ['06c1796f8edb6044cbb70148e7945ada', '2da25dccfcf571efdb33dcf15561f234']],
 [2654435769, ['1f19289dcce78c1742ceefbe0a1fa96a', '2b6324a3722e11ab1084ddb9b2f5a8ee']],
]);
function Fixture(Seed)
{
 const Plain = Uint8Array.from({length: 188 * 5}, (_, Index) => Index % 251);
 for (let Index = 0; Index < Plain.length; Index += 188) Plain[Index] = 0x47;
 const Encoded = Plain.slice();
 Masks.get(Seed).forEach((Hex, Packet) => Buffer.from(Hex, 'hex').forEach((Mask, Index) => {Encoded[Packet * 188 + Index] ^= Mask;}));
 return {Plain, Encoded};
}
const Decryptor = () => new HlsDecryptor(() => Assert.fail('BIGO does not fetch an AES key'));
Test('BIGO protection seed belongs to each playlist segment, including refreshed and finite lists', () =>
{
 const First = ParseMediaPlaylist(Playlist(3142190640), Address).segments[0];
 const Next = ParseMediaPlaylist(Playlist(1, 11), Address).segments[0];
 Assert.deepEqual(First.webProtection, {version: 1, seed: 3142190640});
 Assert.deepEqual(Next.webProtection, {version: 1, seed: 1});
 Assert.equal(First.url, 'https://media.test:1454/10.ts');
 const Vod = ParseVod(Playlist(1) + '#EXT-X-ENDLIST', Address);
 Assert.deepEqual(Vod.segments[0].webProtection, {version: 1, seed: 1});
 Assert.doesNotMatch(Vod.local, /BIGO-WEB-PROTECTION/);
 Assert.equal(ParseMediaPlaylist(Playlist(1).replace(Tag(1) + '\n', ''), Address).segments[0].webProtection, undefined);
});
Test('BIGO protected TS restores the official vectors before preview/remux without changing source bytes', async () =>
{
 for (const Seed of Masks.keys())
 {
  const {Plain, Encoded} = Fixture(Seed), Original = Encoded.slice();
  const Resource = ParseMediaPlaylist(Playlist(Seed), Address).segments[0];
  const Result = await Decryptor().Decrypt(Resource, Encoded, new AbortController().signal);
  Assert.deepEqual(Result, Plain);
  Assert.deepEqual(Encoded, Original);
 }
});
Test('BIGO rejects duplicate/unsupported/malformed protection and unsupported resource layouts before download', () =>
{
 const Invalid = [Tag(0), Tag(4294967296), Tag(-1), Tag('1.5'), Tag('abc'), Tag(''),
  Tag(1).replace('VERSION=1', 'VERSION=2'), Tag(1).replace('VERSION=1,', ''),
  Tag(1) + '\n' + Tag(1), Tag(1) + ',SEED=2'];
 for (const Value of Invalid)
  Assert.throws(() => ParseMediaPlaylist(Playlist(1).replace(Tag(1), Value), Address), {key: 'stream_hls_unsupported_media'});
 for (const Extra of ['#EXT-X-KEY:METHOD=AES-128,URI="key"\n', '#EXT-X-MAP:URI="init.mp4"\n',
  '#EXT-X-BYTERANGE:188@0\n', '#EXT-X-PART:DURATION=0.5,URI="part.ts"\n'])
  Assert.throws(() => ParseMediaPlaylist(Playlist(1, 10, Extra), Address), {key: 'stream_hls_unsupported_media'});
 Assert.throws(() => ParseMaster('#EXTM3U\n' + Tag(1) + '\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlive.m3u8', Address), {key: 'stream_hls_unsupported_media'});
});
Test('BIGO fails closed on incomplete, corrupt or wrongly seeded TS and honors cancellation', async () =>
{
 const Resource = ParseMediaPlaylist(Playlist(1), Address).segments[0];
 const {Encoded} = Fixture(1);
 const Corrupt = Encoded.slice(); Corrupt[376] = 0;
 for (const Bytes of [Encoded.slice(0, 376), Encoded.slice(0, -1), Corrupt, Fixture(3142190640).Encoded])
  await Assert.rejects(Decryptor().Decrypt(Resource, Bytes, new AbortController().signal), {key: 'stream_invalid_mpeg_ts'});
 const Controller = new AbortController(); Controller.abort();
 await Assert.rejects(Decryptor().Decrypt(Resource, Encoded, Controller.signal), {name: 'AbortError'});
});
Test('BIGO transfer buffers split HTTP chunks and never commits protected bytes or exceeds the resource limit', async T =>
{
 const {Plain, Encoded} = Fixture(1), Resource = ParseMediaPlaylist(Playlist(1), Address).segments[0];
 T.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({start(C) {
  C.enqueue(Encoded.slice(0, 7)); C.enqueue(Encoded.slice(7, 190)); C.enqueue(Encoded.slice(190)); C.close();
 }})));
 const Chunks = [], Signal = new AbortController().signal;
 Assert.equal(await CopyHlsResource(Resource, 2000, Signal, B => Chunks.push(B), Decryptor()), Plain.length);
 Assert.deepEqual(new Uint8Array(Buffer.concat(Chunks)), Plain);
 await Assert.rejects(CopyHlsResource(Resource, 500, Signal, () => Assert.fail('over-limit output'), Decryptor()), {key: 'stream_http_resource_limit'});
});
Test('BIGO live refresh rotates seeds, keeps committed bytes and supports stop-and-save', async T =>
{
 const Files = new Map(), Stop = new AbortController(), Requests = [];
 T.mock.method(globalThis, 'fetch', async Url => {
  Requests.push(Url);
  return new Response(Url === Address ? Playlist(3142190640, 11) : Fixture(Url.endsWith('10.ts') ? 1 : 3142190640).Encoded);
 });
 const Workspace = {async getFileHandle(Path) {
  return {async getFile(){return new Blob([Files.get(Path)||new Uint8Array()]);},async createWritable() {
   const Chunks = [];
   return {async write(Bytes) {Chunks.push(Bytes);}, async close() {Files.set(Path, new Uint8Array(Buffer.concat(Chunks)));}, async abort() {}};
  }};
 }};
 const Result = await DownloadTracks([{url: Address, playlist: ParseMediaPlaylist(Playlist(1), Address)}], {
  workspace: Workspace, controller: new AbortController(), finishSignal: Stop.signal, authorize: async () => {},
  progress: async State => {if (State.finished === 2) Stop.abort();},
 });
 Assert.equal(Result.progress.finished, 2);
 Assert.equal(Result.progress.received, 188 * 10);
 Assert.deepEqual([...Files.values()], [Fixture(1).Plain, Fixture(3142190640).Plain]);
 Assert.deepEqual(Requests, ['https://media.test:1454/10.ts', Address, 'https://media.test:1454/11.ts']);
 Assert.doesNotMatch(Result.video, /BIGO-WEB-PROTECTION|SEED=/);
});
