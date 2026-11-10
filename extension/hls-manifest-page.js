/**
 * 페이지가 실제 재생 과정에서 받은 재생목록 응답을 관측합니다. 플레이어에 반환할 응답 본문은 복제해서 읽고, 전달할 주소와 크기를 제한합니다.
 */
(() =>
{
	const Key = Symbol.for('mdownloader.hls.manifest');
	if (window[Key])
	{
		return;
	}
	window[Key] = true;
	const Policy = globalThis.MDownloaderPagePolicy;
	if (!Policy)
	{
		return;
	}
	const MaxBytes = Policy.MaxManifestBytes;
	const Matches = Url => /\.(?:m3u8|mpd)(?:\?|$)/i.test(Url);
	function Publish(Url, TextValue, Page)
	{
		if (typeof TextValue !== 'string' || TextValue.length > MaxBytes)
		{
			return;
		}
		window.postMessage({ type: Policy.ManifestMessage, url: Url, text: TextValue, page: Page }, location.origin);
	}
	async function Read(HttpResponse, Page)
	{
		const Reader = HttpResponse.clone().body?.getReader();
		if (!Reader)
		{
			return;
		}
		const Decoder = new TextDecoder();
		let TextValue = '', Size = 0;
		try
		{
			for (; ; )
			{
				const { value: Value, done: Done } = await Reader.read();
				if (Done)
				{
					break;
				}
				Size += Value.byteLength;
				if (Size > MaxBytes)
				{
					await Reader.cancel();
					return;
				}
				TextValue += Decoder.decode(Value, { stream: true });
			}
			Publish(HttpResponse.url, TextValue + Decoder.decode(), Page);
		}
		finally
		{
			Reader.releaseLock();
		}
	}
	const FetchOriginal = window.fetch;
	window.fetch = function (...Args)
	{
		const Page = location.href;
		return FetchOriginal.apply(this, Args).then(HttpResponse =>
		{
			if (HttpResponse.status === 200 && Matches(HttpResponse.url) &&
			String(Args[1]?.method ?? Args[0]?.method ?? 'GET').toUpperCase() === 'GET')
			{
				void Read(HttpResponse, Page).catch(() =>
				{
				});
			}
			return HttpResponse;
		});
	};
	const OpenOriginal = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (Method, ...Args)
	{
		const Page = location.href;
		const Result = OpenOriginal.call(this, Method, ...Args);
		if (String(Method).toUpperCase() === 'GET')
		{
			this.addEventListener('loadend', () =>
			{
				if (this.status !== 200 || !Matches(this.responseURL))
				{
					return;
				}
				if (typeof this.response === 'string')
				{
					Publish(this.responseURL, this.response, Page);
				}
				if (this.response instanceof ArrayBuffer && this.response.byteLength <= MaxBytes)
				{
					Publish(this.responseURL, new TextDecoder().decode(this.response), Page);
				}
			}, { once: true });
		}
		return Result;
	};
})();
