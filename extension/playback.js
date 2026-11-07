import { InitializeDebugLogging } from './lib/debug-runtime.js';
void InitializeDebugLogging();
/**
 * 개발자 도구 패널에서 원본 탭이 성공적으로 받은 HLS 응답을 수집합니다. 조각이 모두 있을 때만 저장 요청을 백그라운드로 인계합니다.
 * 인계 전까지는 이 패널이 임시 파일을 정리할 책임이 있고, 인계한 뒤에는 전송 문서가 처리합니다.
 */
import { ErrorText, GetLocale, InitializeLocale, LocalizePage, LocalizedError, Translate } from './lib/i18n.js';
import { IsFullPlaybackResponse, PlaybackHls, PlaybackScratchName, StorePlaybackSegment } from './lib/playback-hls.js';
import { SendRequest } from './lib/ui.js';
await InitializeLocale();
LocalizePage();
const Form = document.querySelector('#capture');
const Source = document.querySelector('#source');
const Start = document.querySelector('#start');
const Stop = document.querySelector('#stop');
const Save = document.querySelector('#save');
const Status = document.querySelector('#status');
const Coverage = document.querySelector('#coverage');
const CountFormat = new Intl.NumberFormat(GetLocale());
let Session;
async function CapturePlayback(Address)
{
	await navigator.locks.request(PlaybackScratchName, { ifAvailable: true }, async LocalLock =>
	{
		if (!LocalLock)
		{
			throw new LocalizedError('view_playback_busy');
		}
		const Root = await navigator.storage.getDirectory();
		// 이전 패널이 임시 파일을 정리하기 전에 닫혔을 수 있습니다. 수집 잠금을 얻은 후 남은 파일부터 지웁니다.
		await Root.removeEntry(PlaybackScratchName, { recursive: true }).catch(ErrorValue =>
		{
			if (ErrorValue.name !== 'NotFoundError')
			{
				throw ErrorValue;
			}
		});
		const Directory = await Root.getDirectoryHandle(PlaybackScratchName, { create: true });
		const RequestId = crypto.randomUUID();
		let bHandedOff = false;
		try
		{
			const Capture = new PlaybackHls(Address, (Filename, Bytes) => StorePlaybackSegment(Directory, Filename, Bytes));
			const Network = chrome.devtools.network;
			const PageTitle = new Promise(Resolve =>
			{
				chrome.devtools.inspectedWindow.eval('document.title', (Title, ErrorValue) =>
				{
					Resolve(!ErrorValue && typeof Title === 'string' ? Title : '');
				});
			});
			let Tail = Promise.resolve();
			let bFinished = false;
			let ResolveAction;
			const Action = new Promise(Resolve =>
			{
				ResolveAction = Resolve;
			});
			const Finish = (Choice, ErrorValue) =>
			{
				if (bFinished)
				{
					return;
				}
				bFinished = true;
				Network.onRequestFinished.removeListener(Observe);
				ResolveAction({ choice: Choice, error: ErrorValue });
			};
			function Observe(Entry)
			{
				// 수집할 수 없는 HTTP 응답은 대기열에 넣기 전에 거릅니다.
				// 앞선 재생목록이 조각 주소를 추가할 수 있으므로 URL 일치는 대기열의 처리 순서 안에서 검사합니다.
				if (!IsFullPlaybackResponse(Entry))
				{
					return;
				}
				Tail = Tail.then(async () =>
				{
					if (bFinished || Capture.complete)
					{
						return;
					}
					const PreviousCount = Capture.count;
					const PreviousReceived = Capture.received;
					await Capture.Accept(Entry);
					if (bFinished || (PreviousCount === Capture.count && PreviousReceived === Capture.received))
					{
						return;
					}
					Coverage.hidden = false;
					Coverage.textContent = Translate('view_playback_coverage', CountFormat.format(Capture.received), CountFormat.format(Capture.count));
					if (!PreviousCount)
					{
						Status.textContent = Translate('view_playback_collecting');
					}
					if (Capture.complete)
					{
						Network.onRequestFinished.removeListener(Observe);
						Status.textContent = Translate('view_playback_collected');
						Save.disabled = false;
					}
				}).catch(ErrorValue => Finish('error', ErrorValue));
			}
			const Navigated = () =>
			{
				if (!Capture.complete)
				{
					Finish('navigation');
				}
			};
			Session = {
				stop: () =>
				{
					if (!Stop.disabled)
					{
						Finish('cancel');
					}
				},
				save: async () =>
				{
					if (!Capture.complete || Save.disabled)
					{
						return;
					}
					Stop.disabled = Save.disabled = true;
					try
					{
						const { playlist: Playlist, bytes: Bytes } = Capture.LocalInput();
						await SendRequest('savePlayback', {
							requestId: RequestId, bytes: Bytes, count: Capture.count, pageTitle: await PageTitle,
							playlist: Playlist,
						});
						// 저장 요청을 인수한 전송 문서는 수집 잠금을 기다립니다. 이후 임시 파일 정리는 전송 문서가 담당합니다.
						bHandedOff = true;
						Finish('save');
					}
					catch (ErrorValue)
					{
						Status.textContent = ErrorText(ErrorValue);
						Stop.disabled = Save.disabled = false;
					}
				},
			};
			Network.onNavigated.addListener(Navigated);
			Network.onRequestFinished.addListener(Observe);
			Stop.disabled = false;
			Status.textContent = Translate('view_playback_waiting');
			try
			{
				const { choice: Choice, error: ErrorValue } = await Action;
				Stop.disabled = Save.disabled = true;
				await Tail;
				if (ErrorValue)
				{
					throw ErrorValue;
				}
				if (Choice === 'save')
				{
					Status.textContent = Translate('view_playback_saving');
				}
				else
				{
					Status.textContent = Translate(Choice === 'navigation' ? 'view_playback_page_changed' : 'view_playback_canceled');
				}
			}
			finally
			{
				Network.onNavigated.removeListener(Navigated);
				Network.onRequestFinished.removeListener(Observe);
			}
		}
		finally
		{
			if (!bHandedOff)
			{
				await Root.removeEntry(PlaybackScratchName, { recursive: true });
			}
		}
	});
}

Form.addEventListener('submit', async UiEvent =>
{
	UiEvent.preventDefault();
	if (Start.disabled)
	{
		return;
	}
	const Address = Source.value;
	Source.disabled = Start.disabled = true;
	Coverage.hidden = true;
	Status.textContent = Translate('view_playback_preparing');
	try
	{
		await CapturePlayback(Address);
	}
	catch (ErrorValue)
	{
		Status.textContent = ErrorText(ErrorValue);
	}
	finally
	{
		Session = undefined;
		Stop.disabled = Save.disabled = true;
		Source.disabled = Start.disabled = false;
	}
});
Stop.addEventListener('click', () => Session?.stop());
Save.addEventListener('click', () => Session?.save());
