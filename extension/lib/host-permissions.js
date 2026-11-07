/**
 * 사용자가 실제로 허용한 HTTP(S) 호스트만 동적 관측 스크립트의 적용 범위로 만듭니다.
 * 전체 사이트 패턴이 있으면 그 안에 포함되는 개별 패턴을 중복 등록하지 않습니다.
 */
export function GrantedHttpPatterns(Origins = [])
{
	const Unique = new Set(Origins);
	return [...Unique].filter(Origin => /^(https?|\*):\/\//.test(Origin))
	.filter(Origin => !Unique.has(Origin.split(':', 1)[0] + '://*/*') || Origin.endsWith('://*/*'))
	.sort();
}
