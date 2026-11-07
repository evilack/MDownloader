import { test as Test } from 'node:test';
import Assert from 'node:assert/strict';
import { readFile as ReadFile } from 'node:fs/promises';
import { NormalizeHlsProtocol } from '../extension/lib/hls-protocol.js';
const Catalog = JSON.parse(await ReadFile(new URL('../extension/data/hls-protocols.json', import.meta.url), 'utf8'));
const KeyId = 'NTK9aqcLmNFMWrpQ';
const Address = 'https://media.test/live/index.m3u8';
Test('keeps ordinary HLS text unchanged', async () =>
{
	const Text = '#EXTM3U\r\n#EXTINF:2,\r\na.ts?token=a%20b%2Bc\r\n';
	Assert.equal(await NormalizeHlsProtocol(Text, Address, Catalog), Text);
});
Test('keeps informational metadata unchanged when no URI transformation is declared', async () =>
{
	const Text = '#EXTM3U\r\n#EXT-X-MOUFLON:EXTREF:public-player\r\n#EXTINF:2,\r\na.ts\r\n';
	Assert.equal(await NormalizeHlsProtocol(Text, Address, Catalog), Text);
});
Test('restores explicit v2 resource metadata using the declared key and preserves the request signature', async () =>
{
	const Text = '#EXTM3U\n#EXT-X-MOUFLON:PSCH:v2:' + KeyId + '\n#EXT-X-TARGETDURATION:2\n' +
	'#EXT-X-MAP:URI="init.mp4"\n' +
	'#EXT-X-MOUFLON:URI:https://media.test/live/channel_720p_av1_2566_waHwrEnsvJmO5PPBQyVmHd_1794024848_part0.mp4?sig=a%20b%2Bc\n' +
	'#EXT-X-PART:DURATION=0.5,URI="media.mp4"\n' +
	'#EXTINF:2,\n#EXT-X-MOUFLON:URI:https://media.test/live/channel_720p_av1_2566_waHwrEnsvJmO5PPBQyVmHd_1794024848.mp4\nmedia.mp4';
	const Result = await NormalizeHlsProtocol(Text, Address, Catalog);
	Assert.ok(Result.includes('URI="https://media.test/live/channel_720p_av1_2566_lARFTy9uxy36uOi1_1794024848_part0.mp4?sig=a%20b%2Bc"'));
	Assert.ok(Result.endsWith('https://media.test/live/channel_720p_av1_2566_lARFTy9uxy36uOi1_1794024848.mp4'));
	Assert.ok(Result.includes('#EXT-X-MAP:URI="init.mp4"'));
	Assert.ok(!Result.includes('MOUFLON:'));
});
Test('carries the advertised supported scheme to variants without re-encoding signatures', async () =>
{
	const Text = '#EXTM3U\n#EXT-X-MOUFLON:PSCH:v2:unknown\n#EXT-X-MOUFLON:PSCH:v2:' + KeyId +
	'\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nhttps://media.test/240p.m3u8?sig=a%20b%2Bc';
	const Result = await NormalizeHlsProtocol(Text, Address, Catalog);
	Assert.ok(Result.endsWith('https://media.test/240p.m3u8?sig=a%20b%2Bc&psch=v2&pkey=' + KeyId));
});
Test('rejects unsupported metadata and malformed resource tokens rather than requesting virtual URLs', async () =>
{
	for (const Text of ['#EXTM3U\n#EXT-X-MOUFLON:PSCH:v2:unknown\n#EXTINF:2,\nmedia.mp4',
		'#EXTM3U\n#EXT-X-MOUFLON:PSCH:v2:' + KeyId + '\n#EXT-X-MOUFLON:URI:https://media.test/clip_invalid_123.mp4\n#EXTINF:2,\nmedia.mp4'])
	{
		await Assert.rejects(NormalizeHlsProtocol(Text, Address, Catalog));
	}
});
