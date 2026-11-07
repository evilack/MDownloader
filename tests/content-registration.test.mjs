import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {CreateContentScriptSync} from '../extension/lib/content-script-registration.js';
Test('synchronizes script contracts once, including worlds, files and lifecycle attributes', async () =>
{
	const Registered = new Map([['one', {id: 'one', matches: ['https://example.test/*'], js: ['old.js'], world: 'MAIN', allFrames: true, runAt: 'document_start'}]]);
	const Updates = [];
	const Api = {
		permissions: {getAll: async () => ({origins: ['https://example.test/*']})},
		scripting: {
			getRegisteredContentScripts: async () => [...Registered.values()],
			updateContentScripts: async Scripts =>
			{
				Updates.push(Scripts);
				for (const Script of Scripts)
				{
					Registered.set(Script.id, Script);
				}
			},
			registerContentScripts: async Scripts =>
			{
				for (const Script of Scripts)
				{
					Registered.set(Script.id, Script);
				}
			},
			unregisterContentScripts: async ({ids: Ids}) =>
			{
				for (const Id of Ids)
				{
					Registered.delete(Id);
				}
			},
		},
	};
	const Sync = CreateContentScriptSync([{id: 'one', js: ['new.js'], world: 'ISOLATED'}], Api);
	await Promise.all([Sync(), Sync()]);
	Assert.equal(Updates.length, 1);
	Assert.deepEqual(Registered.get('one').js, ['new.js']);
	Assert.equal(Registered.get('one').world, 'ISOLATED');
	Api.permissions.getAll = async () => ({origins: []});
	await Sync();
	Assert.equal(Registered.size, 0);
});
