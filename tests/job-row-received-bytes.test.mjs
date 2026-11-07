import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {readFile as ReadFile} from 'node:fs/promises';
import {CreateJobRow, UpdateJobRowMetrics} from '../extension/job-row.js';
import {InitializeLocale} from '../extension/lib/i18n.js';

class Node
{
	constructor(Tag) { this.tagName = Tag; this.children = []; this.attributes = {}; this.dataset = {}; this.classList = {add() {}}; }
	append(...Children) { this.children.push(...Children); }
	replaceChildren(...Children) { this.children = Children; }
	setAttribute(Name, Value) { this.attributes[Name] = String(Value); }
	getAttribute(Name) { return this.attributes[Name] ?? null; }
	hasAttribute(Name) { return Object.hasOwn(this.attributes, Name); }
	removeAttribute(Name) { delete this.attributes[Name]; }
	addEventListener() {}
	get childElementCount() { return this.children.length; }
	get value() { return Number(this.attributes.value || 0); }
	set value(Value) { this.attributes.value = String(Value); }
}

Test('the production manager row displays received bytes in its existing progress column', async T =>
{
	T.mock.method(globalThis, 'fetch', async Url => new Response(await ReadFile(Url)));
	globalThis.document = {createElement: Tag => new Node(Tag)};
	T.after(() => { delete globalThis.document; });
	await InitializeLocale('en');
	const CountFormat = new Intl.NumberFormat('en');
	const Context = {Announce() {}, Refresh() {}, CountFormat};
	const Base = {requestId: 'job', filename: 'video.mp4', state: 'active', bytesReceived: 5800000, totalBytes: 10000000};
	const Cases = [
		['direct', {}, '5.8 MB', 58, '3.4 MB/s'],
		['finite HLS', {hls: true, count: 10, finished: 4}, '5.8 MB', 40, '3.4 MB/s'],
		['live HLS', {hls: true, live: true, finished: 4}, '5.8 MB', null, '3.4 MB/s'],
		['WebRTC', {recording: true, live: true, finished: 4}, '5.8 MB', null, '3.4 MB/s'],
		['paused', {state: 'paused', paused: true}, '5.8 MB', 58, '—'],
		['zero bytes', {bytesReceived: 0}, '0 B', 0, '—'],
		['kilobytes', {bytesReceived: 2500}, '2.5 KB', 0, '—'],
		['complete', {state: 'complete', bytesReceived: 6200000, startTime: '2026-11-08T00:00:00Z', endTime: '2026-11-08T00:00:02Z'}, '100%', 100, 'Avg. 3.1 MB/s'],
		['stream muxing', {hls: true, count: 10, finished: 10, muxing: true}, '5.8 MB', 99, 'Assembling MP4…'],
		['stream saving', {recording: true, live: true, downloadId: 20}, '5.8 MB', null, 'Saving MP4…'],
	];
	for (const [Name, Fields, Text, Percent, Speed] of Cases) await T.test(Name, () =>
	{
		const Job = {...Base, ...Fields};
		const Entry = CreateJobRow(Job, {control: new Node('button')}, Context);
		Entry.previous = {time: 1000, bytes: 2400000};
		const Measure = Entry.measure.node;
		UpdateJobRowMetrics(Entry, Job, 2000, CountFormat);
		Assert.equal(Measure.children[0].textContent, Text);
		Assert.equal(Measure.children[1].textContent, Speed);
		Assert.equal(Entry.progress.hasAttribute('value'), Percent !== null);
		if (Percent !== null) Assert.equal(Entry.progress.value, Percent);
		Assert.equal(Entry.progress.title, Measure.title);
		Assert.equal(Entry.progress.getAttribute('aria-valuetext'), Measure.title);
		Assert.match(Measure.title, new RegExp(Text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		Assert.equal(Measure.children.length, 2, 'the existing two-line measure layout is retained');
		if (Job.state !== 'complete')
		{
			UpdateJobRowMetrics(Entry, {...Job, bytesReceived: 12300000}, 3000, CountFormat);
			Assert.equal(Measure.children[0].textContent, '12.3 MB');
			Assert.match(Entry.progress.title, /12\.3 MB/);
			Assert.equal(Entry.progress.getAttribute('aria-valuetext'), Measure.title);
		}
	});
});
