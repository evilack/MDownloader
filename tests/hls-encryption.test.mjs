import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {ParseMaster, ParseMediaPlaylist} from '../extension/lib/hls.js';
import {HlsDecryptor, HlsResourceUrls} from '../extension/lib/hls-encryption.js';
const Address = 'https://media.test/hls/index.m3u8';
const Playlist = Tags => '#EXTM3U\n#EXT-X-TARGETDURATION:4\n' + Tags + '\n#EXT-X-ENDLIST';
Test('HLS encryption follows key rotation, sequence IVs and METHOD=NONE', () =>
{
	const Parsed = ParseMediaPlaylist(Playlist('#EXT-X-MEDIA-SEQUENCE:258\n#EXT-X-KEY:METHOD=AES-128,URI="../key?v=1"\n#EXTINF:4,\na.ts\n#EXTINF:4,\nb.ts\n#EXT-X-KEY:METHOD=AES-128,URI="../key?v=2",IV=0xabc\n#EXTINF:4,\nc.ts\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\nd.ts'), Address);
	const [A, B, C, D] = Parsed.segments;
	Assert.equal(A.encryption, B.encryption);
	Assert.notEqual(A.encryption, C.encryption);
	Assert.equal(A.sequence, 258);
	Assert.equal(A.encryption.url, 'https://media.test/key?v=1');
	Assert.equal(C.encryption.iv, '00000000000000000000000000000abc');
	Assert.equal(D.encryption, undefined);
	Assert.deepEqual(HlsResourceUrls(A), [A.url, A.encryption.url]);
});
Test('encrypted maps require explicit IVs and keep their original key across rotation', () =>
{
	const Key = '#EXT-X-KEY:METHOD=AES-128,URI="key"';
	Assert.throws(() => ParseMediaPlaylist(Playlist(Key + '\n#EXT-X-MAP:URI="init"\n#EXTINF:4,\na.m4s'), Address), {key: 'stream_hls_invalid_key'});
	const [Segment] = ParseMediaPlaylist(Playlist(Key + ',IV=0x1\n#EXT-X-MAP:URI="init"\n' + Key + '\n#EXTINF:4,\na.m4s'), Address).segments;
	Assert.equal(Segment.init.encryption.iv, '00000000000000000000000000000001');
	Assert.notEqual(Segment.init.encryption, Segment.encryption);
});
Test('identity keys coexist with DRM declarations and master session keys are metadata', () =>
{
	const Drm = '#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery",URI="skd://license"';
	for (const Tags of [Drm + '\n#EXT-X-KEY:METHOD=AES-128,URI="key"', '#EXT-X-KEY:METHOD=AES-128,URI="key"\n' + Drm])
	{
		Assert.equal(ParseMediaPlaylist(Playlist(Tags + '\n#EXTINF:4,\na.ts'), Address).segments[0].encryption.method, 'AES-128');
	}
	Assert.equal(ParseMaster('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key"\n#EXT-X-STREAM-INF:BANDWIDTH=100\na.m3u8', Address)[0].url, 'https://media.test/hls/a.m3u8');
	Assert.throws(() => ParseMediaPlaylist(Playlist(Drm + '\n#EXTINF:4,\na.ts'), Address), {key: 'stream_hls_encrypted'});
});
Test('malformed keys are rejected before any resource request', () =>
{
	for (const Fields of ['METHOD=NONE,URI="key"', 'METHOD=AES-128', 'METHOD=AES-128,URI="file:///key"', 'METHOD=AES-128,URI="https://u:p@media.test/key"', 'METHOD=AES-128,URI="key",IV=0xzz', 'METHOD=AES-128,URI="key",IV=0x' + '1'.repeat(33), 'METHOD=AES-128,URI="key",KEYFORMATVERSIONS="2"', 'METHOD=AES-256-GCM,URI="key",IV=0x1'])
	{
		Assert.throws(() => ParseMediaPlaylist(Playlist('#EXT-X-KEY:' + Fields + '\n#EXTINF:4,\na.ts'), Address), {key: 'stream_hls_invalid_key'});
	}
});
for (const [Method, Algorithm, Length] of [['AES-128', 'AES-CBC', 16], ['AES-256', 'AES-CBC', 32], ['AES-256-CTR', 'AES-CTR', 32], ['AES-256-GCM', 'AES-GCM', 32]])
{
	Test(Method + ' decrypts media, shares concurrent key loads and keeps clear resources unchanged', async () =>
	{
		const Plain = Uint8Array.from({length: 377}, (_, Index) => Index % 251);
		const Raw = crypto.getRandomValues(new Uint8Array(Length));
		const Iv = new Uint8Array(16);
		Iv[14] = 1;
		Iv[15] = 2;
		const Imported = await crypto.subtle.importKey('raw', Raw, Algorithm, false, ['encrypt']);
		const Params = Algorithm === 'AES-CTR' ? {name: Algorithm, counter: Iv, length: 64} : {name: Algorithm, iv: Iv};
		const Cipher = new Uint8Array(await crypto.subtle.encrypt(Params, Imported, Plain));
		const Bytes = Algorithm === 'AES-GCM' ? new Uint8Array([...Iv, ...Cipher]) : Cipher;
		let Loads = 0;
		const Decryptor = new HlsDecryptor(async () =>
		{
			Loads++;
			return Raw.slice();
		});
		const [Resource] = ParseMediaPlaylist(Playlist('#EXT-X-MEDIA-SEQUENCE:258\n#EXT-X-KEY:METHOD=' + Method + ',URI="key"\n#EXTINF:4,\na.ts'), Address).segments;
		const Signal = new AbortController().signal;
		const Results = await Promise.all([Decryptor.Decrypt(Resource, Bytes, Signal), Decryptor.Decrypt(Resource, Bytes, Signal)]);
		Assert.deepEqual(Results, [Plain, Plain]);
		Assert.equal(Loads, 1);
		Assert.equal(await Decryptor.Decrypt({}, Plain, Signal), Plain);
	});
}

