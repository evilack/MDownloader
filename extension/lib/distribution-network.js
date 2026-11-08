import {CanUseYoutube} from './distribution-policy.js';
import {YoutubeDomains} from './youtube-source-policy.js';
let Preparing;
/** 브라우저 다운로드의 리디렉션도 확장 출처의 고정 차단 규칙을 적용받습니다.
 * 사이트 탭의 일반 재생 요청과 다른 확장의 요청에는 적용하지 않습니다. */
export function PrepareDistributionNetwork()
{
	if (CanUseYoutube()) return Promise.resolve();
	return Preparing ??= chrome.declarativeNetRequest.updateSessionRules({
		removeRuleIds: [2147000000],
		addRules: [{id: 2147000000, priority: 1000000, action: {type: 'block'},
			condition: {initiatorDomains: [chrome.runtime.id], requestDomains: [...YoutubeDomains]}}],
	}).catch(ErrorValue => { Preparing = undefined; throw ErrorValue; });
}
