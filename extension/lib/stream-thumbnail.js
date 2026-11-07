/**
 * 플레이어와 주소의 연결을 알 수 없을 때 해당 후보의 짧은 구간에서 썸네일을 만듭니다.
 * 다른 항목의 플레이어 이미지를 빌리지 않으며, 원본 탭의 재생·트랙을 조작하지 않습니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { StreamPreview } from './stream-preview.js';
export async function ReadStreamThumbnail(Source, ParentSignal)
{
	const Controller = new AbortController();
	const Cancel = () => Controller.abort(ParentSignal.reason);
	ParentSignal.throwIfAborted();
	ParentSignal.addEventListener('abort', Cancel, { once: true });
	const Timer = setTimeout(() => Controller.abort(new DOMException('Thumbnail timed out', 'TimeoutError')), RuntimePolicy.Preview.ThumbnailSampleTimeoutMs);
	try
	{
		let Metadata;
		const Sample = await StreamPreview(Source, Controller.signal, Value =>
		{
			Metadata = Value;
		});
		return { ...Metadata, ...await ReadSampleThumbnail(Sample, Controller.signal) };
	}
	finally
	{
		clearTimeout(Timer);
		ParentSignal.removeEventListener('abort', Cancel);
	}
}

/** 오직 메모리의 작은 MP4 샘플만 디코딩합니다. 종료·실패 시 영상과 객체 URL을 함께 정리합니다. */
export async function ReadSampleThumbnail(Sample, Signal)
{
	Signal.throwIfAborted();
	const Video = document.createElement('video');
	const Url = URL.createObjectURL(Sample);
	function WaitFor(Name, Start)
	{
		return new Promise((Resolve, Reject) =>
		{
			function Cleanup()
			{
				Video.removeEventListener(Name, Ready);
				Video.removeEventListener('error', Failed);
				Signal.removeEventListener('abort', Failed);
			}
			function Ready()
			{
				Cleanup();
				Resolve();
			}
			function Failed()
			{
				Cleanup();
				Reject(Signal.reason ?? Video.error ?? new Error('Thumbnail decode failed'));
			}
			if (Signal.aborted)
			{
				return Failed();
			}
			Video.addEventListener(Name, Ready, { once: true });
			Video.addEventListener('error', Failed, { once: true });
			Signal.addEventListener('abort', Failed, { once: true });
			Start();
		});
	}
	try
	{
		Video.muted = true;
		Video.preload = 'auto';
		await WaitFor('loadeddata', () =>
		{
			Video.src = Url;
		});
		if (Number.isFinite(Video.duration) && Video.duration > 0)
		{
			await WaitFor('seeked', () =>
			{
				Video.currentTime = Math.min(RuntimePolicy.Preview.ThumbnailSeekSeconds, Video.duration / 3);
			});
		}
		Signal.throwIfAborted();
		if (!Video.videoWidth || !Video.videoHeight)
		{
			throw new Error('Thumbnail has no video frame');
		}
		const { maxWidth: MaxWidth, maxHeight: MaxHeight, jpegQuality: Quality } = RuntimePolicy.Preview.ThumbnailFrame;
		const Scale = Math.min(MaxWidth / Video.videoWidth, MaxHeight / Video.videoHeight, 1);
		const Canvas = document.createElement('canvas');
		Canvas.width = Math.max(1, Math.round(Video.videoWidth * Scale));
		Canvas.height = Math.max(1, Math.round(Video.videoHeight * Scale));
		Canvas.getContext('2d').drawImage(Video, 0, 0, Canvas.width, Canvas.height);
		return { still: Canvas.toDataURL('image/jpeg', Quality), resolution: { width: Video.videoWidth, height: Video.videoHeight } };
	}
	finally
	{
		Video.removeAttribute('src');
		Video.load();
		URL.revokeObjectURL(Url);
	}
}