Test('key length, CBC padding, GCM authentication and aborts fail without exposing secrets', async () =>
{
	const Signal = new AbortController().signal;
	const Resource = ParseMediaPlaylist(Playlist('#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:4,\na.ts'), Address).segments[0];
	await Assert.rejects(new HlsDecryptor(async () => new Uint8Array(15)).Decrypt(Resource, new Uint8Array(16), Signal), {key: 'stream_hls_invalid_key'});
	await Assert.rejects(new HlsDecryptor(async () => new Uint8Array(16)).Decrypt(Resource, new Uint8Array(16), Signal), {key: 'stream_hls_decryption_failed'});
	const Gcm = ParseMediaPlaylist(Playlist('#EXT-X-KEY:METHOD=AES-256-GCM,URI="key"\n#EXTINF:4,\na.ts'), Address).segments[0];
	await Assert.rejects(new HlsDecryptor(async () => new Uint8Array(32)).Decrypt(Gcm, new Uint8Array(48), Signal), {key: 'stream_hls_decryption_failed'});
	const Controller = new AbortController();
	Controller.abort();
	await Assert.rejects(new HlsDecryptor(() => Assert.fail('must not load')).Decrypt(Resource, new Uint8Array(16), Controller.signal), {name: 'AbortError'});
});
Test('failed key loads can retry and different jobs never share imported keys', async () =>
{
	const Signal = new AbortController().signal;
	const [Resource] = ParseMediaPlaylist(Playlist('#EXT-X-KEY:METHOD=AES-128,URI="key",IV=0x1\n#EXTINF:4,\na.ts'), Address).segments;
	const Raw = crypto.getRandomValues(new Uint8Array(16));
	const Iv = new Uint8Array(16);
	Iv[15] = 1;
	const Plain = new Uint8Array([1, 2, 3]);
	const Cipher = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-CBC', iv: Iv}, await crypto.subtle.importKey('raw', Raw, 'AES-CBC', false, ['encrypt']), Plain));
	let Attempts = 0;
	const First = new HlsDecryptor(async () =>
	{
		if (++Attempts === 1)
		{
			throw new TypeError('network');
		}
		return Raw.slice();
	});
	await Assert.rejects(First.Decrypt(Resource, Cipher, Signal), TypeError);
	Assert.deepEqual(await First.Decrypt(Resource, Cipher, Signal), Plain);
	Assert.equal(Attempts, 2);
	let OtherLoads = 0;
	const Second = new HlsDecryptor(async () =>
	{
		OtherLoads++;
		return Raw.slice();
	});
	Assert.deepEqual(await Second.Decrypt(Resource, Cipher, Signal), Plain);
	Assert.equal(OtherLoads, 1);
});
