import { DebugLog } from './lib/debug-log.js';
import { Units } from './lib/runtime-policy.js';
import { ErrorText, GetLocale, Translate } from './lib/i18n.js';
import { CreateButton, CreateElement, SendRequest, SetButtonIcon, SetControlLabel } from './lib/ui.js';
import { IsStreamFormat, MediaFormat } from './lib/media.js';
function CreateQualityDialog()
{
	const Dialog = CreateElement('dialog', '', 'quality-dialog');
	Dialog.id = 'quality-dialog';
	const Title = CreateElement('h2', Translate('html_choose_quality'));
	Title.id = 'quality-title';
	Dialog.setAttribute('aria-labelledby', Title.id);
	const Form = CreateElement('form');
	Form.method = 'dialog';
	const Label = CreateElement('label', Translate('html_resolution_bitrate'));
	const Select = CreateElement('select', '', 'quality');
	Select.id = 'quality';
	Select.autofocus = true;
	Label.htmlFor = Select.id;
	const Status = CreateElement('p', '', 'notice');
	Status.id = 'quality-status';
	Status.setAttribute('role', 'status');
	// 콤보박스는 남은 폭을 사용하고, 아이콘 버튼은 오른쪽에서 고정 크기를 유지합니다.
	const Controls = CreateElement('div', '', 'quality-controls');
	const Actions = CreateElement('div', '', 'actions');
	const Cancel = SetButtonIcon(CreateButton('', () => Dialog.close()), Translate('html_cancel'), 'cancel');
	Cancel.id = 'cancel-quality';
	const Confirm = SetButtonIcon(CreateElement('button', '', 'primary'), Translate('html_download_selected_quality'), 'download');
	Confirm.type = 'submit';
	Confirm.id = 'confirm-quality';
	Actions.append(Cancel, Confirm);
	Controls.append(Select, Actions);
	Form.append(Label, Controls, Status);
	Dialog.append(Title, Form);
	return { dialog: Dialog, select: Select, status: Status, confirm: Confirm };
}

/** 한 목록의 다운로드 요청과 화질 선택 창을 함께 관리합니다.
 * 브라우저 권한 요청은 클릭 직후 시작합니다. 목록이 바뀐 뒤 도착한 응답은 현재 행을 수정하지 않습니다.
 */
