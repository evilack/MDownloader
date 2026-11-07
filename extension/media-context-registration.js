/** 승인된 문서에서 첫 카드 호버 전에 격리된 플레이어 문맥 관측기를 준비합니다. */
import { CreateContentScriptSync } from './lib/content-script-registration.js';
export const SyncMediaContext = CreateContentScriptSync([
	{ id: 'mdownloader-media-context', js: ['data/page-policy.js', 'media-context-page.js'] },
]);
