import Assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test as Test} from 'node:test';
import {runInNewContext} from 'node:vm';
import {PagePolicy} from '../extension/lib/runtime-policy.js';

const Source = await readFile(new URL('../extension/hls-manifest-bridge.js', import.meta.url), 'utf8');
const Origin = 'https://player.example';
const Manifest = {
	type: 'mdownloader-hls-manifest',
	url: 'https://cdn.example/live.m3u8',
	text: '#EXTM3U',
	page: Origin + '/live',
};

function OpenBridge(Chrome)
{
	const Listeners = new Map();
	const Window = {
		addEventListener(Type, Listener) {Listeners.set(Type, Listener);},
		removeEventListener(Type, Listener)
		{
			if (Listeners.get(Type) === Listener) Listeners.delete(Type);
		},
	};
	runInNewContext(Source, {window: Window, chrome: Chrome, location: {origin: Origin}, URL, MDownloaderPagePolicy: PagePolicy});
	return {
		postManifest() {Listeners.get('message')?.({source: Window, origin: Origin, data: Manifest});},
		isListening() {return Listeners.has('message');},
	};
}

Test('forwards a manifest while the extension context is active', () =>
{
	const Sent = [];
	const Bridge = OpenBridge({runtime: {async sendMessage(Message) {Sent.push({...Message});}}});
	Bridge.postManifest();
	Assert.deepEqual(Sent, [Manifest]);
});

Test('retires the bridge when the runtime disappears after reloading the extension', () =>
{
	const Chrome = {runtime: {async sendMessage() {}}};
	const Bridge = OpenBridge(Chrome);
	delete Chrome.runtime;

	Assert.doesNotThrow(() => Bridge.postManifest());
	Assert.equal(Bridge.isListening(), false);
});

Test('retires the bridge when Chromium throws synchronously from an invalidated context', () =>
{
	let Attempts = 0;
	const Bridge = OpenBridge({runtime: {sendMessage()
	{
		Attempts += 1;
		throw new Error('Extension context invalidated.');
	}}});

	Assert.doesNotThrow(() => Bridge.postManifest());
	Bridge.postManifest();
	Assert.equal(Attempts, 1);
});

Test('continues forwarding later manifests after a message promise rejects', async () =>
{
	let Attempts = 0;
	const Bridge = OpenBridge({runtime: {async sendMessage()
	{
		Attempts += 1;
		if (Attempts === 1) throw new Error('The message port closed before a response was received.');
	}}});

	Bridge.postManifest();
	await Promise.resolve();
	Bridge.postManifest();
	Assert.equal(Attempts, 2);
});
