/**
 * 사이트별 권한과 전체 사이트 권한을 브라우저에 요청하는 영역입니다. 허용과 해제 결과는 요청마다 검사하며 실패한 사이트가 있을 때 부분 성공을 구분합니다.
 */
import { HostPattern } from './lib/media.js';
import { Translate } from './lib/i18n.js';

/** 사이트 접근은 브라우저에 선언된 권한 범위에서만 변경합니다. */
export function BindNetworkAccess(Form)
{
	BindAllSitesAccess(Form);
	BindSiteAccess(Form);
}

function BindAllSitesAccess(NetworkForm)
{
	const Button = document.querySelector('#all-sites-access');
	const Status = document.querySelector('#all-sites-status');
	const LocalPermissions = { origins: chrome.runtime.getManifest().optional_host_permissions };
	let bAllowed = false;
	async function Refresh()
	{
		try
		{
			bAllowed = await chrome.permissions.contains(LocalPermissions);
			Button.textContent = Translate(bAllowed ? 'opt_revoke_all_sites' : 'opt_allow_all_sites');
			NetworkForm.hidden = bAllowed;
			Button.disabled = false;
		}
		catch
		{
			Status.textContent = Translate('opt_all_sites_check_failed');
		}
	}

	Button.addEventListener('click', async () =>
	{
		const bRevoke = bAllowed;
		Button.disabled = true;
		Status.textContent = '';
		try
		{
			if (bRevoke)
			{
				const Removed = await chrome.permissions.remove(LocalPermissions);
				Status.textContent = Translate(Removed ? 'opt_all_sites_revoked' : 'opt_all_sites_revoke_failed');
			}
			else
			{
				const Granted = await chrome.permissions.request(LocalPermissions);
				Status.textContent = Translate(Granted ? 'opt_all_sites_granted' : 'opt_all_sites_denied');
			}
		}
		catch
		{
			Status.textContent = Translate(bRevoke ? 'opt_all_sites_revoke_failed' : 'opt_all_sites_request_failed');
		}
		finally
		{
			await Refresh();
		}
	});
	void Refresh();
}

function BindSiteAccess(Form)
{
	const Inputs = [Form.querySelector('#site'), Form.querySelector('#cdn')];
	const Status = Form.querySelector('#network-status');
	const Buttons = Form.querySelectorAll('button');
	for (const Input of Inputs)
	{
		Input.addEventListener('input', () => Input.setCustomValidity(''));
	}

	Form.addEventListener('submit', async UiEvent =>
	{
		UiEvent.preventDefault();
		const Origins = new Set();
		for (const Input of Inputs)
		{
			const Value = Input.value.trim();
			if (!Value && !Input.required)
			{
				continue;
			}
			const Origin = HostPattern(Value);
			if (!Origin || Origin.slice(0, Origin.lastIndexOf('/')).includes('*'))
			{
				Input.setCustomValidity(Translate('opt_invalid_site_url'));
				Input.reportValidity();
				return;
			}
			Origins.add(Origin);
		}

		const LocalPermissions = { origins: [...Origins] };
		const bRevoke = UiEvent.submitter?.id === 'revoke-network';
		for (const Button of Buttons)
		{
			Button.disabled = true;
		}
		Status.textContent = '';
		try
		{
			if (bRevoke)
			{
				let Removed = 0;
				for (const Origin of Origins)
				{
					if (await chrome.permissions.remove({ origins: [Origin] }).catch(() => false))
					{
						Removed++;
					}
				}
				if (Removed === Origins.size)
				{
					Status.textContent = Translate('opt_network_revoked');
				}
				else if (Removed)
				{
					Status.textContent = Translate('opt_network_partially_revoked');
				}
				else
				{
					Status.textContent = Translate('opt_network_sites_revoke_failed');
				}
			}
			else
			{
				// Chrome 권한 요청은 사용자 입력에 연결되어야 합니다. 요청 전에 다른 비동기 작업을 시작하지 않습니다.
				const Granted = await chrome.permissions.request(LocalPermissions);
				Status.textContent = Translate(Granted ? 'opt_network_granted' : 'opt_network_denied');
			}
		}
		catch
		{
			Status.textContent = Translate(bRevoke ? 'opt_network_revoke_failed' : 'opt_network_request_failed');
		}
		finally
		{
			for (const Button of Buttons)
			{
				Button.disabled = false;
			}
		}
	});
}
