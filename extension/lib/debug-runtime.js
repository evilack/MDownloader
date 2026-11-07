/**
 * storage가 있는 확장 문맥에서만 설정을 구독합니다. 오프스크린은 기존 작업 메시지의
 * debugLogging 값을 적용하므로 storage API나 로그용 폴링을 사용하지 않습니다.
 * 캐시는 문맥당 하나이며 워커가 재시작되면 영속 옵션을 다시 읽습니다.
 */
import { CreateSettingsCache, SettingKeys } from './settings.js';
import { DebugLog } from './debug-log.js';
let Cache;
export function InitializeDebugLogging(OnChanged)
{
	if (!Cache && globalThis.chrome?.storage?.local)
	{
		Cache = CreateSettingsCache([SettingKeys.debugLogging], chrome.storage, (_Key, bEnabled) =>
		{
			DebugLog.SetEnabled(bEnabled);
			// 옵션 변경 통지는 오류를 실제 기능에 전달하지 않습니다. OFF에서는 로그 메시지를 보내지 않습니다.
			void OnChanged?.(bEnabled)?.catch(() =>
			{
			});
		});
	}
	return Cache?.Ready.catch(() =>
	{
	}) ?? Promise.resolve();
}

export async function DebugConfiguration()
{
	await InitializeDebugLogging();
	return DebugLog.IsEnabled();
}
