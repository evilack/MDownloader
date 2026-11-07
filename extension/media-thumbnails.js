/**
 * 목록에서 보이는 썸네일만 묶어서 가져옵니다. 스트림 주소가 첫 프레임보다 일찍 감지되면 이미지가 비어 있는 항목만 일정 간격으로 다시 읽습니다.
 * 다른 목록으로 바뀌면 관찰과 요청을 정리합니다. 일반 영상과 라이브 모두 화면에 보이는 동안 갱신하며 실패한 이미지는 재시도합니다.
 */
import { RuntimePolicy, Units } from './lib/runtime-policy.js';
import { Translate } from './lib/i18n.js';
import { CreateElement, SendRequest } from './lib/ui.js';
import { IsStreamFormat } from './lib/media.js';
import { CreatePreviewStatus } from './lib/preview-status.js';

/** 응답이 끝나지 않아도 목록 전체의 다음 조회가 막히지 않도록 대기 시간과 취소를 함께 처리합니다.
 * 늦은 결과에는 핸들러를 남겨 거절을 소비하지만, 이미 끝난 요청의 화면에는 반영하지 않습니다.
 */
function AwaitThumbnailRead(Operation, Signal, TimeoutMs = RuntimePolicy.Preview.ThumbnailReadTimeoutMs)
{
	return new Promise((Resolve, Reject) =>
	{
		let Timer, bSettled = false;
		function Finish(Handler, Value)
		{
			if (bSettled)
			{
				return;
			}
			bSettled = true;
			clearTimeout(Timer);
			Signal?.removeEventListener('abort', Cancel);
			Handler(Value);
		}
		const Cancel = () => Finish(Reject, Signal.reason);
		Promise.resolve(Operation).then(Value => Finish(Resolve, Value), ErrorValue => Finish(Reject, ErrorValue));
		if (Signal?.aborted)
		{
			return Cancel();
		}
		Signal?.addEventListener('abort', Cancel, {once: true});
		Timer = setTimeout(() => Finish(Reject, new DOMException('Thumbnail read timed out', 'TimeoutError')), TimeoutMs);
	});
}

function FormatDuration(Seconds)
{
	const Total = Math.floor(Seconds);
	const Minutes = Math.floor(Total / Units.SecondsPerMinute);
	return [Math.floor(Minutes / Units.MinutesPerHour), Minutes % Units.MinutesPerHour, Total % Units.SecondsPerMinute]
	.map(Part => String(Part).padStart(2, '0')).join(':');
}

export function PreviewTile(Preview, Load, Capture)
{
	const Control = CreateElement('div', '', 'candidate-preview');
	const Status = CreatePreviewStatus(Control);
	let RefreshRevision = 0;
	Control.setAttribute('aria-label', Translate('html_media_preview'));
	function CreateThumbnailImage()
	{
		const Image = new globalThis.Image();
		Image.alt = Translate('view_preview_still_alt');
		Image.hidden = true;
		Image.decoding = 'async';
		Image.referrerPolicy = 'no-referrer';
		return Image;
	}
	let ImageElement = CreateThumbnailImage();
	let ImageRevision = 0;
	const Duration = CreateElement('span', '', 'candidate-preview-duration');
	Duration.dir = 'ltr';
	Duration.hidden = true;
	const Resolution = CreateElement('span', '', 'candidate-preview-resolution');
	Resolution.dir = 'ltr';
	Resolution.hidden = true;
	function ShowResolution(Dimensions)
	{
		if (!Dimensions)
		{
			return;
		}
		const { width: Width, height: Height } = Dimensions;
		if (!Number.isInteger(Width) || Width <= 0 || !Number.isInteger(Height) || Height <= 0)
		{
			return;
		}
		Resolution.textContent = `${Width}×${Height}`;
		Resolution.hidden = false;
	}
	Control.append(ImageElement, Duration, Resolution, Status.node);
	Preview.attach(Control, async Signal =>
	{
		const Source = await Load(Signal);
		if (!Signal.aborted)
		{
			ShowResolution(Source.resolution);
		}
		return Source;
	}, () => ImageElement.hidden ? undefined : ImageElement.src, Capture,
	State => Status.setFailed(State === 'failed'));
	return {
		control: Control,
		async refresh(LoadThumbnail)
		{
			// 썸네일 조회 실패는 호버 재생의 실패가 아닙니다. 재생 결과만 상태 아이콘을 바꿉니다.
			const RequestRevision = ++RefreshRevision;
			try
			{
				const Thumbnail = await LoadThumbnail();
				if (RequestRevision !== RefreshRevision)
				{
					return;
				}
				if (Thumbnail)
				{
					await this.show(Thumbnail);
				}
			}
			catch
			{
				// 캐시가 준비되지 않았거나 읽을 수 없어도 현재 이미지를 유지합니다.

			}
		},
		async readThumbnail(Signal)
		{
			const Source = await Load(Signal);
			Signal.throwIfAborted();
			if (Source.still)
			{
				return Source;
			}
			if (!IsStreamFormat(Source.format) || !Source.url || (Source.protectedRequest && !Source.pageStream))
			{
				return;
			}
			const { ReadStreamThumbnail } = await import('./lib/stream-thumbnail.js');
			Signal.throwIfAborted();
			return ReadStreamThumbnail(Source, Signal);
		},
		async show(Preview, Signal)
		{
			const Revision = ++ImageRevision;
			ShowResolution(Preview.resolution);
			if (Number.isFinite(Preview.duration) && Preview.duration > 0)
			{
				Duration.textContent = FormatDuration(Preview.duration);
				Duration.hidden = false;
			}
			if (!Preview.still)
			{
				return !ImageElement.hidden;
			}
			if (ImageElement.src === Preview.still && !ImageElement.hidden && ImageElement.naturalWidth)
			{
				return true;
			}
			// 새 이미지는 분리된 요소에서 먼저 디코딩합니다. URL을 받았다는 이유만으로
			// 성공 처리하거나 기존 정상 이미지를 지우지 않습니다. 같은 주소도 실패 후 다시 시도할 수 있습니다.
			const NextImage = CreateThumbnailImage();
			NextImage.src = Preview.still;
			try
			{
				await AwaitThumbnailRead(NextImage.decode(), Signal);
				if (Revision !== ImageRevision || Signal?.aborted || !NextImage.naturalWidth)
				{
					return false;
				}
				NextImage.hidden = false;
				ImageElement.replaceWith(NextImage);
				ImageElement = NextImage;
				return true;
			}
			catch
			{
				return false;
			}
			finally
			{
				if (NextImage !== ImageElement)
				{
					NextImage.removeAttribute('src');
				}
			}
		},
	};
}

