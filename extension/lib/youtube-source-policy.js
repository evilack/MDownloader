import {CanUseYoutube} from './distribution-policy.js';
import {LocalizedError} from './i18n.js';
export const YoutubeDomains = Object.freeze(['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com']);
function YoutubeHost(Value)
{
	try
	{
		const Url = new URL(Value);
		if (Url.protocol === 'blob:') return YoutubeHost(Url.pathname);
		return ['https:', 'http:'].includes(Url.protocol) && YoutubeDomains.some(Domain => Url.hostname === Domain || Url.hostname.endsWith('.' + Domain));
	}
	catch { return false; }
}

/** 주소의 쿼리에 포함된 다른 주소를 따라가지 않습니다. */
export function IdentifyYoutubeUrl(Value)
{
	try
	{
		const Url = new URL(Value);
		if (!YoutubeHost(Value) || Url.username || Url.password) return null;
		const Parts = Url.pathname.split('/').filter(Boolean);
		const Id = Url.hostname === 'youtu.be' ? Parts[0] : Url.pathname === '/watch' ? Url.searchParams.get('v') : ['shorts', 'embed'].includes(Parts[0]) ? Parts[1] : null;
		return /^[\w-]{11}$/.test(Id ?? '') ? {videoId: Id, canonicalUrl: 'https://www.youtube.com/watch?v=' + Id} : null;
	}
	catch { return null; }
}

export function IsYoutubeSource({pageUrl, frameUrl, mediaUrl} = {})
{
	return [pageUrl, frameUrl, mediaUrl].some(YoutubeHost);
}

/** 신뢰된 문서 출처와 최종 URL을 함께 검사합니다. provider 표시는 권한이 아닙니다. */
export function YoutubeSourceBlocked(Source = {})
{
	if (CanUseYoutube()) return false;
	if (Source.youtubeSource === true) return true;
	const Values = [Source.url, Source.finalUrl, Source.pageUrl, Source.frameUrl, Source.mediaUrl,
		Source.page, Source.previewPage, Source.initiator, Source.documentUrl, Source.declaredPage,
		Source.requestContext?.pageUrl, Source.requestContext?.origin, Source.requestContext?.referer, Source.requestContext?.serverOrigin];
	return Values.some(YoutubeHost) || (Source.variants ?? []).some(YoutubeHost) ||
		(Source.observedVariants ?? []).some(Item => YoutubeSourceBlocked(Item));
}

export function AssertMediaAllowed(Source)
{
	if (YoutubeSourceBlocked(Source)) throw new LocalizedError('youtube_distribution_disabled');
}

export function AssertJobMayRestart(Job)
{
	AssertMediaAllowed(Job);
	// 이전 기록은 신뢰된 출처 분류가 없으므로 스토어판에서 재수신하지 않습니다.
	if (!CanUseYoutube() && Job?.sourcePolicyVersion !== 1) throw new LocalizedError('youtube_distribution_disabled');
}
