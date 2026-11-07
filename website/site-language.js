/** 정적 호스팅의 언어 경로를 공통으로 선택합니다. URL/수동 선택 → 저장 선택 → 브라우저 언어 → 영어 순서입니다. */
(() =>
{
	const StorageKey = 'ev-cabinet-language';
	const Families = {
		product: { ko: 'index-ko.html', en: 'index.html' },
		sample: { ko: 'index-ko.html', en: 'index.html' },
	};
	const Pages = Families[document.documentElement.dataset.page];
	if (!Pages)
	{
		return;
	}
	const Supported = Value => Value === 'ko' || Value === 'en' ? Value : null;
	function Remember(Language)
	{
		try
		{
			localStorage.setItem(StorageKey, Language);
		}
		catch
		{
			/* 저장소가 차단돼도 명시적인 언어 URL은 계속 동작합니다. */
		}
	}

	function PreferredLanguage()
	{
		const Explicit = Supported(new URL(location.href).searchParams.get('lang')?.toLowerCase());
		if (Explicit)
		{
			Remember(Explicit);
			return Explicit;
		}
		try
		{
			const Saved = Supported(localStorage.getItem(StorageKey));
			if (Saved)
			{
				return Saved;
			}
		}
		catch
		{
			/* 제한된 문맥이나 비공개 창에서는 브라우저 언어 확인을 계속합니다. */
		}
		try
		{
			const Languages = Array.isArray(navigator.languages) && navigator.languages.length
			? navigator.languages : [navigator.language];
			for (const Locale of Languages)
			{
				if (typeof Locale !== 'string')
				{
					continue;
				}
				const Language = Supported(Locale.toLowerCase().split('-')[0]);
				if (Language)
				{
					return Language;
				}
			}
		}
		catch
		{
			/* 언어 정보 자체를 읽지 못해도 영어를 기본값으로 사용합니다. */
		}
		return 'en';
	}

	function ApplyLanguage()
	{
		const Language = PreferredLanguage();
		if (document.documentElement.lang === Language)
		{
			return;
		}
		const Destination = new URL(Pages[Language], location.href);
		Destination.search = location.search;
		Destination.hash = location.hash;
		// 자동 이동은 기록을 교체해 뒤로 가기가 방문 전 페이지로 돌아가게 합니다.
		location.replace(Destination.href);
	}

	// 스타일·본문 전에 실행하여 잘못된 언어가 잠깐 보이지 않도록 합니다.
	ApplyLanguage();
	window.addEventListener('languagechange', ApplyLanguage);
	document.addEventListener('click', Event =>
	{
		const Link = Event.target instanceof Element ? Event.target.closest('a.language-link') : null;
		const Language = Link && Supported(Link.hreflang);
		if (Language)
		{
			Remember(Language);
		}
	});
})();
