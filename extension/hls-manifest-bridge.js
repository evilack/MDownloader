/**
 * 페이지 스크립트에서 관측한 재생목록을 확장으로 전달하는 통로입니다. 일반 페이지도 메시지를 보낼 수 있으므로 발신 창, 주소, 본문 크기를 확인한 뒤 전달합니다.
 */
(() =>
{
	if (globalThis.mdownloaderManifestBridge)
	{
		return;
	}
	globalThis.mdownloaderManifestBridge = true;
	const Policy = globalThis.MDownloaderPagePolicy;
	if (!Policy)
	{
		return;
	}
	const {MaxManifestUrlChars, MaxManifestBytes: MaxManifestTextChars, ManifestMessage} = Policy;
	window.addEventListener('message', UiEvent =>
	{
		if (UiEvent.source !== window || UiEvent.origin !== location.origin)
		{
			return;
		}
		const { type: Type, url: Url, text: TextValue, page: Page } = UiEvent.data ?? {};
		// 페이지에서 보낸 메시지는 확장으로 넘어오기 전에 크기를 제한합니다.
		// 페이지 자체가 같은 형태의 메시지를 보낼 수 있어 워커에서도 발신 정보를 다시 검사합니다.
		if (Type !== ManifestMessage || typeof Url !== 'string' || Url.length > MaxManifestUrlChars ||
		typeof TextValue !== 'string' || TextValue.length > MaxManifestTextChars)
		{
			return;
		}
		if (typeof Page !== 'string' || Page.length > MaxManifestUrlChars)
		{
			return;
		}
		try
		{
			if (new URL(Page).origin !== location.origin)
			{
				return;
			}
		}
		catch
		{
			return;
		}
		void chrome.runtime.sendMessage({ type: Type, url: Url, text: TextValue, page: Page }).catch(() =>
		{
		});
	});
})();
