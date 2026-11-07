/**
 * 브라우저와 파일 시스템에서 사용할 저장 경로와 파일명을 정리합니다.
 * 폴더 경로와 파일명은 플랫폼 예약 이름을 같은 기준으로 검사합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
const InvalidName = /[\u0000-\u001f\u007f<>:"|?*]|[. ]$/;
const ReservedName = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;
export function NormalizeDownloadFolder(Value)
{
	if (typeof Value !== 'string')
	{
		return null;
	}
	const Relative = Value.trim().replaceAll('\\', '/');
	if (!Relative)
	{
		return '';
	}
	const Folder = Relative.replace(/\/$/, '');
	return Folder.split('/').every(Part => Part && Part.length <= RuntimePolicy.Filename.MaxFolderNameLength && !InvalidName.test(Part) && !ReservedName.test(Part))
	? Folder : null;
}

function CleanFilenamePart(TextValue)
{
	return TextValue.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/^[. ]+/, '');
}

function ShortenStem(TextValue, Length)
{
	return TextValue.slice(0, Length).replace(/[. \uD800-\uDBFF]+$/, '');
}

/** OS의 현지 시각을 파일명에 안전한 형태로 고정합니다. UTC 변환이나 로캘별 날짜 순서에 영향을 받지 않습니다. */
function FilenameDateTime(StartedAt)
{
	if (!(StartedAt instanceof Date) || !Number.isFinite(StartedAt.getTime()))
	{
		return '';
	}
	const Pad = Value => String(Value).padStart(2, '0');
	const DatePart = [StartedAt.getFullYear(), Pad(StartedAt.getMonth() + 1), Pad(StartedAt.getDate())].join('-');
	const TimePart = [StartedAt.getHours(), StartedAt.getMinutes(), StartedAt.getSeconds()].map(Pad).join('-');
	return DatePart + RuntimePolicy.Filename.TitleSeparator + TimePart;
}

export function SafeFilename(Name, PageTitle = '', StartedAt, FallbackExtension = '.mp4')
{
	// 날짜를 먼저 예약하여 긴 원본 이름을 줄여도 날짜·시각과 확장자는 끝까지 유지합니다.
	const Timestamp = FilenameDateTime(StartedAt);
	const Suffix = Timestamp ? RuntimePolicy.Filename.TitleSeparator + Timestamp : '';
	const StemBudget = RuntimePolicy.Filename.MaxStemLength - Suffix.length;
	const bHasOriginal = typeof Name === 'string' && Name.trim().length > 0;
	if (!bHasOriginal && !/^\.[a-z0-9]{1,8}$/.test(FallbackExtension))
	{
		throw new TypeError('Invalid output extension');
	}
	const Cleaned = bHasOriginal ? CleanFilenamePart(Name) : '';
	const Dot = Cleaned.lastIndexOf('.');
	const Extension = bHasOriginal ? Dot < 0 ? '' : Cleaned.slice(Dot) : FallbackExtension;
	const Original = bHasOriginal ? ShortenStem(Dot < 0 ? Cleaned : Cleaned.slice(0, Dot), StemBudget) || 'video' : '';
	const bIsIndex = Original.toLowerCase() === 'index';
	// 이름이 짧으면 원래 파일명 전체를 보존합니다. 길면 페이지 제목과 원본 이름 모두 들어갈 여유를 나눕니다.
	const CombinedBudget = StemBudget - RuntimePolicy.Filename.TitleSeparator.length;
	const Title = typeof PageTitle === 'string'
	? ShortenStem(CleanFilenamePart(PageTitle.trim()), !bHasOriginal || bIsIndex ? StemBudget : Math.max(RuntimePolicy.Filename.MinTitleBudget, CombinedBudget - Original.length))
	: '';
	let Stem = Original;
	if (Title)
	{
		// 이름 없는 스트림은 원래 파일명이 있는 것처럼 playback/WebRTC 같은 단어를 합치지 않습니다.
		Stem = !bHasOriginal || bIsIndex ? Title : Title + RuntimePolicy.Filename.TitleSeparator + ShortenStem(Original, CombinedBudget - Title.length);
	}
	const bReserved = ReservedName.test(Stem);
	return (bReserved ? '_' : '') + Stem + (Stem ? Suffix : Timestamp || 'video') + Extension;
}
