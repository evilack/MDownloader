import {LocalizedError} from '../../lib/i18n.js';
export class YoutubeError extends LocalizedError
{
	constructor(Code) { super(Code); this.code = Code; }
}
/** Jinter는 보안 sandbox가 아닙니다. 별도 worker를 매번 폐기하고 외부에서 시간을 제한합니다. */
export function CreateEvaluator({createWorker = () => new Worker(new URL('../../vendor/youtube/evaluator-worker.mjs', import.meta.url), {type: 'module'}), timeoutMs = 2000} = {})
{
	return async (Data, Environment = {}) =>
	{
		if (typeof Data?.output !== 'string' || new TextEncoder().encode(Data.output).length > 4 * 1024 * 1024) throw new YoutubeError('youtube_evaluator_input_limit');
		const WorkerInstance = createWorker();
		try
		{
			return await new Promise((Resolve, Reject) =>
			{
				const Timer = setTimeout(() => Reject(new YoutubeError('youtube_evaluator_timeout')), timeoutMs);
				const Finish = (Result, ErrorValue) => { clearTimeout(Timer); ErrorValue ? Reject(ErrorValue) : Resolve(Result); };
				WorkerInstance.onmessage = Event =>
				{
					const Result = Event.data;
					if (!Result?.ok || !Result.value || typeof Result.value !== 'object' ||
						['sig', 'n'].some(Key => Result.value[Key] !== undefined && (typeof Result.value[Key] !== 'string' || Result.value[Key].length > 8192))) return Finish(undefined, new YoutubeError('youtube_evaluator_failed'));
					Finish({sig: Result.value.sig, n: Result.value.n});
				};
				WorkerInstance.onerror = () => Finish(undefined, new YoutubeError('youtube_evaluator_failed'));
				// 해석기에 넘기는 환경은 primitive만 허용합니다. 브라우저 객체/콜백은 전달하지 않습니다.
				const Values = Object.fromEntries(Object.entries(Environment).filter(([Key, Value]) => ['sig', 'sp', 'n'].includes(Key) && typeof Value === 'string' && Value.length <= 8192));
				WorkerInstance.postMessage({script: Data.output, environment: Values});
			});
		}
		finally { WorkerInstance.terminate(); }
	};
}
