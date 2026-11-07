/**
 * Chrome 개발자 도구에 재생 데이터 수집 페이지를 등록하는 진입점입니다. 수집과 저장은 해당 페이지와 백그라운드 워커에서 수행합니다.
 */
import { InitializeLocale, Translate } from './lib/i18n.js';
await InitializeLocale();
chrome.devtools.panels.create(Translate('view_devtools_panel'), '', 'playback.html');
