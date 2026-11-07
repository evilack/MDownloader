/**
 * 탭 URL의 스냅샷을 요청 시작 시점에 고정합니다. SPA 이동은 documentId를 바꾸지 않으므로
 * 응답 시점의 현재 URL을 사용하면 이전 방송의 늦은 응답이 새 페이지에 섞입니다.
 * URL이 알려진 탭에서는 추가 API 조회 없이 재사용하고, 워커 재시작 후 첫 조회만 합칩니다.
 */
export function CreateMediaPageScopes(ReadPage)
{
	const Pages = new Map();
	return {
		update(TabId, Page)
		{
			Pages.set(TabId, { page: Page });
		},
		capture(TabId)
		{
			const Current = Pages.get(TabId);
			if (Current)
			{
				return Current.promise ?? Promise.resolve(Current);
			}
			const Ticket = {};
			Ticket.promise = (async () =>
			{
				try
				{
					const Page = await ReadPage(TabId);
					if (Pages.get(TabId) !== Ticket)
					{
						return { stale: true };
					}
					if (!Page)
					{
						Pages.delete(TabId);
						return undefined;
					}
					const Scope = { page: Page };
					Pages.set(TabId, Scope);
					return Scope;
				}
				catch
				{
					if (Pages.get(TabId) === Ticket)
					{
						Pages.delete(TabId);
					}
					return undefined;
				}
			})();
			Pages.set(TabId, Ticket);
			return Ticket.promise;
		},
		forget(TabId)
		{
			if (TabId === undefined)
			{
				Pages.clear();
			}
			else
			{
				Pages.delete(TabId);
			}
		},
	};
}
