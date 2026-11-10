/** 감지 목록과 다운로드 관리자가 같은 번역·색상·크기로 라이브 상태를 표시합니다. */
import { CreateElement } from './lib/ui.js';
import { IconCatalog } from './lib/icon-catalog.js';
export function CreateLiveBadge(bLive)
{
	const Badge = CreateElement('span', 'LIVE', 'media-live');
	Badge.lang = 'en';
	Badge.hidden = !bLive;
	return Badge;
}

/** Source identity is independent of the transfer phase and output filename. */
export function CreateSourceBadge(Source)
{
 if(Source.youtube || Source.youtubeSource || Source.format==='YOUTUBE')
 {
  const Icon=CreateElement('img','','youtube-icon');
  Icon.src=IconCatalog.brands.youtube; Icon.alt='YouTube'; Icon.title='YouTube'; Icon.width=20; Icon.height=20;
  return Icon;
 }
 if(Source.recording || Source.format==='WEBRTC') return CreateElement('span','WebRTC','candidate-format');
 if(Source.dvr && (Source.hls || Source.format==='M3U8')) return CreateElement('span','DVR','candidate-format');
 return null;
}
