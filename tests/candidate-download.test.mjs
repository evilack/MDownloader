import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {CreateCandidateDownloadActions} from '../extension/candidate-download.js';
function QualityHarness(T, Format = 'M3U8', Qualities = [{url: 'https://cdn.test/high.m3u8', resolution: '1920x1080', bandwidth: 6000000}, {url: 'https://cdn.test/low.m3u8', resolution: '640x360', bandwidth: 500000}], Wait = async() =>
{
})
{
	const Nodes = [], Sent = [];
	class Node extends EventTarget
	{
		constructor(Tag)
		{
			super();
			this.tag = Tag;
			this.children = [];
			this.events = {};
			this.classList = {add()
				{
				}};
			Nodes.push(this);
		}
		append(...Items)
		{
			for (const Item of Items)
			{
				Item.remove?.();
				Item.parentElement = this;
				this.children.push(Item);
			}
		}
		get form()
		{
			for (let node = this.parentElement; node; node = node.parentElement)
			{
				if (node.tag === 'form')
				{
					return node;
				}
			}
		}
		after(Item)
		{
			Item.remove();
			const Siblings = this.parentElement.children;
			Item.parentElement = this.parentElement;
			Siblings.splice(Siblings.indexOf(this) + 1, 0, Item);
		}
		remove()
		{
			if (this.parentElement)
			{
				const Siblings = this.parentElement.children;
				Siblings.splice(Siblings.indexOf(this), 1);
				this.parentElement = null;
			}
		}
		replaceChildren(...Items)
		{
			this.children = [];
			this.append(...Items);
			this.selectedIndex = 0;
		}
		setAttribute()
		{
		} focus()
		{
			this.focused = true;
		} scrollIntoView()
		{
		}
		closest()
		{
			return this.parentElement;
		}
		addEventListener(Name, Handler, Options)
		{
			this.events[Name] = Handler;
			super.addEventListener(Name, Handler, Options);
		}
		showModal()
		{
			this.open = true;
			this.modal = true;
		}
		show()
		{
			this.open = true;
			this.modal = false;
		}
		close(Value = '')
		{
			this.open = false;
			this.returnValue = Value;
			this.dispatchEvent(new Event('close'));
		}
	}
	globalThis.document = {body: new Node('body'), createElement: Tag => new Node(Tag)};
	globalThis.Option = class extends Node
	{
		constructor(Text, Value)
		{
			super('option');
			this.textContent = Text;
			this.value = Value;
		}
	};
	globalThis.chrome = {storage: {local: {get: async() => ({chooseHlsQuality: true})}}, runtime: {sendMessage: async Message =>
			{
				Sent.push(Message);
				return {ok: true, data: Message.type === 'hlsQualities' ? Qualities: {state: 'started'}};
			}}};
	T.after(() =>
	{
		for (const Key of ['document', 'Option', 'chrome'])
		{
			delete globalThis[Key];
		}
	});
	const Actions = CreateCandidateDownloadActions(() =>
	{
	}, () =>
	{
	}, Wait), List = new Node('ul'), Row = new Node('li');
	Row.className = 'candidate';
	List.append(Row);
	const Button = Actions.CreateDownloadButton({format: Format}, {tabId: 1, scanId: 'scan', candidateId: 0}, () => true);
	Row.append(Button);
	return {actions: Actions, button: Button, row: Row, list: List, sent: Sent, get: Id => Nodes.find(node => node.id === Id), settle: () => new Promise(Resolve => setImmediate(Resolve))};
}

