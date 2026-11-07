import {test as Test} from 'node:test';
import Assert from 'node:assert/strict';
import {CreateMediaPageScopes} from '../extension/lib/media-page-scope.js';
Test('freezes the known starting page and coalesces only the first tab lookup', async () =>
{
	let Reads = 0;
	const Ready = Promise.withResolvers();
	const Scopes = CreateMediaPageScopes(async() =>
	{
		Reads++;
		return Ready.promise;
	});
	const A = Scopes.capture(1), B = Scopes.capture(1);
	Assert.equal(Reads, 1);
	Ready.resolve('https://site.test/A');
	Assert.equal((await A).page, 'https://site.test/A');
	Assert.equal((await B).page, 'https://site.test/A');
	const Old = Scopes.capture(1);
	Scopes.update(1, 'https://site.test/B');
	Assert.equal((await Old).page, 'https://site.test/A');
	Assert.equal((await Scopes.capture(1)).page, 'https://site.test/B');
});
Test('discards an initial lookup overtaken by navigation without replacing the current page', async () =>
{
	const Ready = Promise.withResolvers();
	const Scopes = CreateMediaPageScopes(() => Ready.promise);
	const Initial = Scopes.capture(2);
	Scopes.update(2, 'https://site.test/B');
	Ready.resolve('https://site.test/A');
	Assert.equal((await Initial).stale, true);
	Assert.equal((await Scopes.capture(2)).page, 'https://site.test/B');
});
