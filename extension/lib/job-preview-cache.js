import { InternalMediaOrigin } from './runtime-policy.js';
/**
 * 작업 썸네일과 짧은 영상 샘플을 별도의 로컬 캐시에 보관합니다. 저장 직전에 작업이 아직 있는지 확인하여 삭제된 작업의 이미지가 다시 생기지 않게 합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
const Thumbnails = { name: 'job-thumbnails', limit: RuntimePolicy.Preview.MaxCachedThumbnails };
const Samples = { name: 'job-preview-samples', limit: RuntimePolicy.Preview.MaxCachedSamples };
export const JobPreviewMaxBytes = RuntimePolicy.Preview.MaxSampleBytes;

// Cache Storage에는 HTTP 형식의 키가 필요합니다. 이 가상 주소는 로컬 캐시 식별자이며 실제로 요청하지 않습니다.
const CacheKey = Id => InternalMediaOrigin + '/preview/' + encodeURIComponent(Id);
export const PreviewSourceKey = Id => 'job-preview-source:' + Id;

/** 썸네일 주소의 쓰기와 삭제는 동일 작업의 짧은 잠금을 공유합니다. 실제 프레임
 * 수집 전체는 잠그지 않으므로 삭제가 느린 페이지 요청을 기다리지 않습니다. */
export function SaveJobPreviewSource(Id, Source, StillRegistered)
{
	const Key = PreviewSourceKey(Id);
	return navigator.locks.request(Key, async () =>
	{
		if (!await StillRegistered())
		{
			return false;
		}
		await chrome.storage.session.set({ [Key]: Source });
		return true;
	});
}

async function Save({ name: Name, limit: Limit }, Id, HttpResponse, StillRegistered)
{
	await navigator.locks.request(Name, async () =>
	{
		// 삭제 처리도 작업 기록을 지운 뒤 같은 캐시 잠금을 사용합니다. 늦게 만든 프레임이 삭제된 작업을 다시 만들지 않도록 검사합니다.
		if (!await StillRegistered())
		{
			return;
		}
		const LocalCache = await caches.open(Name);
		await LocalCache.put(CacheKey(Id), HttpResponse);
		const Keys = await LocalCache.keys();
		await Promise.all(Keys.slice(0, Math.max(0, Keys.length - Limit)).map(Key => LocalCache.delete(Key)));
	});
}

export const SaveJobThumbnail = (Id, Thumbnail, StillRegistered) =>
Save(Thumbnails, Id, Response.json(Thumbnail), StillRegistered);
export const SaveJobSample = (Id, MediaBlob, StillRegistered) =>
Save(Samples, Id, new Response(MediaBlob), StillRegistered);
export async function ReadJobThumbnail(Id)
{
	const Thumbnail = await (await caches.match(CacheKey(Id), { cacheName: Thumbnails.name }))?.json();
	if (Thumbnail?.still || !chrome.storage?.session)
	{
		return Thumbnail;
	}
	const Key = PreviewSourceKey(Id);
	const Source = (await chrome.storage.session.get(Key))[Key];
	return Source?.still ? { ...Thumbnail, still: Source.still } : Thumbnail;
}
export const ReadJobSample = async Id => (await caches.match(CacheKey(Id), { cacheName: Samples.name }))?.blob();
export async function DeleteJobPreview(Id)
{
	await Promise.all([
		navigator.locks.request(PreviewSourceKey(Id), () => chrome.storage?.session?.remove(PreviewSourceKey(Id))),
		...[Thumbnails, Samples].map(({ name: Name }) => navigator.locks.request(Name, async () =>
		{
			if (await caches.has(Name))
			{
				await (await caches.open(Name)).delete(CacheKey(Id));
			}
		})),
	]);
}
