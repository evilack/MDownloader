import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {PreviewTile} from '../extension/media-thumbnails.js';
Test('shows failure only after hover playback fails and keeps thumbnail metadata independent', async T =>
{
	class Node extends EventTarget
	{
		constructor()
		{
			super();
			this.children = [];
			this.attrs = new Map();
		}
		append(...Nodes)
		{
			this.children.push(...Nodes);
		}
		setAttribute(Key, Value)
		{
			this.attrs.set(Key, Value);
		}
		removeAttribute(Key)
		{
			this.attrs.delete(Key);
		}
	}
	globalThis.document = {createElement: () => new Node()};
	globalThis.Image = class extends Node
	{
	};
	T.after(() =>
	{
		delete globalThis.document;
		delete globalThis.Image;
	});
	let Report;
	const Tile = PreviewTile({attach(...Args)
		{
			Report = Args[4];
		}}, () =>
	{
	});
	const Marker = Tile.control.children.find(X => X.className === 'candidate-preview-stale');
	const ThumbnailImage = Tile.control.children.find(X => X instanceof Image);
	Assert.equal(Marker.hidden, true);
	await Tile.refresh(async() => undefined);
	Assert.equal(Marker.hidden, true, 'missing cached thumbnail must not report a playback failure');
	ThumbnailImage.dispatchEvent(new Event('error'));
	Assert.equal(Marker.hidden, true, 'thumbnail decoding failure must not report a playback failure');
	Assert.equal(Tile.control.children.some(X => X.className === 'candidate-preview-fallback'), false, 'no visible Preview placeholder text');
	Report('loading');
	Assert.equal(Marker.hidden, true);
	Report('failed');
	Assert.equal(Marker.hidden, false);
	Tile.show({still: 'data:image/jpeg;base64,valid', duration: 2, resolution: {width: 1280, height: 720}});
	ThumbnailImage.complete = true;
	ThumbnailImage.naturalWidth = 112;
	ThumbnailImage.dispatchEvent(new Event('load'));
	Assert.equal(Marker.hidden, false, 'an image alone does not prove hover playback succeeded');
	Report('playing');
	Assert.equal(Marker.hidden, true);
	const Old = Promise.withResolvers();
	const Pending = Tile.refresh(() => Old.promise);
	Report('loading');
	Report('failed');
	Old.reject(new Error('Old thumbnail lookup'));
	await Pending;
	Assert.equal(Marker.hidden, false, 'thumbnail lookup completion cannot overwrite playback state');
	Report('playing');
	Assert.equal(Marker.hidden, true);
});
