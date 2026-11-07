import {RuntimePolicy} from './runtime-policy.js';

/** 워커의 네트워크 요청이 문서 이벤트에 보이지 않아도 열린 목록의 선택 소스를
 * 다시 확인합니다. 숨은 화면에서는 요청하지 않고, 목록을 닫으면 타이머를 정리합니다.
 */
export function StartVisibleSourceRefresh(Notify)
{
	let Timer;
	let bDisposed = false;
	function Schedule()
	{
		clearTimeout(Timer);
		Timer = undefined;
		if (bDisposed || document.hidden)
		{
			return;
		}
		Timer = setTimeout(() =>
		{
			Timer = undefined;
			try
			{
				if (!document.hidden)
				{
					Notify();
				}
			}
			finally
			{
				Schedule();
			}
		}, RuntimePolicy.Detection.SourceRefreshMs);
	}
	document.addEventListener('visibilitychange', Schedule);
	Schedule();
	return () =>
	{
		bDisposed = true;
		clearTimeout(Timer);
		document.removeEventListener('visibilitychange', Schedule);
	};
}
