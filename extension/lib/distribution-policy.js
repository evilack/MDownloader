/** 배포 도구가 이 상수만 생성합니다. 저장소/원격 설정은 정책 입력이 아닙니다. */
export const DistributionPolicy = Object.freeze({flavor: 'development', youtubeEnabled: true, blockedBrowserFamilies: Object.freeze([])});

export function BrowserFamily(Environment = globalThis.navigator ?? {})
{
	const Brands = Environment.userAgentData?.brands?.map(Item => Item.brand.toLowerCase()) ?? [];
	if (Brands.some(Brand => Brand.includes('edge'))) return 'edge';
	if (Brands.some(Brand => Brand === 'google chrome')) return 'chrome';
	const Agent = Environment.userAgent ?? '';
	if (/Edg\//.test(Agent)) return 'edge';
	if (/Chrome\//.test(Agent) && !/OPR\//.test(Agent)) return 'chrome';
	return 'unknown';
}

export function CanUseYoutube(Policy = DistributionPolicy, Family = BrowserFamily())
{
	if (!['development', 'manual'].includes(Policy.flavor) || Policy.youtubeEnabled !== true) return false;
	const Blocked = Policy.blockedBrowserFamilies ?? [];
	return !Blocked.includes(Family) && !(Blocked.length && Family === 'unknown');
}
