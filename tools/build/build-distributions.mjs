/** Build sequentially: installer payload generation writes shared generated files. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const Root = fileURLToPath(new URL('../../', import.meta.url));
for (const Flavor of ['chrome-store', 'development']) {
 const Result = spawnSync(process.execPath, ['tools/build/package-extension.mjs', '--flavor', Flavor], {cwd: Root, stdio: 'inherit'});
 if (Result.error) throw Result.error;
 if (Result.status !== 0) process.exit(Result.status ?? 1);
}