export function ObserveCandidateThumbnails(Root, Input, Tiles)
{
	const Pending = new Map([...Tiles].map(([Id, Tile]) => [Tile.control, { id: Id, tile: Tile, attempt: 0, readyAt: 0 }]));
	const Visible = new Set();
	let Timer;
	let bReading = false;
	let bDisposed = false;
	let ReadingController;
	const Observer = new IntersectionObserver(Entries =>
	{
		for (const Entry of Entries)
		{
			const Candidate = Pending.get(Entry.target);
			if (!Candidate)
			{
				continue;
			}
			if (Entry.isIntersecting)
			{
				Visible.add(Candidate);
			}
			else
			{
				Visible.delete(Candidate);
			}
		}
		ScheduleRead();
	}, { root: Root });
	function ScheduleRead()
	{
		clearTimeout(Timer);
		if (bDisposed || bReading || document.hidden || !Visible.size)
		{
			return;
		}
		const Next = Math.min(...[...Visible].map(Candidate => Candidate.readyAt));
		Timer = setTimeout(ReadVisible, Math.max(0, Math.ceil(Next - performance.now())));
	}

	async function ReadVisible()
	{
		if (bDisposed || document.hidden)
		{
			return;
		}
		const Now = performance.now();
		const Batch = [...Visible].filter(Candidate => Candidate.readyAt <= Now);
		if (!Batch.length)
		{
			return ScheduleRead();
		}
		bReading = true;
		ReadingController = new AbortController();
		const Signal = ReadingController.signal;
		try
		{
			const Previews = await AwaitThumbnailRead(SendRequest('candidatePreviews', { ...Input, candidateIds: Batch.map(({ id: Id }) => Id) }), Signal)
			.catch(() => []);
			if (bDisposed || Signal.aborted)
			{
				return;
			}
			const ById = new Map(Previews.map(Preview => [Preview.id, Preview]));
			let Samples = 0;
			for (const Candidate of Batch)
			{
				if (bDisposed || Signal.aborted)
				{
					break;
				}
				let Preview = ById.get(Candidate.id);
				// 워커·CORS 등으로 원본 프레임을 연결할 수 없으면 각 항목의 주소에서만
				// 작은 샘플을 만듭니다. 동시에 많은 스트림을 읽지 않도록 한 묶음의 수를 제한합니다.
				if (!Preview?.still && Candidate.tile.readThumbnail && Samples < RuntimePolicy.Preview.ThumbnailSamplesPerBatch)
				{
					Samples++;
					// 실패하는 앞 항목도 다음 묶음에서는 뒤로 보내 모든 보이는 항목에 차례를 줍니다.
					Visible.delete(Candidate);
					Visible.add(Candidate);
					const Sample = await AwaitThumbnailRead(Candidate.tile.readThumbnail(Signal), Signal,
					RuntimePolicy.Preview.ThumbnailSampleTimeoutMs).catch(() => undefined);
					if (bDisposed || Signal.aborted)
					{
						break;
					}
					if (Sample)
					{
						Preview = { ...Preview, ...Sample };
					}
				}
				const bUpdated = Preview && await Candidate.tile.show(Preview, Signal) !== false && !!Preview.still;
				if (bDisposed || Signal.aborted)
				{
					break;
				}
				// 재생목록이 먼저 감지되면 플레이어에 읽을 프레임이 아직 없을 수 있습니다.
				// 준비 전에는 짧게 재시도하고, 계속 읽을 수 없는 소스는 느린 간격으로만 확인합니다.
				// 일반 영상도 이미지 한 번으로 영구 완료하지 않습니다. 표지 로딩이나 프레임
				// 디코딩이 일시적으로 실패해도 화면에 보이는 동안 다시 확인합니다.
				if (bUpdated)
				{
					Candidate.attempt = 0;
					Candidate.hasStill = true;
				}
				const Delay = Candidate.hasStill ? RuntimePolicy.Preview.ThumbnailRefreshMs
				: RuntimePolicy.Preview.ThumbnailRetryDelaysMs[Candidate.attempt++] ?? RuntimePolicy.Preview.MissingThumbnailRetryMs;
				Candidate.readyAt = performance.now() + Delay;
			}
		}
		finally
		{
			ReadingController = undefined;
			bReading = false;
			ScheduleRead();
		}
	}
	function VisibilityChanged()
	{
		if (document.hidden)
		{
			ReadingController?.abort();
		}
		ScheduleRead();
	}
	document.addEventListener('visibilitychange', VisibilityChanged);
	for (const Control of Pending.keys())
	{
		Observer.observe(Control);
	}
	return () =>
	{
		bDisposed = true;
		clearTimeout(Timer);
		ReadingController?.abort();
		document.removeEventListener('visibilitychange', VisibilityChanged);
		Observer.disconnect();
	};
}
