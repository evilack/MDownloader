import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import Path from 'node:path';
import {ResolveToolConfig} from '../tools/lib/tool-config.mjs';
import {CapturePlan} from '../tools/lib/capture-extension.mjs';
Test('tool configuration derives portable paths and validates injected preview endpoints', () =>
{
	const Config = ResolveToolConfig({MDOWNLOADER_ROOT: Path.resolve('some path'), MDOWNLOADER_PREVIEW_PORT: '4512'});
	Assert.equal(Config.root, Path.resolve('some path'));
	Assert.equal(Config.previewUrl, 'http://127.0.0.1:4512/');
	Assert.equal(Config.websiteRoot, Path.join(Config.root, 'website'));
	Assert.throws(() => ResolveToolConfig({MDOWNLOADER_PREVIEW_PORT: 'invalid'}), /port/i);
	Assert.throws(() => ResolveToolConfig({MDOWNLOADER_PREVIEW_URL: 'file:///secret'}), /HTTP/i);
});
Test('capture presets share one engine while separating every output directory', () =>
{
	const Plans = ['aligned', 'english', 'manager', 'website'].map(Name => CapturePlan(Name, 'test-run'));
	Assert.equal(new Set(Plans.map(Plan => Plan.output)).size, Plans.length);
	Assert.equal(Plans[1].locale, 'en');
	Assert.equal(Plans[3].nativePanel, true);
	Assert.throws(() => CapturePlan('unrecognized'), TypeError);
});
