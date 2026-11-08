import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {setImmediate as Settle} from 'node:timers/promises';
import {CreateMediaPreview} from '../extension/media-preview.js';
import {RuntimePolicy} from '../extension/lib/runtime-policy.js';
import {DebugLog} from '../extension/lib/debug-log.js';
function Harness(T, Play = async() =>
{
})
{
	const Players = [];
	class Element extends EventTarget
	{
		constructor(Tag)
		{
			super();
			this.tag = Tag;
			this.children = [];
			this.style = {};
			this.isConnected = true;
			this.offsetHeight = 180;
			this.classList = {add()
				{
				}, remove()
				{
				}};
		}
		append(...Nodes)
		{
			for (const Node of Nodes)
			{
				Node.parent = this;
				this.children.push(Node);
			}
		}
		replaceChildren(...Nodes)
		{
			this.children = [];
			this.append(...Nodes);
		}
		remove()
		{
			if (this.parent)
			{
				this.parent.children = this.parent.children.filter(X => X !== this);
			}
			this.isConnected = false;
		}
		setAttribute()
		{
		} removeAttribute()
		{
		} matches()
		{
			return !!this.open;
		}
		showPopover()
		{
			this.open = true;
		} hidePopover()
		{
			this.open = false;
		}
		getBoundingClientRect()
		{
			return {left: 10, right: 74, top: 10, bottom: 46};
		}
		pause()
		{
		} load()
		{
		} play()
		{
			return Play();
		}
	}
	const Root = new Element('html');
	Root.clientWidth = 420;
	globalThis.Node = Element;
	globalThis.document = {body: new Element('body'), documentElement: Root, addEventListener()
		{
		},
		createElement: Tag =>
		{
			const Node = new Element(Tag);
			if (Tag === 'video' || Tag === 'audio')
			{
				Players.push(Node);
			}
			return Node;
		}};
	globalThis.window = new Element('window');
	window.innerHeight = 800;
	globalThis.ResizeObserver = class
	{
		observe()
		{
		}
	};
	globalThis.matchMedia = () => ({matches: true});
	T.mock.timers.enable({apis: ['setTimeout']});
	const View = CreateMediaPreview();
	const Trigger = new Element('div');
	T.after(() =>
	{
		View.close();
		for (const Key of ['Node', 'document', 'window', 'ResizeObserver', 'matchMedia'])
		{
			delete globalThis[Key];
		}
	});
	return {view: View, trigger: Trigger, players: Players, async open(Load, States, Capture)
		{
			View.attach(Trigger, Load, () => undefined, Capture, State => States.push(State));
			Trigger.dispatchEvent(Object.assign(new Event('pointerenter'), {pointerType: 'mouse', clientX: 20, clientY: 20}));
			T.mock.timers.tick(RuntimePolicy.Preview.HoverOpenDelayMs);
			await Settle();
		}};
}

Test('reports actual play rejection after hovering rather than thumbnail availability', async T =>
{
	T.mock.method(console, 'debug', () =>
	{
	});
	DebugLog.SetEnabled(true);
	T.after(() => DebugLog.SetEnabled(false));
	const H = Harness(T, async() =>
	{
		throw new Error('Decode failed');
	});
	const States = [];
	Assert.deepEqual(States, []);
	await H.open(async() => ({url: 'https://media.test/clip.mp4', format: 'MP4'}), States);
	Assert.deepEqual(States, ['loading', 'failed']);
	Assert.equal(DebugLog.Snapshot().find(Entry => Entry.event === 'PreviewFinished')?.result, 'failed');
});
Test('YouTube watch candidates use the bounded page capture and wait for real preview playback',async T=>{
	const H=Harness(T),States=[];let Captures=0;
	await H.open(async()=>({format:'YOUTUBE'}),States,async()=>{Captures++;return'data:video/webm;base64,fixture';});
	Assert.equal(Captures,1);Assert.equal(H.players.length,1);Assert.deepEqual(States,['loading']);
	Assert.equal(H.players[0].src,'data:video/webm;base64,fixture');H.players[0].dispatchEvent(new Event('playing'));Assert.deepEqual(States,['loading','playing']);
});
Test('reports playing and later media errors, while metadata loading alone is not success', async T =>
{
	const H = Harness(T);
	const States = [];
	await H.open(async() => ({url: 'https://media.test/clip.mp4', format: 'MP4'}), States);
	Assert.deepEqual(States, ['loading']);
	H.players[0].dispatchEvent(new Event('playing'));
	Assert.deepEqual(States, ['loading', 'playing']);
	H.players[0].dispatchEvent(new Event('error'));
	Assert.deepEqual(States, ['loading', 'playing', 'failed']);
});
Test('does not mark a canceled hover as failed when its lookup rejects later', async T =>
{
	const H = Harness(T);
	const States = [], Lookup = Promise.withResolvers();
	await H.open(() => Lookup.promise, States);
	H.view.close(H.trigger);
	Lookup.reject(new Error('Canceled lookup'));
	await Settle();
	Assert.deepEqual(States, ['loading']);
});
Test('reports failure if a hover never starts playing within the configured deadline', async T =>
{
	const H = Harness(T);
	const States = [];
	await H.open(async() => ({url: 'https://media.test/clip.mp4', format: 'MP4'}), States);
	T.mock.timers.tick(RuntimePolicy.Preview.StreamTimeoutMs - 1);
	Assert.deepEqual(States, ['loading']);
	T.mock.timers.tick(1);
	Assert.deepEqual(States, ['loading', 'failed']);
});
