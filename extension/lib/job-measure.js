/**
 * 진행률과 속도를 두 줄로 보여 주는 공용 컴포넌트입니다. 같은 문구를 반복해서 쓰지 않고, 보조 기술이 두 값을 함께 알 수 있는 설명도 갱신합니다.
 */
import { Translate } from './i18n.js';
import { CreateElement } from './ui.js';
export function CreateJobMeasure()
{
	const LocalNode = CreateElement('span', '', 'job-measure');
	const Progress = CreateElement('span', '', 'job-measure-progress');
	const Speed = CreateElement('span', '', 'job-measure-speed');
	LocalNode.append(Progress, Speed);
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
