import { InitializeDebugLogging } from './lib/debug-runtime.js';
void InitializeDebugLogging();
/**
 * 툴바 팝업을 시작합니다. 언어를 적용한 뒤 미디어 목록을 열고, 상단 옵션 버튼과 사이드 패널 진입 버튼을 연결합니다.
 */
import { InitializeLocale, LocalizePage, Translate, WatchLanguage } from './lib/i18n.js';
import { MountOptionsButton } from './lib/ui.js';
import { CreateCandidateList } from './candidate-list.js';
import { CreateMediaPreview } from './media-preview.js';
await InitializeLocale();
LocalizePage();
WatchLanguage();
const Candidates = CreateCandidateList({
	root: document, mediaPreview: CreateMediaPreview(), scrollRoot: document.querySelector('main'),
});
MountOptionsButton(document.querySelector('.brand'), Candidates.announce);
document.querySelector('#manage').addEventListener('click', async () =>
{
	const WindowId = Candidates.tab?.windowId;
	if (WindowId === undefined || !chrome.sidePanel?.open)
	{
		Candidates.announce(Translate('view_panel_use_menu'));
		return;
	}
	try
	{
		await chrome.sidePanel.open({ windowId: WindowId });
		window.close();
	}
	catch
	{
		Candidates.announce(Translate('view_panel_failed'));
	}
});
Candidates.setEnabled(true);
