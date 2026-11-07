/** 모듈 정책을 MAIN/ISOLATED의 클래식 실행 경계로 전달하는 배포 파일을 생성합니다.
 * --check는 파일을 변경하지 않고 소스와 배포 정책이 같은지 확인합니다. */
import {readFile as ReadFile, writeFile as WriteFile} from 'node:fs/promises';
import {PagePolicy} from '../../extension/lib/runtime-policy.js';
const File = new URL('../../extension/data/page-policy.js', import.meta.url);
const Source = '/** 자동 생성: tools/build/build-page-policy.mjs. 원본 정책은 lib/runtime-policy.js입니다. */\n' +
'globalThis.MDownloaderPagePolicy = Object.freeze(' + JSON.stringify(PagePolicy, null, '\t') + ');\n';
if (process.argv.includes('--check'))
{
	if (await ReadFile(File, 'utf8') !== Source)
	{
		throw new Error('Page policy is out of date');
	}
}
else
{
	await WriteFile(File, Source);
}
