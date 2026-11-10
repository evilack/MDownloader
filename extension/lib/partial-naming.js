import {SafeFilename} from './download-folder.js';
import {RuntimePolicy} from './runtime-policy.js';
import {LocalizedError} from './i18n.js';

/** 부분 파일은 원래 이름을 보존하면서 별도 접미사·저장 시각으로 구분합니다. */
export function PartialFilename(Filename, At = new Date())
{
	const Dot = Filename.lastIndexOf('.');
	const Stem = Dot > 0 ? Filename.slice(0, Dot) : Filename;
	const Extension = Dot > 0 ? Filename.slice(Dot) : '.mp4';
	const Suffix = RuntimePolicy.Filename.TitleSeparator + SafeFilename(RuntimePolicy.Filename.PartialStem + Extension, '', At);
	// 등록 때 확정한 도메인·이름을 일반 제목으로 다시 조합하거나 100자로 자르지 않습니다.
	return Stem.slice(0, RuntimePolicy.Filename.MaxNameLength - Suffix.length).replace(/[\uD800-\uDBFF]+$/, '') + Suffix;
}

export function PartialOutputFilename(Filename, Extension)
{
	if (!/^\.[a-z0-9]{1,8}$/.test(Extension))
	{
		throw new LocalizedError('job_snapshot_codecs');
	}
	const Stem = Filename.replace(/\.[^.]*$/, '');
	return Stem.slice(0, RuntimePolicy.Filename.MaxNameLength - Extension.length).replace(/[\uD800-\uDBFF]+$/, '') + Extension;
}
