import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {CreateJobRow, GetJobRowSignature} from '../extension/job-row.js';

Test('WebRTC manager reveals current save between cancel and stop/save after its first committed data', T =>
{
	const Nodes = [], Requests = [];
	class Node
	{
		constructor() { this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.classList = {add() {}}; Nodes.push(this); }
		append(...Items) { this.children.push(...Items); }
		replaceChildren(...Items) { this.children = Items; }
		setAttribute(Key, Value) { this.attributes[Key] = Value; }
		addEventListener(Key, Value) { this.events[Key] = Value; }
		get childElementCount() { return this.children.length; }
	}
	globalThis.document = {createElement: () => new Node()};
	globalThis.chrome = {runtime: {async sendMessage(Message) { Requests.push(Message); return {ok: true}; }}};
	T.after(() => { delete globalThis.document; delete globalThis.chrome; });
	const Job = {requestId: 'recording', filename: 'live.mp4', state: 'active', recording: true, live: true, finished: 1};
	const Context = {Announce() {}, Refresh() {}, CountFormat: new Intl.NumberFormat('en')};
	CreateJobRow(Job, {control: new Node()}, Context);
	Assert.deepEqual(Nodes.filter(N => N.dataset.action).map(N => N.dataset.action), ['cancel', 'finish']);
	const Signature = GetJobRowSignature(Job, false);
	Nodes.length = 0; Job.snapshotAvailable = true;
	Assert.notEqual(GetJobRowSignature(Job, false), Signature, 'progress must cause the row to add the missing button');
	CreateJobRow(Job, {control: new Node()}, Context);
	const Buttons = Nodes.filter(N => N.dataset.action);
	Assert.deepEqual(Buttons.map(N => N.dataset.action), ['cancel', 'snapshot', 'finish']);
	Assert.match(Buttons[1].children[0].src, /download\.png$/);
	return Buttons[1].events.click().then(() =>
	{
		Assert.deepEqual(Requests, [{type: 'control', requestId: 'recording', action: 'snapshot'}]);
	});
});