export function CreateCandidateDownloadActions(Announce, OnActionFinished, AwaitScan = async () =>
{
})
{
	const { dialog: QualityDialog, select: QualitySelect, status: QualityStatus, confirm: ConfirmQuality } = CreateQualityDialog();
	const BandwidthFormat = new Intl.NumberFormat(GetLocale(), { maximumFractionDigits: 3 });
	let ActiveActions = 0;
	function ChooseQuality(Qualities, Trigger)
	{
		// 각 목록 행의 바로 다음에 독립 영역을 삽입합니다. 고정 좌표 팝업과 달리
		// 좁은 확장 팝업에서도 아래쪽 내용까지 스크롤할 수 있고 원래 행의 높이는 바뀌지 않습니다.
		const Slot = CreateElement('li', '', 'quality-slot');
		Slot.append(QualityDialog);
		Trigger.closest('.candidate').after(Slot);
		QualitySelect.replaceChildren(...Qualities.map(({ resolution: Resolution, bandwidth: Bandwidth }, Index) =>
		{
			const Rate = Bandwidth >= Units.DecimalMega ? Translate('view_unit_megabits', BandwidthFormat.format(Bandwidth / Units.DecimalMega))
			: Translate('view_unit_kilobits', BandwidthFormat.format(Bandwidth / Units.DecimalKilo));
			const Label = Translate('view_quality_details', Resolution ? Resolution.replace('x', '×') : Translate('view_quality_no_resolution'), Rate);
			return new Option(Label, String(Index));
		}));
		QualityDialog.returnValue = '';
		QualityStatus.textContent = '';
		ConfirmQuality.disabled = false;
		const Listeners = new AbortController();
		const { signal: Signal } = Listeners;
		return new Promise(Resolve =>
		{
			QualityDialog.addEventListener('close', () =>
			{
				Listeners.abort();
				Slot.remove();
				Trigger.focus();
				Resolve(QualityDialog.returnValue || null);
			}, { once: true });
			// show()는 비모달이므로 Esc 처리를 직접 연결합니다. 목록 이동으로 닫을 때도
			// 같은 close 경로가 리스너와 삽입 영역을 정리하고 등록을 취소합니다.
			QualityDialog.addEventListener('keydown', UiEvent =>
			{
				if (UiEvent.key !== 'Escape')
				{
					return;
				}
				UiEvent.preventDefault();
				QualityDialog.close();
			}, { signal: Signal });
			ConfirmQuality.form.addEventListener('submit', async UiEvent =>
			{
				if (UiEvent.submitter !== ConfirmQuality)
				{
					return;
				}
				UiEvent.preventDefault();
				const Selected = Qualities[QualitySelect.selectedIndex];
				ConfirmQuality.disabled = true;
				try
				{
					if (Selected.serverPermission &&
					!await chrome.permissions.request({ origins: [Selected.serverPermission] }))
					{
						if (!Signal.aborted)
						{
							QualityStatus.textContent = Translate('view_quality_allow_server');
						}
						return;
					}
					if (!Signal.aborted)
					{
						if (DebugLog.IsEnabled())
						{
							DebugLog.Record('QualitySelected', () => ({ variantIndex: QualitySelect.selectedIndex, bandwidth: Selected.bandwidth }));
						}
						QualityDialog.close(Selected.url);
					}
				}
				catch
				{
					if (!Signal.aborted)
					{
						QualityStatus.textContent = Translate('view_permission_failed');
					}
				}
				finally
				{
					if (!Signal.aborted)
					{
						ConfirmQuality.disabled = false;
					}
				}
			}, { signal: Signal });
			QualityDialog.show();
			QualitySelect.focus();
			QualityDialog.scrollIntoView({ block: 'nearest' });
		});
	}

	function CreateDownloadButton(Candidate, Input, IsCurrent)
	{
		const bIsHls = Candidate.format === MediaFormat.Hls;
		const BaseLabel = Translate(Candidate.serverPermission ? 'view_download_with_permission' : 'view_download');
		const DownloadLabel = bIsHls ? Translate('view_download_quality_hint', BaseLabel) : BaseLabel;
		const Download = CreateButton('', async UiEvent =>
		{
			// 키를 계속 감시하거나 설정을 읽지 않고 클릭 순간의 의도만 고정합니다.
			// 권한 요청·스캔을 기다리는 동안 Shift를 놓아도 이 클릭의 화질 선택은 유지됩니다.
			const bChooseQuality = UiEvent?.shiftKey === true;
			if (DebugLog.IsEnabled())
			{
				DebugLog.Record('QualitySelected', () => ({ bChooseQuality: bChooseQuality }));
			}
			if (bIsHls && ActiveActions)
			{
				return;
			}
			ActiveActions++;
			Download.disabled = true;
			SetControlLabel(Download, Translate('view_download_queueing'));
			Announce(Translate('view_download_queueing'));
			const RequestId = crypto.randomUUID();
			try
			{
				if (Candidate.serverPermission &&
				!await chrome.permissions.request({ origins: [Candidate.serverPermission] }))
				{
					Download.disabled = false;
					SetControlLabel(Download, DownloadLabel);
					Announce(Translate('view_permission_denied'));
					return;
				}
				// 유지 중인 행은 자동 검사가 확정된 뒤 최신 스캔 식별자로 요청합니다.
				await AwaitScan();
				if (!IsCurrent())
				{
					Download.disabled = false;
					SetControlLabel(Download, DownloadLabel);
					return;
				}
				let VariantUrl;
				if (bIsHls && bChooseQuality)
				{
					Announce(Translate('view_quality_checking'));
					const Qualities = await SendRequest('hlsQualities', Input);
					if (!IsCurrent())
					{
						return;
					}
					if (Qualities.length > 1)
					{
						VariantUrl = await ChooseQuality(Qualities, Download);
						if (!IsCurrent())
						{
							return;
						}
						if (!VariantUrl)
						{
							Download.disabled = false;
							SetControlLabel(Download, DownloadLabel);
							Download.focus();
							Announce(Translate('view_quality_canceled'));
							return;
						}
					}
				}
				const Job = await SendRequest('enqueue', { ...Input, requestId: RequestId, variantUrl: VariantUrl });
				if (!IsCurrent())
				{
					return;
				}
				if (Job.state === 'started')
				{
					SetControlLabel(Download, Translate('view_download_started'));
					Announce(IsStreamFormat(Candidate.format) ? '' : Translate('view_download_started'));
				}
				else
				{
					SetControlLabel(Download, Translate(Job.state === 'failed' ? 'view_download_failed_start' : 'view_download_check'));
					Announce(Translate('view_download_check_manager'));
				}
			}
			catch (ErrorValue)
			{
				if (!IsCurrent())
				{
					return;
				}
				Download.disabled = false;
				SetControlLabel(Download, DownloadLabel);
				Announce(ErrorText(ErrorValue));
			}
			finally
			{
				ActiveActions--;
				// 행이 재사용돼도 등록이 끝난 버튼은 다시 사용할 수 있어야 합니다.
				Download.disabled = false;
				SetControlLabel(Download, DownloadLabel);
				OnActionFinished();
			}
		}, true);
		return SetButtonIcon(Download, DownloadLabel, 'download');
	}

	return {
		CreateDownloadButton,
		IsBusy: () => ActiveActions > 0,
		CloseQuality: () =>
		{
			if (QualityDialog.open)
			{
				QualityDialog.close();
			}
		},
	};
}
