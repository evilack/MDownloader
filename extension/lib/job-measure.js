/**
 * 진행 수치와 속도를 갱신합니다. 관리자는 수치의 외부 오버레이를 전달하고, 팝업은 기존 두 줄 표시를 사용합니다.
 */
import { Translate } from './i18n.js';
import { CreateElement } from './ui.js';
export function CreateJobMeasure(ProgressLabel)
{
	const LocalNode = CreateElement('span', '', 'job-measure');
	const Progress = ProgressLabel ?? CreateElement('span', '', 'job-measure-progress');
	const Speed = CreateElement('span', '', 'job-measure-speed');
	if (!ProgressLabel)
	{
		LocalNode.append(Progress);
	}
	LocalNode.append(Speed);
	return {
		node: LocalNode,
		update(Value)
		{
			if (Progress.textContent !== Value.progress)
			{
				Progress.textContent = Value.progress;
			}
			if (Speed.textContent !== Value.speed)
			{
				Speed.textContent = Value.speed;
			}
			const Title = Translate('view_metric_progress', Value.progress, Value.speed);
			if (LocalNode.title !== Title)
			{
				LocalNode.title = Title;
			}
			return Title;
		},
	};
}