Test('normal click registers automatically even when an obsolete quality setting is true', async T =>
{
	const H = QualityHarness(T);
	const Click = H.button.events.click({shiftKey: false});
	await H.settle();
	if (H.get('quality-dialog').open)
	{
		H.get('quality-dialog').close();
	}
	await Click;
	Assert.deepEqual(H.sent.map(Message => Message.type), ['enqueue']);
	Assert.equal(H.sent[0].variantUrl, undefined);
});
Test('Shift click opens quality controls below its own row and sends the selected rendition', async T =>
{
	const Pending = Promise.withResolvers(), H = QualityHarness(T, undefined, undefined, () => Pending.promise);
	const Event = {shiftKey: true}, Click = H.button.events.click(Event);
	Event.shiftKey = false;
	Pending.resolve();
	await H.settle();
	const Dialog = H.get('quality-dialog');
	Assert.equal(Dialog.open, true);
	Assert.equal(Dialog.modal, false, 'quality controls are local to the clicked item');
	Assert.equal(H.list.children[1].children[0], Dialog, 'controls follow the clicked row');
	Assert.equal(H.sent.some(Message => Message.type === 'enqueue'), false);
	const Select = H.get('quality');
	Select.selectedIndex = 1;
	const Confirm = H.get('confirm-quality');
	await Confirm.form.events.submit({submitter: Confirm, preventDefault()
		{
		}});
	await Click;
	Assert.equal(H.sent.at(-1).variantUrl, 'https://cdn.test/low.m3u8');
	Assert.equal(H.list.children.length, 1, 'closed controls leave no empty slot');
});
Test('cancel and Escape close item quality controls without registering a download', async T =>
{
	const H = QualityHarness(T);
	for (const Escape of [false, true])
	{
		const Click = H.button.events.click({shiftKey: true});
		await H.settle();
		const Dialog = H.get('quality-dialog');
		if (Escape)
		{
			Dialog.dispatchEvent(Object.assign(new Event('keydown', {cancelable: true}), {key: 'Escape'}));
		}
		else
		{
			H.get('cancel-quality').events.click();
		}
		await Click;
		Assert.equal(H.list.children.length, 1);
		Assert.equal(H.button.focused, true);
	}
	Assert.equal(H.sent.some(Message => Message.type === 'enqueue'), false);
});
Test('Shift click uses automatic registration for a single rendition or a direct media file', async T =>
{
	const H = QualityHarness(T, 'M3U8', [{url: 'https://cdn.test/only.m3u8', bandwidth: 500000}]);
	await H.button.events.click({shiftKey: true});
	Assert.equal(H.sent.at(-1).type, 'enqueue');
	Assert.notEqual(H.get('quality-dialog').open, true);
	const Direct = H.actions.CreateDownloadButton({format: 'MP4'}, {tabId: 1, scanId: 'scan', candidateId: 1}, () => true);
	await Direct.events.click({shiftKey: true});
	Assert.equal(H.sent.filter(Message => Message.type === 'hlsQualities').length, 1);
});
Test('waits for the retained row to receive its new scan ID and releases the button after registration', async T =>
{
	class Node
	{
		constructor()
		{
			this.events = {};
			this.classList = {add()
				{
				}};
		}
		append()
		{
		} replaceChildren()
		{
		} setAttribute()
		{
		}
		addEventListener(Name, Handler)
		{
			this.events[Name] = Handler;
		}
	}
	globalThis.document = {body: new Node(), createElement: () => new Node()};
	const Sent = [];
	globalThis.chrome = {runtime: {sendMessage: async Message =>
			{
				Sent.push(Message);
				return {ok: true, data: {state: 'started'}};
			}}};
	T.after(() =>
	{
		delete globalThis.document;
		delete globalThis.chrome;
	});
	const Pending = Promise.withResolvers(), Input = {tabId: 1, scanId: 'old', candidateId: 0};
	let bCurrent = false;
	const Actions = CreateCandidateDownloadActions(() =>
	{
	}, () =>
	{
	}, async() =>
	{
		await Pending.promise;
		Input.scanId = 'new';
		bCurrent = true;
	});
	const Button = Actions.CreateDownloadButton({format: 'MP4'}, Input, () => bCurrent);
	const Click = Button.events.click();
	await Promise.resolve();
	Assert.equal(Sent.length, 0);
	Pending.resolve();
	await Click;
	Assert.equal(Sent[0].scanId, 'new');
	Assert.equal(Button.disabled, false);
	Assert.equal(Actions.IsBusy(), false);
	const Request = Promise.withResolvers();
	chrome.runtime.sendMessage = () => Request.promise;
	const SecondActions = CreateCandidateDownloadActions(() =>
	{
	}, () =>
	{
	});
	const Second = SecondActions.CreateDownloadButton({format: 'MP4'}, Input, () => bCurrent);
	const SecondClick = Second.events.click();
	await new Promise(Resolve => setImmediate(Resolve));
	bCurrent = false;
	Request.reject(new Error('navigation during request'));
	await SecondClick;
	bCurrent = true;
	Assert.equal(Second.disabled, false, 'a retained control must be released even if its generation changed during the request');
});
