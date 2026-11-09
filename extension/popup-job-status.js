/**
 * 팝업의 후보 행과 백그라운드 다운로드를 미디어 키로 연결합니다. 한 후보를 여러 번 받은 경우에는 가장 최근 작업의 진행률을 표시합니다.
 */
import { Translate } from './lib/i18n.js';
import { ObserveJobs } from './lib/job-feed.js';
import { GetDownloadMetrics, SpeedSampleMs } from './lib/metrics.js';
import { CreateJobMeasure } from './lib/job-measure.js';
const Labels = {
	starting: 'view_state_starting',
	active: 'view_candidate_downloading',
	complete: 'view_candidate_complete',
	paused: 'view_state_paused',
	canceled: 'view_state_canceled',
	failed: 'view_state_failed',
	unknown: 'view_state_unknown',
};
export function CreateCandidateJobStatus(UpdateLive,ReportShownJobs)
{
	const Jobs = new Map();
	const Meters = new Map();
	const Measures = new WeakMap();
	const LocalMediaKeys = new Set();
	let Rows = new Map();
	function Render()
	{
		const Shown=[];
		// 같은 후보를 여러 번 받을 수 있습니다. 최신 작업을 표시하고, 그 기록을 지우면 이전 작업을 선택할 수 있게 함께 보관합니다.
		const Latest = new Map();
		for (const Job of Jobs.values())
		{
			const Previous = Latest.get(Job.mediaKey);
			if (!Previous || Job.created > Previous.created)
			{
				Latest.set(Job.mediaKey, Job);
			}
		}
		for (const [Key, Badge] of Rows)
		{
			const Job = Latest.get(Key);
			if(Job)Shown.push(Job.requestId);
			// 재생목록 본문을 볼 수 없는 워커 스트림도 실제 수신 작업이 라이브임을 확인하면 표시합니다.
			UpdateLive?.(Key, Job);
			const State = Job?.state;
			const Label = Labels[State] ? Translate(Labels[State]) : '';
			const Value = Meters.get(Job?.requestId)?.value;
			// 상태 변화는 보조 기술에 알리고 주기적으로 바뀌는 속도 값은 반복해서 읽지 않습니다.
			if (Value)
			{
				Badge.setAttribute('aria-live', 'off');
				let Measure = Measures.get(Badge);
				if (!Measure)
				{
					Measure = CreateJobMeasure();
					Measures.set(Badge, Measure);
				}
				if (Badge.firstChild !== Measure.node)
				{
					Badge.replaceChildren(Measure.node);
				}
				const Description = Translate('view_metric_progress', Label, Measure.update(Value));
				if (Badge.title !== Description)
				{
					Badge.title = Description;
				}
				Badge.setAttribute('aria-label', Description);
				Badge.dataset.state = State;
				continue;
			}
			if (Badge.textContent === Label && Badge.dataset.state === State)
			{
				continue;
			}
			Badge.removeAttribute('aria-live');
			Badge.removeAttribute('aria-label');
			Badge.textContent = Label;
			if (Label)
			{
				Badge.title = Label;
				Badge.dataset.state = State;
			}
			else
			{
				Badge.removeAttribute('title');
				delete Badge.dataset.state;
			}
		}
		ReportShownJobs?.(Shown);
	}

	const Refresh = ObserveJobs({
		mediaKeys: LocalMediaKeys,
		onUpdate(Changes)
		{
			const Now = performance.now();
			for (const [Id, Job] of Changes)
			{
				if (Job)
				{
					Jobs.set(Id, Job);
				}
				else
				{
					Jobs.delete(Id);
				}
				if (Job?.state === 'active')
				{
					const Previous = Meters.get(Id)?.sample;
					const Sample = !Previous || Now - Previous.time >= SpeedSampleMs
					? { time: Now, bytes: Job.bytesReceived } : Previous;
					Meters.set(Id, { value: GetDownloadMetrics(Job, Previous, Now), sample: Sample });
				}
				else
				{
					Meters.delete(Id);
				}
			}
			Render();
		},
		onError()
		{
			/* 워커가 다시 응답할 때까지 마지막으로 확인한 상태를 표시합니다. */
		},
	});
	return function ShowStatuses(NextRows = new Map())
	{
		Rows = NextRows;
		LocalMediaKeys.clear();
		for (const Key of Rows.keys())
		{
			LocalMediaKeys.add(Key);
		}
		Render();
		Refresh();
	};
}
