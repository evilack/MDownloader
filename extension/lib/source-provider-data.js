/** 공급자별 선언 형식은 데이터 파일로 관리하고 문서/네트워크 관측기에서 함께 사용합니다. */
let ProvidersPromise;
export function LoadSourceProviders()
{
	if (!ProvidersPromise)
	{
		ProvidersPromise = (async () =>
		{
			const Response = await fetch(chrome.runtime.getURL('data/source-providers.json'));
			if (!Response.ok)
			{
				throw new Error('Source provider data is unavailable');
			}
			return Response.json();
		})().catch(ErrorValue =>
		{
			ProvidersPromise = undefined;
			throw ErrorValue;
		});
	}
	return ProvidersPromise;
}
