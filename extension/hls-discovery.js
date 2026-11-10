/**
 * 승인된 사이트에서 재생목록 관측 스크립트를 등록합니다. 이미 등록된 스크립트 ID는 확장 업데이트 후에도 남으므로 호환되지 않는 이전 등록부터 정리합니다.
 */
import { CreateContentScriptSync } from './lib/content-script-registration.js';
const LegacyScriptIds = ['mdownloader-playback-observer', 'mdownloader-playback-bridge'];
const Scripts = [
	{ id: 'mdownloader-manifest-page', world: 'MAIN', js: ['data/main-page-policy.js', 'hls-manifest-page.js'] },
	{ id: 'mdownloader-manifest-bridge', world: 'ISOLATED', js: ['data/page-policy.js', 'hls-manifest-bridge.js'] },
];
export async function MigrateHlsDiscovery()
{
	// Chrome은 업데이트 후에도 동적 스크립트 등록을 유지합니다.
	// 예전 버전의 전송용 스크립트를 제거한 뒤 현재 관측용 스크립트를 등록합니다.
	const Legacy = await chrome.scripting.getRegisteredContentScripts({ ids: LegacyScriptIds });
	if (Legacy.length)
	{
		await chrome.scripting.unregisterContentScripts({ ids: Legacy.map(Script => Script.id) });
	}
	await SyncHlsDiscovery();
}

export const SyncHlsDiscovery = CreateContentScriptSync(Scripts);
