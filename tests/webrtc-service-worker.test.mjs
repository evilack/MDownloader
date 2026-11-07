import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {spawnSync as SpawnSync} from 'node:child_process';
import {fileURLToPath as FileURLToPath} from 'node:url';

Test('WebRTC Shift quality lookup works when the service worker disallows dynamic import', () =>
{
	const Result = SpawnSync(process.execPath, ['--experimental-vm-modules',
		FileURLToPath(new URL('helpers/webrtc-quality-service-worker.mjs', import.meta.url))], {encoding: 'utf8', timeout: 10000});
	Assert.equal(Result.status, 0, Result.stderr || Result.error?.message);
	Assert.match(Result.stdout, /lookup passed with dynamic import disabled/);
});
