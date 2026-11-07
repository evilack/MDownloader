/**
 * 옵션에서 진단 로그를 읽고 내보내거나 지웁니다. 로그는 전송 상태 확인에 필요한 코드와 수치만 표시하며 실제 미디어 주소는 보관하지 않습니다.
 */
import {
	ClearDownloadLog, DownloadLogKey, DownloadLogLimit, DownloadStageLabel, ReadDownloadLog, SetDownloadLogging,
} from './lib/download-log.js';
import { GetLocale, Translate } from './lib/i18n.js';
import { SettingKeys } from './lib/settings.js';
const ResultLabels = {
	started: 'view_state_starting', ok: 'opt_log_step_ok', complete: 'view_candidate_complete',
	failed: 'view_state_failed', canceled: 'view_state_canceled', 'http-error': 'view_state_failed',
};
export function BindDownloadLog(Enabled)
{
	const Toggle = document.querySelector('#log-downloads');
	const Empty = document.querySelector('#download-log-empty');
	const Output = document.querySelector('#download-log');
	const Copy = document.querySelector('#copy-download-log');
	const Clear = document.querySelector('#clear-download-log');
	const Status = document.querySelector('#download-log-status');
	const DateTime = new Intl.DateTimeFormat(GetLocale(), { dateStyle: 'short', timeStyle: 'medium' });
	const Count = new Intl.NumberFormat(GetLocale());
	const Announce = Key =>
	{
		Status.textContent = Key ? Translate(Key) : '';
	};
	document.querySelector('#download-log-help').textContent = Translate('opt_log_help', Count.format(DownloadLogLimit));
	function Render(Entries)
	{
		Output.value = Entries.slice().reverse().map(Entry =>
		{
			const Details = [DateTime.format(Entry.at)];
			if (Entry.requestId)
			{
				Details.push(Entry.requestId);
			}
			if (Entry.downloadId !== undefined)
			{
				Details.push(`#${Entry.downloadId}`);
			}
			if (Entry.stage)
			{
				Details.push(Translate(DownloadStageLabel(Entry.stage)));
			}
			Details.push(Translate(ResultLabels[Entry.result] ?? 'view_state_unknown'));
			if (Entry.status)
			{
				Details.push(Translate('view_diagnostics_http', Entry.status));
			}
			if (Entry.reason && Entry.reason !== 'job_browser_error')
			{
				const Reason = Translate(Entry.reason);
				// 번역문에 주소나 서버 이름을 대입할 수 있으므로 그런 인수를 요구하는 메시지는 진단 코드만 표시합니다.
				Details.push(/\$[a-z_\d]+\$/i.test(Reason) ? Entry.reason : Reason);
			}
			if (Entry.browserError)
			{
				Details.push(Entry.browserError);
			}
			return Details.join(' · ');
		}).join('\n');
		const bHasEntries = Entries.length > 0;
		Output.hidden = !bHasEntries;
		Empty.hidden = bHasEntries;
		Copy.disabled = Clear.disabled = !bHasEntries;
	}

	Toggle.disabled = Enabled === undefined;
	Toggle.checked = Enabled === true;
	Toggle.addEventListener('change', async () =>
	{
		const Checked = Toggle.checked;
		Toggle.disabled = true;
		Announce();
		try
		{
			await SetDownloadLogging(Checked);
		}
		catch
		{
			Toggle.checked = !Checked;
			Status.textContent = Translate('opt_setting_save_failed', Translate('opt_log_downloads'));
		}
		finally
		{
			Toggle.disabled = false;
		}
	});
	Copy.addEventListener('click', async () =>
	{
		try
		{
			await navigator.clipboard.writeText(Output.value);
			Announce('opt_log_copied');
		}
		catch
		{
			Announce('opt_log_copy_failed');
		}
	});
	Clear.addEventListener('click', async () =>
	{
		try
		{
			await ClearDownloadLog();
			Announce('opt_log_cleared');
		}
		catch
		{
			Announce('opt_log_clear_failed');
		}
	});
	let bUpdated = false;
	chrome.storage.onChanged.addListener((Changes, Area) =>
	{
		if (Area !== 'local')
		{
			return;
		}
		if (Changes[SettingKeys.logDownloads])
		{
			Toggle.checked = Changes[SettingKeys.logDownloads].newValue === true;
		}
		if (Changes[DownloadLogKey])
		{
			bUpdated = true;
			Render(Changes[DownloadLogKey].newValue ?? []);
		}
	});
	void (async () =>
	{
		try
		{
			const Entries = await ReadDownloadLog();
			if (!bUpdated)
			{
				Render(Entries);
			}
		}
		catch
		{
			Announce('opt_log_read_failed');
		}
	})();
}
