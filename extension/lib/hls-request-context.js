import {RuntimePolicy} from './runtime-policy.js';
import { DebugLog } from './debug-log.js';
/**
 * 성공한 재생 요청에서 관측한 출처 헤더를 해당 전송 작업의 정확한 주소에 다시 적용합니다.
 * 호스트 접근 권한과 요청 문맥은 워커가 확인하며 작업이 끝나면 세션 규칙을 제거합니다.
 */
import { LocalizedError } from './i18n.js';
const FirstHeaderRuleId = RuntimePolicy.Transfer.FirstHeaderRuleId;
const MaxHeaderRules = RuntimePolicy.Transfer.MaxHeaderRules;
const OwnersKey = 'hls-header-owners';
let Updates = Promise.resolve();
export function ValidHlsRequestContext(Context)
{
	try
	{
		const Origin = new URL(Context.origin);
		const Server = new URL(Context.serverOrigin);
		const Referer = new URL(Context.referer);
		// 실제 Referer는 사이트 정책에 따라 전체 페이지 또는 출처만 포함합니다.
		// 페이지와 출처가 다르거나 사용자 정보·프래그먼트가 섞인 문맥은 사용하지 않습니다.
		return [Origin, Server, Referer].every(Url => ['http:', 'https:'].includes(Url.protocol) && !Url.username && !Url.password) &&
		Origin.origin === Context.origin && Server.origin === Context.serverOrigin &&
		Referer.origin === Origin.origin && !Referer.hash;
	}
	catch
	{
		return false;
	}
}

export function HlsRequestSource(Address, Context)
{
	return Context ? Address + '\n' + Context.origin + '\n' + Context.referer : Address;
}

export function SetHlsRequestRules(Context, Urls = [], RequestId)
{
	// DNR의 읽기/갱신은 한 트랜잭션이 아닙니다. 작업 A/B가 동시에 새 조각을 준비해도
	// 이전 소유권 스냅샷으로 서로의 규칙을 덮어쓰지 않도록 워커 안에서 순서대로 처리합니다.
	const Update = Updates.catch(() =>
	{
	}).then(() => UpdateRules(Context, Urls, RequestId));
	Updates = Update;
	return Update;
}

/** 다른 CDN에는 관측하지 않은 헤더를 복사하지 않습니다. 해당 주소는 일반
 * 권한 확인을 거친 정상 요청으로 읽고, 이 문맥의 정확한 CDN 주소에만 규칙을 만듭니다.
 */
export function SetScopedHlsRequestRules(Context, Urls, RequestId)
{
	if (!ValidHlsRequestContext(Context))
	{
		throw new LocalizedError('headers_reuse_denied');
	}
	return SetHlsRequestRules(Context, Urls.filter(Address => new URL(Address).origin === Context.serverOrigin), RequestId);
}

async function UpdateRules(Context, Urls, RequestId)
{
	if (Urls.length && !ValidHlsRequestContext(Context))
	{
		throw new LocalizedError('headers_reuse_denied');
	}
	if (Urls.length && (typeof RequestId !== 'string' || !RequestId))
	{
		throw new LocalizedError('headers_reuse_denied');
	}
	const Stored = (await chrome.storage.session.get(OwnersKey))[OwnersKey] ?? {};
	// 무인자 호출은 확장 설치/업데이트 때만 전체 초기화합니다. 전송 문서는 항상 자기 작업 ID를 보냅니다.
	const Owners = RequestId === undefined ? {} : { ...Stored };
	if (RequestId !== undefined)
	{
		if (Urls.length)
		{
			Owners[RequestId] = { context: Context, urls: [...new Set(Urls)] };
		}
		else
		{
			delete Owners[RequestId];
		}
	}
	const Resources = new Map();
	for (const Owner of Object.values(Owners))
	{
		if (!ValidHlsRequestContext(Owner.context))
		{
			throw new LocalizedError('headers_reuse_denied');
		}
		for (const Address of Owner.urls)
		{
			const Previous = Resources.get(Address);
			// 한 오프스크린 출처의 동일 URL에는 서로 다른 Referer를 동시에 적용할 수 없습니다.
			// 문맥이 충돌하면 새 작업만 거절하고 이미 실행 중인 작업의 규칙은 그대로 둡니다.
			if (Previous && (Previous.origin !== Owner.context.origin || Previous.referer !== Owner.context.referer))
			{
				throw new LocalizedError('headers_reuse_denied');
			}
			Resources.set(Address, Owner.context);
		}
	}
	if (Resources.size > MaxHeaderRules)
	{
		throw new LocalizedError('headers_too_many');
	}
	const Api = chrome.declarativeNetRequest;
	const RemoveRuleIds = (await Api.getSessionRules())
	.filter(Rule => Rule.id >= FirstHeaderRuleId && Rule.id < FirstHeaderRuleId + MaxHeaderRules)
	.map(Rule => Rule.id);
	const AddRules = [...Resources].map(([Address, Context], Index) =>
	{
		const Url = new URL(Address);
		if (Url.origin !== Context.serverOrigin || Url.hash || /[^\x20-\x7e]|[|*^]/.test(Url.href))
		{
			throw new LocalizedError('headers_url_outside_cdn');
		}
		return {
			id: FirstHeaderRuleId + Index,
			priority: 1,
			condition: {
				urlFilter: '|' + Url.href + '|', isUrlFilterCaseSensitive: true,
				requestDomains: [Url.hostname], initiatorDomains: [chrome.runtime.id],
				requestMethods: ['get'], resourceTypes: ['xmlhttprequest'],
			},
			action: {
				type: 'modifyHeaders',
				requestHeaders: [
					{ header: 'Referer', operation: 'set', value: Context.referer },
					{ header: 'Origin', operation: 'set', value: Context.origin },
				],
			},
		};
	});
	if (RemoveRuleIds.length || AddRules.length)
	{
		await Api.updateSessionRules({ removeRuleIds: RemoveRuleIds, addRules: AddRules });
	}
	// 성공한 규칙의 소유권만 세션에 기록합니다. 워커가 재시작돼도 다른 작업의 규칙을 복원할 수 있습니다.
	await chrome.storage.session.set({ [OwnersKey]: Owners });
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('RulesUpdated', () => ({ rules: AddRules.length, owners: Object.keys(Owners).length, bObservedContext: !!Context }));
	}
}
