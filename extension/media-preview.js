import { DebugLog } from './lib/debug-log.js';
/**
 * 팝업과 관리자에서 공유하는 호버 미리보기입니다. 썸네일, 로딩 표시, 영상으로 전환되는 순서와 팝오버 위치를 관리합니다.
 * 마우스가 다른 항목으로 이동하거나 화면이 닫히면 세션을 중단하고 객체 URL을 해제합니다. 늦게 도착한 이전 영상은 새 팝오버를 열 수 없습니다.
 */
import { RuntimePolicy } from './lib/runtime-policy.js';
import { Translate } from './lib/i18n.js';
import { CreateElement } from './lib/ui.js';
import { IsAudioFormat, IsStreamFormat } from './lib/media.js';
export function CreateMediaPreview()
{
	const Hover = CreateElement('div');
	Hover.id = 'preview-hover';
	Hover.popover = 'auto';
	const Media = CreateElement('div');
	Media.id = 'preview-media';
	const Path = CreateElement('code');
	Path.id = 'preview-stream-path';
	Path.dir = 'ltr';
	Path.hidden = true;
	Hover.append(Media, Path);
	document.body.append(Hover);
	const Bindings = new WeakMap();
	let Pointer;
	let Pending;
	let Active;
	let CloseTimer;
	function PositionHover()
	{
		if (!Active || !Hover.matches(':popover-open'))
		{
			return;
		}
		const Anchor = Active.trigger.getBoundingClientRect();
		const Width = document.documentElement.clientWidth;
		const Height = window.innerHeight;
		const Start = Anchor.right + RuntimePolicy.Preview.AnchorGapPx;
		const End = Anchor.left - RuntimePolicy.Preview.AnchorGapPx;
		const RightSpace = Width - RuntimePolicy.Preview.ViewportInsetPx - Start;
		const LeftSpace = End - RuntimePolicy.Preview.ViewportInsetPx;
		const bBeside = Math.max(RightSpace, LeftSpace) >= RuntimePolicy.Preview.MinAdjacentWidthPx;
		const bToRight = RightSpace >= LeftSpace;
		const Available = bBeside ? Math.max(RightSpace, LeftSpace) : Width - RuntimePolicy.Preview.ViewportInsetPx * 2;
		const CardWidth = Math.min(RuntimePolicy.Preview.PreferredWidthPx, Available);
		Hover.style.width = `${CardWidth}px`;
		Hover.style.left = `${bBeside ? (bToRight ? Start : End - CardWidth) : (Width - CardWidth) / 2}px`;
		const Top = bBeside ? Anchor.top : Anchor.bottom + RuntimePolicy.Preview.AnchorGapPx;
		Hover.style.top = `${Math.max(RuntimePolicy.Preview.ViewportInsetPx, Math.min(Top, Height - Hover.offsetHeight - RuntimePolicy.Preview.ViewportInsetPx))}px`;
	}

	function CancelPending(Trigger)
	{
		if (!Pending || (Trigger && Pending.trigger !== Trigger))
		{
			return;
		}
		clearTimeout(Pending.timer);
		Pending = undefined;
	}

	function Reset()
	{
		if (!Active)
		{
			return;
		}
		if (DebugLog.IsEnabled())
		{
			DebugLog.Record('PreviewClosed');
		}
		const { controller: Controller, player: Player, objectUrl: ObjectUrl } = Active;
		Active = undefined;
		clearTimeout(CloseTimer);
		Controller.abort();
		if (Player)
		{
			Player.pause();
			Player.removeAttribute('src');
			Player.load();
		}
		if (ObjectUrl)
		{
			URL.revokeObjectURL(ObjectUrl);
		}
		Media.replaceChildren();
		ShowPath();
	}

	function ShowPath(StreamPath)
	{
		Path.hidden = !StreamPath;
		Path.textContent = Path.title = StreamPath ?? '';
	}

	function Close(Trigger)
	{
		CancelPending(Trigger);
		if (!Active || (Trigger && Active.trigger !== Trigger))
		{
			return;
		}
		Reset();
		if (Hover.matches(':popover-open'))
		{
			Hover.hidePopover();
		}
	}

	function ScheduleClose(RelatedTarget)
	{
		if (!Active)
		{
			return;
		}
		if (RelatedTarget instanceof Node && (Hover.contains(RelatedTarget) || Active.trigger.contains(RelatedTarget)))
		{
			return;
		}
		clearTimeout(CloseTimer);
		CloseTimer = setTimeout(() => Close(), RuntimePolicy.Preview.HoverCloseDelayMs);
	}

	Hover.addEventListener('pointerenter', () => clearTimeout(CloseTimer));
	Hover.addEventListener('pointerleave', UiEvent => ScheduleClose(UiEvent.relatedTarget));
	Hover.addEventListener('beforetoggle', UiEvent =>
	{
		if (UiEvent.newState === 'closed')
		{
			Reset();
		}
	});
	window.addEventListener('resize', PositionHover);
	document.addEventListener('scroll', PositionHover, true);
	document.addEventListener('pointermove', RememberPointer);
	document.documentElement.addEventListener('pointerleave', () =>
	{
		Pointer = undefined;
	});
	new ResizeObserver(PositionHover).observe(Hover);
	function RememberPointer(UiEvent)
	{
		if (UiEvent.pointerType === 'mouse')
		{
			Pointer = { x: UiEvent.clientX, y: UiEvent.clientY };
		}
	}

	function Open(Trigger, Load, GetStill, Capture, OnPlaybackState)
	{
		if (DebugLog.IsEnabled())
		{
			DebugLog.Record('PreviewStarted');
		}
		Close();
		const Controller = new AbortController();
		const { signal: Signal } = Controller;
		const Started = DebugLog.IsEnabled() ? performance.now() : undefined;
		const Session = { controller: Controller, trigger: Trigger };
		Active = Session;
		let PlaybackState;
		let PlaybackTimer;
		const Loading = CreateElement('progress', '', 'preview-loading');
		Loading.setAttribute('aria-label', Translate('view_preview_loading'));
		Trigger.append(Loading);
		Signal.addEventListener('abort', () =>
		{
			clearTimeout(PlaybackTimer);
			Loading.remove();
		}, { once: true });
		function ReportPlayback(State)
		{
			// 이미 닫힌 세션의 늦은 실패가 다른 행의 상태를 바꾸지 못하게 합니다.
			if (Signal.aborted || Active !== Session || PlaybackState === State)
			{
				return;
			}
			PlaybackState = State;
			if (State !== 'loading' && DebugLog.IsEnabled())
			{
				DebugLog.Record('PreviewFinished', () => ({ result: State === 'playing' ? 'ok' : 'failed', durationMs: Started === undefined ? undefined : performance.now() - Started }));
			}
			if (State !== 'loading')
			{
				clearTimeout(PlaybackTimer);
			}
			if (State === 'failed')
			{
				Loading.remove();
			}
			OnPlaybackState?.(State);
		}
		ReportPlayback('loading');
		// 로딩이 끝나지 않는 경우에도 재생 시작 제한 시간을 지난 뒤에만 실패를 알립니다.
		PlaybackTimer = setTimeout(() => ReportPlayback('failed'), RuntimePolicy.Preview.StreamTimeoutMs);
		let Still;
		let StillRevision = 0;
		let DecodedStillRevision = 0;
		function Show(LocalNode)
		{
			if (Signal.aborted)
			{
				return;
			}
			// 같은 로딩 표시 요소를 목록 썸네일에서 확대 이미지로 옮깁니다.
			if (Loading.isConnected)
			{
				Media.replaceChildren(LocalNode, Loading);
			}
			else
			{
				Media.replaceChildren(LocalNode);
			}
			if (!Hover.matches(':popover-open'))
			{
				Hover.showPopover();
			}
			PositionHover();
		}

		async function ShowStill(Url)
		{
			if (!Url || Url === Still?.src)
			{
				return;
			}
			const Revision = ++StillRevision;
			const ImageElement = new Image();
			ImageElement.alt = Translate('view_preview_still_alt');
			ImageElement.referrerPolicy = 'no-referrer';
			ImageElement.src = Url;
			// 더 선명한 이미지가 디코딩될 때까지 현재 이미지를 유지합니다.
			await ImageElement.decode().catch(() =>
			{
			});
			if (Signal.aborted || Revision < DecodedStillRevision || !ImageElement.naturalWidth)
			{
				return;
			}
			Still = ImageElement;
			DecodedStillRevision = Revision;
			if (!Session.player?.isConnected)
			{
				Show(Still);
			}
		}

		function ShowPlayer(Source, LocalAudio, Sample)
		{
			const Player = CreateElement(LocalAudio ? 'audio' : 'video');
			Session.player = Player;
			if (Source instanceof Blob)
			{
				Session.objectUrl = URL.createObjectURL(Source);
				Source = Session.objectUrl;
			}
			Player.setAttribute('aria-label', Translate('html_media_preview'));
			Player.controls = LocalAudio;
			Player.muted = true;
			Player.loop = Sample;
			Player.playsInline = true;
			Player.addEventListener('playing', () => ReportPlayback('playing'), { signal: Signal });
			Player.addEventListener('loadeddata', () =>
			{
				if (LocalAudio || !Still?.isConnected)
				{
					Loading.remove();
					Show(Player);
					return;
				}
				// 플레이어가 첫 프레임을 제출할 때까지 영상 레이어를 투명하게 두어 아래 썸네일이 보이게 합니다.
				Player.classList.add('preview-video-entering');
				Still.after(Player);
				PositionHover();
				const Frame = Player.requestVideoFrameCallback(() =>
				{
					if (!Player.isConnected)
					{
						return;
					}
					Loading.remove();
					Still.setAttribute('aria-hidden', 'true');
					Player.classList.remove('preview-video-entering');
				});
				Signal.addEventListener('abort', () => Player.cancelVideoFrameCallback(Frame), { once: true });
			}, { once: true, signal: Signal });
			Player.addEventListener('error', () =>
			{
				ReportPlayback('failed');
				Loading.remove();
				// 재생이 실패해도 준비된 썸네일을 보여 줍니다. 이미지도 없으면 빈 팝오버를 열지 않습니다.
				if (Still)
				{
					Still.removeAttribute('aria-hidden');
					Show(Still);
				}
				else if (Player.isConnected)
				{
					Close(Trigger);
				}
			}, { signal: Signal });
			Player.src = Source;
			void Player.play().catch(() => ReportPlayback('failed'));
		}

		void ShowStill(GetStill());
		void (async () =>
		{
			try
			{
				const Source = await Load(Signal);
				if (Signal.aborted)
				{
					return;
				}
				ShowPath(Source.streamPath);
				void ShowStill(Source.still);
				if (Source.file)
				{
					ShowPlayer(Source.file, IsAudioFormat(Source.format), !!Source.sample);
				}
				else if (IsStreamFormat(Source.format) || ['WEBRTC', 'YOUTUBE'].includes(Source.format))
				{
					if (Source.url && (Source.pageStream || !Source.protectedRequest))
					{
						try
						{
							const { StreamPreview } = await import('./lib/stream-preview.js');
							Signal.throwIfAborted();
							const MediaBlob = await StreamPreview(Source, AbortSignal.any([Signal, AbortSignal.timeout(RuntimePolicy.Preview.StreamTimeoutMs)]));
							if (!Signal.aborted)
							{
								ShowPlayer(MediaBlob, false, true);
							}
							return;
						}
						catch
						{
							// 주소가 만료되거나 접근이 거절되어도 페이지의 플레이어가 가진 프레임은 남을 수 있습니다.
							// 브라우저가 해당 플레이어의 읽기를 허용할 때에만 그 구간을 사용합니다.

						}
					}
					Signal.throwIfAborted();
					const Clip = await Capture?.();
					if (!Signal.aborted && Clip?.startsWith('data:video/webm;base64,'))
					{
						ShowPlayer(Clip, false, true);
					}
				}
				else if (Source.url && !Source.protectedRequest)
				{
					ShowPlayer(Source.url, IsAudioFormat(Source.format), false);
				}
			}
			catch
			{
				ReportPlayback('failed');
				// 권한이 없거나 재생 샘플이 사라져도 디코딩된 썸네일은 유지합니다.
				// 표시할 자료가 없으면 팝오버가 닫힌 상태로 남습니다.

			}
			finally
			{
				if (!Session.player)
				{
					Loading.remove();
					ReportPlayback('failed');
				}
			}
		})();
	}

	function Attach(Trigger, Load, GetStill, Capture, OnPlaybackState)
	{
		function ScheduleOpen()
		{
			clearTimeout(CloseTimer);
			if (Active?.trigger === Trigger || Pending?.trigger === Trigger)
			{
				return;
			}
			Close();
			Pending = { trigger: Trigger, timer: setTimeout(() =>
				{
					Pending = undefined;
					if (Trigger.isConnected)
					{
						Open(Trigger, Load, GetStill, Capture, OnPlaybackState);
					}
				}, RuntimePolicy.Preview.HoverOpenDelayMs) };
		}
		Bindings.set(Trigger, ScheduleOpen);
		Trigger.addEventListener('pointerenter', UiEvent =>
		{
			if (UiEvent.pointerType !== 'mouse' || !matchMedia('(any-hover: hover)').matches)
			{
				return;
			}
			RememberPointer(UiEvent);
			ScheduleOpen();
		});
		Trigger.addEventListener('pointerleave', UiEvent =>
		{
			CancelPending(Trigger);
			if (Active?.trigger === Trigger)
			{
				ScheduleClose(UiEvent.relatedTarget);
			}
		});
	}

	function ResumeHover(List)
	{
		if (!Pointer)
		{
			return;
		}
		const Trigger = document.elementFromPoint(Pointer.x, Pointer.y)?.closest('.candidate-preview');
		if (Trigger && List.contains(Trigger))
		{
			Bindings.get(Trigger)?.();
		}
	}

	return {
		attach: Attach, close: Close, resumeHover: ResumeHover,
		isHoveringWithin: List => List.contains(Active?.trigger ?? Pending?.trigger ?? null),
	};
}
