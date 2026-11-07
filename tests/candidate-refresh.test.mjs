import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {setTimeout as Delay, setImmediate as Settle} from 'node:timers/promises';
import {CreateCandidateList} from '../extension/candidate-list.js';
import {RuntimePolicy} from '../extension/lib/runtime-policy.js';
Test('keeps the settled empty state visible during background scans and avoids repeat announcements', async T =>
{
	const Event = () => ({listeners: [], addListener(Fn)
		{
			this.listeners.push(Fn);
		}, fire(...Args)
		{
			for (const Fn of this.listeners)
			{
				Fn(...Args);
			}
		}});
	class Node
	{
		constructor()
		{
			this.children = [];
			this.events = {};
			this.values = [];
			this.disabled = false;
			this.classList = {add: () =>
				{
				}};
		}
		set textContent(Value)
		{
			this.text = Value;
			this.values.push(Value);
		}
		get textContent()
		{
			return this.text ?? '';
		}
		append(...Nodes)
		{
			for (const node of Nodes)
			{
				if (typeof node === 'object')
				{
					node.parentElement = this;
				}
			}this.children.push(...Nodes);
		}
		before(...Nodes)
		{
			const Siblings = this.parentElement.children;
			for (const node of Nodes)
			{
				node.parentElement = this.parentElement;
			}
			Siblings.splice(Siblings.indexOf(this), 0, ...Nodes);
		}
		replaceChildren(...Nodes)
		{
			this.children = Nodes;
		}
		setAttribute()
		{
		}
		addEventListener(Type, Fn)
		{
			this.events[Type] = Fn;
		}
		querySelectorAll()
		{
			return [];
		}
	}
	const List = new Node(), Status = new Node(), Button = new Node(), Body = new Node();
	Body.append(Status, List, Button);
	globalThis.document = {hidden: false, body: Body, createElement: () => new Node(), createDocumentFragment: () => new Node(), addEventListener()
		{
		}, removeEventListener()
		{
		}};
	const Changed = Event();
	let Next = Promise.resolve({scanId: 'first', candidates: []});
	let Scans = 0;
	globalThis.chrome = {tabs: {query: async() => [{id: 8, windowId: 1}], onUpdated: Event(), onActivated: Event()},
		storage: {onChanged: Changed}, downloads: {onChanged: Event(), onErased: Event()}, runtime: {sendMessage: async Message =>
			{
				if (Message.type === 'scan')
				{
					Scans++;
					return {ok: true, data: await Next};
				}return {ok: true, data: []};
			}}};
	const Root = {querySelector: Selector => Selector === '#candidates' ? List: Selector === '#scan' ? Button: Status};
	const View = CreateCandidateList({root: Root, mediaPreview: {isHoveringWithin: () => false, close()
			{
			}}});
	T.after(async() =>
	{
		View.setEnabled(false);
		await Settle();
		delete globalThis.chrome;
		delete globalThis.document;
	});
	View.setEnabled(true);
	await Settle();
	Assert.equal(Status.textContent, 'view_scan_empty');
	Status.values = [];
	const Pending = Promise.withResolvers();
	Next = Pending.promise;
	Changed.fire({'network:8': {newValue: []}}, 'session');
	await Delay(RuntimePolicy.Detection.RefreshDelayMs + 20);
	Assert.equal(Scans, 2);
	Assert.equal(Status.textContent, 'view_scan_empty', 'automatic scans must retain the stable status');
	Assert.equal(Button.disabled, false, 'a background scan must not dim the refresh button');
	Pending.resolve({scanId: 'second', candidates: []});
	await Settle();
	Assert.deepEqual(Status.values, [], 'unchanged results must not rewrite the live status region');
	const Again = Promise.withResolvers();
	Next = Again.promise;
	Changed.fire({'network:8': {newValue: []}}, 'session');
	await Delay(RuntimePolicy.Detection.RefreshDelayMs + 20);
	const Manual = Promise.withResolvers();
	Next = Manual.promise;
	Button.events.click();
	Again.resolve({scanId: 'third', candidates: []});
	await Settle();
	Assert.equal(Scans, 4, 'a manual click during a background scan must be queued rather than lost');
	Assert.equal(Button.disabled, true, 'the user-requested scan still shows its busy state');
	Manual.resolve({scanId: 'fourth', candidates: []});
	await Settle();
	Assert.equal(Button.disabled, false);
});
