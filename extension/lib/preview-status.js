/** 미리보기 재생 실패 표시는 모든 화면이 같은 이미지·번역·접근성 이름을 사용합니다. */
import { Translate } from './i18n.js';
import { CreateElement } from './ui.js';
const StatusIcon = Object.freeze({
	Source: 'icons/preview-stale-16.png',
	SourceSet: 'icons/preview-stale-32.png 2x, icons/preview-stale-48.png 3x',
});
export function CreatePreviewStatus(Host)
{
	const Marker = CreateElement('span', '', 'candidate-preview-stale');
	const Label = Translate('view_preview_playback_failed');
	Marker.setAttribute('role', 'img');
	Marker.setAttribute('aria-label', Label);
	Marker.hidden = true;
	const Icon = CreateElement('img');
	Icon.src = StatusIcon.Source;
	Icon.srcset = StatusIcon.SourceSet;
	Icon.alt = '';
	Marker.append(Icon);
	return {
		node: Marker,
		setFailed(bFailed)
		{
			Marker.hidden = !bFailed;
			if (bFailed)
			{
				Host.title = Label;
			}
			else
			{
				Host.removeAttribute('title');
			}
		},
	};
}
