import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {PreviewTile} from '../extension/media-thumbnails.js';
function Images(T)
{
	const Decodes = new Map();
	class Node extends EventTarget
	{
		constructor()
		{
			super();
			this.children = [];
		}
		append(...Items)
		{
			for (const Item of Items)
			{
				Item.parent = this;
				this.children.push(Item);
			}
		}
		setAttribute()
		{
		} removeAttribute(Key)
		{
			delete this[Key];
		}
		replaceWith(Other)
		{
			const Siblings = this.parent.children;
			Siblings.splice(Siblings.indexOf(this), 1, Other);
			Other.parent = this.parent;
		}
	}
	globalThis.document = {createElement: () => new Node()};
	globalThis.Image = class extends Node
	{
		constructor()
		{
			super();
			this.naturalWidth = 112;
		}decode()
		{
			return Decodes.get(this.src) ?? Promise.resolve();
		}
	};
	T.after(() =>
	{
		delete globalThis.document;
		delete globalThis.Image;
	});
	return {tile: PreviewTile({attach()
			{
			}}, () =>
		{
		}), decodes: Decodes};
}

Test('keeps the last decoded thumbnail visible when its replacement fails and can retry the same address', async T =>
{
	const {tile: Tile, decodes: Decodes} = Images(T);
	Assert.equal(await Tile.show({still: 'good'}), true);
	Decodes.set('next', Promise.reject(new Error('decode failed')));
	Assert.equal(await Tile.show({still: 'next'}), false);
	Assert.equal(Tile.control.children.find(X => X instanceof Image).src, 'good');
	Decodes.set('next', Promise.resolve());
	Assert.equal(await Tile.show({still: 'next'}), true);
	Assert.equal(Tile.control.children.find(X => X instanceof Image).src, 'next');
});
Test('a late older image cannot replace a more recent thumbnail', async T =>
{
	const {tile: Tile, decodes: Decodes} = Images(T), Old = Promise.withResolvers();
	Decodes.set('old', Old.promise);
	const Pending = Tile.show({still: 'old'});
	await Tile.show({still: 'new'});
	Old.resolve();
	await Pending;
	Assert.equal(Tile.control.children.find(X => X instanceof Image).src, 'new');
});
