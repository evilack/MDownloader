import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {CreateStreamTransfers} from '../extension/lib/stream-transfers.js';
import {CreateStreamWorkspaces} from '../extension/lib/stream-workspaces.js';
Test('finishes or cancels only the selected transfer and retains other running IDs', async () =>
{
	const Entries = new Map();
	const Transfers = CreateStreamTransfers(async (Job, Controller, Finish) =>
	{
		const Done = Promise.withResolvers();
		Entries.set(Job.requestId, {controller: Controller, finish: Finish, done: Done});
		await Done.promise;
	});
	Assert.equal(Transfers.start({requestId: 'a'}), true);
	Assert.equal(Transfers.start({requestId: 'b'}), true);
	Assert.equal(Transfers.start({requestId: 'a'}), false);
	Assert.deepEqual(Transfers.ids(), ['a', 'b']);
	Assert.equal(Transfers.finish('a'), true);
	Assert.equal(Entries.get('a').finish.aborted, true);
	Assert.equal(Entries.get('b').finish.aborted, false);
	Entries.get('a').done.resolve();
	await new Promise(Resolve => setImmediate(Resolve));
	Assert.deepEqual(Transfers.ids(), ['b']);
	Transfers.cancel('b');
	Assert.equal(Entries.get('b').controller.signal.aborted, true);
	Entries.get('b').done.resolve();
	await new Promise(Resolve => setImmediate(Resolve));
	Assert.deepEqual(Transfers.ids(), []);
});
Test('initializes scratch storage once and deletes only the selected completed workspace', async () =>
{
	const Folders = new Map([['orphan', {name: 'orphan'}]]), Removed = [];
	const Scratch = {async * values()
		{
			yield * Folders.values();
		}, async removeEntry(Name)
		{
			Removed.push(Name);
			Folders.delete(Name);
		},
		async getDirectoryHandle(Name)
		{
			if (!Folders.has(Name))
			{
				Folders.set(Name, {name: Name});
			}
			return Folders.get(Name);
		}};
	let Initializations = 0;
	const Store = CreateStreamWorkspaces('scratch', async() =>
	{
		Initializations++;
		return {getDirectoryHandle: async() => Scratch};
	});
	const [A, B] = await Promise.all([Store.create('a'), Store.create('b')]);
	Assert.equal(Initializations, 1);
	Assert.equal(A.name, 'a');
	Assert.equal(B.name, 'b');
	Assert.deepEqual(Removed, ['orphan']);
	await Store.release('a');
	Assert.equal(Folders.has('b'), true);
	const C = await Store.create('c');
	Assert.equal(C.name, 'c');
	Assert.equal(Folders.has('b'), true);
});
