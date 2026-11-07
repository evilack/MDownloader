import { DebugLog } from './debug-log.js';
/**
 * HLS와 DASH가 공용으로 사용하는 병렬 전송 스케줄러입니다. 조각 하나가 실패하면 같은 조각만 다시 시도합니다.
 * 복구할 수 없는 오류는 다른 작업에도 전달합니다. 모든 작업이 쓰기를 끝내거나 취소한 뒤에만 호출자에게 반환합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { LocalizedError } from './i18n.js';
export class RetryableTransferError extends LocalizedError
{
	constructor(Key, Status, ...Args)
	{
		super(Key, ...Args);
		this.status = Status;
	}
}

export async function TransferSegments(Resources, Controller, Transfer, Parallelism = RuntimePolicy.Transfer.MaxLanes)
{
	const { signal: Signal } = Controller;
	let Next = 0;
	async function Lane()
	{
		try
		{
			while (Next < Resources.length)
			{
				Signal.throwIfAborted();
				const Index = Next++;
				for (let Attempt = 1; ; Attempt++)
				{
					Signal.throwIfAborted();
					try
					{
						await Transfer(Resources[Index], Index);
						break;
					}
					catch (ErrorValue)
					{
						if (DebugLog.IsEnabled())
						{
							DebugLog.Record('SegmentRetry', () => ({ attempt: Attempt, status: ErrorValue.status, error: ErrorValue }));
						}
						// 일시 오류가 난 조각만 재시도합니다. 재시도할 수 없는 오류가 오면 모든 전송 작업을 중단합니다.
						if (Signal.aborted || Attempt === RuntimePolicy.Transfer.MaxAttempts ||
						!(ErrorValue instanceof TypeError || ErrorValue instanceof RetryableTransferError))
						{
							throw ErrorValue;
						}
					}
				}
			}
		}
		catch (ErrorValue)
		{
			if (!Signal.aborted)
			{
				Controller.abort(ErrorValue);
			}
			throw ErrorValue;
		}
	}
	await Promise.allSettled(Array.from({ length: Math.min(RuntimePolicy.Transfer.MaxLanes, Parallelism, Resources.length) }, Lane));
	Signal.throwIfAborted();
}
