/** 감지 목록과 다운로드 관리자가 같은 번역·색상·크기로 라이브 상태를 표시합니다. */
import { Translate } from './lib/i18n.js';
import { CreateElement } from './lib/ui.js';
export function CreateLiveBadge(bLive)
{
	const Badge = CreateElement('span', Translate('view_stream_live'), 'media-live');
	Badge.hidden = !bLive;
	return Badge;
}
