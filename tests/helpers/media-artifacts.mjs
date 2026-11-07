/** 선택적으로 보관하는 재생 표본은 문서 원본과 분리합니다. 기본 검사에는 파일을
 * 남기지 않으며 명시적으로 켠 경우에도 Git에서 제외하는 실행별 폴더만 사용합니다. */
import {mkdir as Mkdir, writeFile as WriteFile} from 'node:fs/promises';
import {ArtifactPath} from '../../tools/lib/tool-config.mjs';
export async function WriteMediaArtifact(Name, Bytes)
{
	if (!process.env.MDOWNLOADER_WRITE_EVIDENCE)
	{
		return;
	}
	await Mkdir(ArtifactPath('test-media'), {recursive: true});
	await WriteFile(ArtifactPath('test-media', Name), Bytes);
}
