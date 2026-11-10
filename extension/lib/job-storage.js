/**
 * 작업 기록의 저장 키와 조회 범위를 담당합니다. 화면에서 필요한 작업 ID가 있으면 해당 기록만 읽고, 전체 조회가 필요한 경우에도 관련 키만 선택합니다.
 */
import { LocalizedError } from './i18n.js';
const JobPrefix = 'job:';
const Updating = new Map();
export const JobKey = RequestId => JobPrefix + RequestId;
export const JobIdFromKey = Key => Key.startsWith(JobPrefix) ? Key.slice(JobPrefix.length) : '';
export const ReadJob = async Key => (await chrome.storage.local.get(Key))[Key];
export const WriteJob = (Key, Job) => chrome.storage.local.set({ [Key]:
	['complete', 'interrupted', 'canceled', 'failed'].includes(Job.state)
	? {...Job, ...(Job.pendingAction ? {pendingAction: undefined} : {}), ...(Job.connecting ? {connecting: false} : {}),
		...(Job.waiting ? {waiting: false} : {}), ...(Job.saving ? {saving: false} : {})} : Job });
export const DeleteStoredJob = Key => chrome.storage.local.remove(Key);
/** Serialize registration/control handoffs while their durable state stays in storage. */
export async function UpdateStoredJob(Key, Update)
{
	const Previous = Updating.get(Key);
	const Task = (async () =>
	{
		try {await Previous;} catch { /* A failed mutation does not lock later controls. */ }
		const Current = await ReadJob(Key);
		const Next = Update(Current);
		if (Next && Next !== Current) await WriteJob(Key, Next);
		return Next;
	})();
	Updating.set(Key, Task);
	try {return await Task;}
	finally {if (Updating.get(Key) === Task) Updating.delete(Key);}
}
export async function ListStoredJobs(RequestIds)
{
	const LocalStorage = chrome.storage.local;
	let Keys;
	if (RequestIds !== undefined)
	{
		if (!Array.isArray(RequestIds) || RequestIds.some(Id => typeof Id !== 'string' || !Id))
		{
			throw new LocalizedError('job_invalid_request');
		}
		Keys = [...new Set(RequestIds.map(JobKey))];
	}
	else if (typeof LocalStorage.getKeys === 'function')
	{
		Keys = (await LocalStorage.getKeys()).filter(JobIdFromKey);
	}

	if (Keys?.length === 0)
	{
		return [];
	}
	// Chrome 130보다 오래된 버전은 저장소 키만 열거할 수 없습니다.
	// 같은 기록 형식을 유지하면서 전체 조회 결과에서 작업 키만 골라 사용합니다.
	const Entries = await LocalStorage.get(Keys ?? null);
	const Jobs = [];
	for (const [Key, Job] of Object.entries(Entries))
	{
		const RequestId = JobIdFromKey(Key);
		if (RequestId && Job && typeof Job === 'object')
		{
			Jobs.push({ ...Job, requestId: RequestId });
		}
	}
	return Jobs.sort((A, B) => (B.created ?? 0) - (A.created ?? 0));
}
