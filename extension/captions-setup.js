import {NavigateToHelper} from './options-helper-navigation.js';
import {InitializeLocale,GetLocale} from './lib/i18n.js';
await InitializeLocale();
const Ko=GetLocale().startsWith('ko'),Button=document.querySelector('#setup-install'),Status=document.querySelector('#setup-status');
Button.disabled=false;Button.textContent=Ko?'도우미 탭 열기':'Open Helper tab';
Status.textContent=Ko?'설치·삭제·진단은 설정의 도우미 탭에서 관리합니다.':'Manage installation, removal and diagnostics from the Helper tab in Settings.';
Button.addEventListener('click',NavigateToHelper);