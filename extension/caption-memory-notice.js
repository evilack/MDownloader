import {CreateElement} from './lib/ui.js';
import {GetLocale} from './lib/i18n.js';

/** Shared, persistent guidance; this is not a detected out-of-memory error. */
export function CreateCaptionMemoryNotice(){
 const Ko=GetLocale().startsWith('ko'),Notice=CreateElement('div','','caption-memory-notice');
 Notice.id='caption-memory-notice-'+crypto.randomUUID();Notice.setAttribute('role','note');
 Notice.append(
  CreateElement('strong',Ko?'메모리 사용 주의':'High memory usage','caption-memory-notice-title'),
  CreateElement('p',Ko?'메모리를 많이 사용합니다. 메모리가 부족할 수도 있습니다.':'Speech recognition uses a lot of memory. Available memory may be insufficient.','caption-memory-notice-description')
 );
 return Notice;
}
