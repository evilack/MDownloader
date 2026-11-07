import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {RequireWebRtcConnection} from '../extension/lib/webrtc-descriptor.js';
import {Connection} from './helpers/webrtc-connection.mjs';

Test('background receiver accepts only the configured observed WSS service and selected profile', () =>
{
	const Allowed = ['edge-webrtc.doppiocdn.com'], Input = Connection();
	Assert.equal(RequireWebRtcConnection(Input, Allowed).quality, 'source');
	for (const Change of [{url: 'wss://127.0.0.1/rtc'}, {url: 'wss://unrelated.test/rtc'},
		{url: 'https://edge-webrtc.doppiocdn.com/rtc'}, {url: 'wss://user:pass@edge-webrtc.doppiocdn.com/rtc'},
		{url: 'wss://edge-webrtc.doppiocdn.com:4433/rtc'}, {quality: 'missing'}, {quality: '160p_blurred'}, {protocol: 'other'}])
		Assert.throws(() => RequireWebRtcConnection({...Input, ...Change}, Allowed), {key: 'webrtc_background_unavailable'});
});
