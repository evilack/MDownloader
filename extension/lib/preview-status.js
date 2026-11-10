/** 미리보기 재생 실패 표시는 모든 화면이 같은 이미지·번역·접근성 이름을 사용합니다. */
import { Translate } from './i18n.js';
import { CreateElement } from './ui.js';
import { IconCatalog } from './icon-catalog.js';
export function CreatePreviewStatus(Host)
{
	const Marker = CreateElement('span', '', 'candidate-preview-stale');
	const Label = Translate('view_preview_playback_failed');
	Marker.setAttribute('role', 'img');
	Marker.setAttribute('aria-label', Label);
	Marker.hidden = true;
	const Icon = CreateElement('img');
	Icon.src = IconCatalog.previewFailure.src;
	Icon.srcset = IconCatalog.previewFailure.srcset;
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
