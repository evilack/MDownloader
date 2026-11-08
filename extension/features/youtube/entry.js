import {CanUseYoutube} from '../../lib/distribution-policy.js';
import {LocalizedError} from '../../lib/i18n.js';
export const YoutubeAvailable = () => CanUseYoutube();
// Task 2의 실제 Chrome 검증 전에는 감지/전송 경로를 연결하지 않습니다.
export async function DiscoverYoutube() { throw new LocalizedError('youtube_not_verified'); }
export async function ResolveYoutubeSelection() { throw new LocalizedError('youtube_not_verified'); }
