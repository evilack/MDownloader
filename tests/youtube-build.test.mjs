import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {existsSync} from 'node:fs';
import {mkdtemp, mkdir, cp, symlink, readFile, writeFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import Path from 'node:path';
import {fileURLToPath} from 'node:url';

const Project = fileURLToPath(new URL('../', import.meta.url));
Test('vendor build succeeds with only dependencies reachable from the package manifest',
	{skip: !existsSync(Path.join(Project, 'node_modules/esbuild'))}, async T =>
{
	const Root = await mkdtemp(Path.join(tmpdir(), 'mdownloader-vendor-build-'));
	T.after(async () =>
	{
		Assert.ok(Root.startsWith(Path.resolve(tmpdir()) + Path.sep));
		await rm(Root, {recursive: true, force: true});
	});
	const Manifest = JSON.parse(await readFile(Path.join(Project, 'package.json'), 'utf8'));
	const Lock = JSON.parse(await readFile(Path.join(Project, 'package-lock.json'), 'utf8'));
	const Pending = [...Object.keys(Manifest.dependencies), ...Object.keys(Manifest.devDependencies)];
	const Reachable = new Set();
	while (Pending.length)
	{
		const Name = Pending.pop();
		if (Reachable.has(Name)) continue;
		Reachable.add(Name);
		const Package = Lock.packages['node_modules/' + Name];
		Assert.ok(Package, 'Missing locked dependency: ' + Name);
		Pending.push(...Object.keys(Package.dependencies ?? {}), ...Object.keys(Package.optionalDependencies ?? {}));
		const Installed = Path.join(Project, 'node_modules', Name);
		if (!existsSync(Installed)) continue;
		const Link = Path.join(Root, 'node_modules', Name);
		await mkdir(Path.dirname(Link), {recursive: true});
		await symlink(Installed, Link, process.platform === 'win32' ? 'junction' : 'dir');
	}
	Lock.packages = Object.fromEntries(Object.entries(Lock.packages).filter(([Name]) =>
		Name === '' || Reachable.has(Name.replace(/^node_modules\//, ''))));
	await writeFile(Path.join(Root, 'package-lock.json'), JSON.stringify(Lock));
	for (const File of ['tools/build/build-youtube.mjs', 'tools/build/youtube-client-entry.mjs',
		'tools/build/youtube-sabr-entry.mjs', 'extension/vendor/youtube/bufbuild-protobuf-LICENSE-APACHE'])
	{
		await mkdir(Path.dirname(Path.join(Root, File)), {recursive: true});
		await cp(Path.join(Project, File), Path.join(Root, File));
	}
	const Result = spawnSync(process.execPath, ['tools/build/build-youtube.mjs'], {cwd: Root, encoding: 'utf8'});
	Assert.equal(Result.status, 0, Result.stderr);
	const Provenance = JSON.parse(await readFile(Path.join(Root, 'extension/vendor/youtube/provenance.json'), 'utf8'));
	Assert.ok(Provenance.files['client-bundle.mjs']);
	Assert.ok(Provenance.files['sabr-bundle.mjs']);
});
