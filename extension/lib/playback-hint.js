import {Translate} from './i18n.js';
import {CreateElement} from './ui.js';

/** 팝업과 사이드 패널의 공통 안내입니다. 문장 순서는 번역 카탈로그가 정하고,
 * 새로고침 구절만 별도 요소로 강조합니다. 번역 문자열을 HTML로 실행하지 않습니다.
 */
function CreateHintLine(MessageKey, EmphasisKey)
{
	const Emphasis = Translate(EmphasisKey);
	const Text = Translate(MessageKey, Emphasis);
	const Position = Text.indexOf(Emphasis);
	const Line = CreateElement('span');
	if (Position < 0)
	{
		Line.textContent = Text;
	}
	else
	{
		Line.append(Text.slice(0, Position), CreateElement('strong', Emphasis), Text.slice(Position + Emphasis.length));
	}
	return Line;
}

export function CreatePlaybackHint()
{
	const Hint = CreateElement('p', '', 'playback-hint');
	Hint.append(CreateHintLine('hint_stream_playback', 'hint_playback_actions'), CreateHintLine('hint_stream_retry', 'hint_reload_page'));
	return Hint;
}
