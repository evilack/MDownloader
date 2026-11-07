/**
 * 이미 받은 첫 조각을 짧은 MP4 미리보기로 바꾸고 작은 썸네일을 저장합니다. 미리보기 바이트와 처리 시간을 제한하므로 본 다운로드를 오래 붙잡지 않습니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { BufferTarget } from '../vendor/mediabunny-1.65.2.mjs';
import { RemuxHls } from './hls-remux.js';
import { JobPreviewMaxBytes, ReadJobThumbnail, SaveJobSample, SaveJobThumbnail } from './job-preview-cache.js';
import { ThumbnailFrame } from './player-previews.js';
export async function CacheSegmentPreview(Id, Workspace, Playlist, TransferSignal, StillRegistered)
{
	const Signal = AbortSignal.any([TransferSignal, AbortSignal.timeout(RuntimePolicy.Preview.SampleTimeoutMs)]);
	const Target = new BufferTarget();
	const Files = new Map();
	let Total = 0;
	await RemuxHls(Playlist, async Path =>
	{
		if (!Files.has(Path))
		{
			const MediaFile = await (await Workspace.getFileHandle(Path)).getFile();
			Total += MediaFile.size;
			if (Total > JobPreviewMaxBytes)
			{
				throw new RangeError('Preview exceeds the sample byte limit');
			}
			Files.set(Path, MediaFile);
		}
		return Files.get(Path);
	}, Target, Signal);
	if (Target.buffer.byteLength > JobPreviewMaxBytes)
	{
		return;
	}
	const Sample = new Blob([Target.buffer], { type: 'video/mp4' });
	await SaveJobSample(Id, Sample, StillRegistered);
	void CacheThumbnail(Id, Sample, StillRegistered).catch(() =>
	{
	});
}

async function CacheThumbnail(Id, Sample, StillRegistered)
{
	const { maxWidth: MaxWidth, maxHeight: MaxHeight, jpegQuality: JpegQuality } = ThumbnailFrame;
	const Url = URL.createObjectURL(Sample);
	const Video = document.createElement('video');
	const Signal = AbortSignal.timeout(RuntimePolicy.Preview.SampleTimeoutMs);
	try
	{
		const WaitFor = UiEvent => new Promise((Resolve, Reject) =>
		{
			Video.addEventListener(UiEvent, Resolve, { once: true, signal: Signal });
			Video.addEventListener('error', Reject, { once: true, signal: Signal });
			Signal.addEventListener('abort', () => Reject(Signal.reason), { once: true });
		});
		const Loaded = WaitFor('loadeddata');
		Video.preload = 'auto';
		Video.muted = true;
		Video.src = Url;
		await Loaded;
		if (Number.isFinite(Video.duration) && Video.duration > 0)
		{
			const Seeked = WaitFor('seeked');
			Video.currentTime = Math.min(RuntimePolicy.Preview.ThumbnailSeekSeconds, Video.duration / 3);
			await Seeked;
		}
		if (!Video.videoWidth || !Video.videoHeight)
		{
			return;
		}
		const Canvas = document.createElement('canvas');
		const Scale = Math.min(MaxWidth / Video.videoWidth, MaxHeight / Video.videoHeight, 1);
		Canvas.width = Math.max(1, Math.round(Video.videoWidth * Scale));
		Canvas.height = Math.max(1, Math.round(Video.videoHeight * Scale));
		Canvas.getContext('2d').drawImage(Video, 0, 0, Canvas.width, Canvas.height);
		const Previous = await ReadJobThumbnail(Id).catch(() => undefined);
		await SaveJobThumbnail(Id, {
			duration: Previous?.duration, still: Canvas.toDataURL('image/jpeg', JpegQuality),
			resolution: { width: Video.videoWidth, height: Video.videoHeight },
		}, StillRegistered);
		await chrome.runtime.sendMessage({ type: 'jobPreviewReady', requestId: Id });
	}
	finally
	{
		Video.removeAttribute('src');
		Video.load();
		URL.revokeObjectURL(Url);
	}
}
