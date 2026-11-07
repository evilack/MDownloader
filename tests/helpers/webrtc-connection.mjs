import {readFileSync as ReadFileSync} from 'node:fs';
const Providers = JSON.parse(ReadFileSync(new URL('../../extension/data/source-providers.json', import.meta.url), 'utf8'));
export function Connection(Quality = 'source')
{
	return {protocol: 'ristretto-v1', url: 'wss://edge-webrtc.doppiocdn.com/rtc', streamId: 'stream', quality: Quality,
		connection: {appKey: 'fixture-key', custom: {name: 'stream', aclAuth: 'fixture-only-authorization'}},
		profiles: {source: {}, '240p': {}}};
}
export function MockSourceProviders(T)
{
	T.mock.method(globalThis, 'fetch', async Address =>
	{
		if (!String(Address).endsWith('/data/source-providers.json')) throw new Error('Unexpected fixture fetch');
		return new Response(JSON.stringify(Providers));
	});
}
