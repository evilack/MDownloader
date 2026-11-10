/**
 * 확장 화면에서 공통으로 쓰는 DOM 생성, 아이콘 버튼, 요청, 링크 복사 도구입니다. Chrome API로 전달하는 메시지의 필드 구조는 화면 사이에서 동일하게 유지합니다.
 */
import { ReceivedError, Translate } from './i18n.js';
import { DebugLog } from './debug-log.js';
import { IconCatalog } from './icon-catalog.js';
export function CreateElement(Tag, TextValue, ClassName)
{
	const LocalNode = document.createElement(Tag);
	if (TextValue)
	{
		LocalNode.textContent = TextValue;
	}
	if (ClassName)
	{
		LocalNode.className = ClassName;
	}
	return LocalNode;
}

export function CreateButton(Label, Handler, bPrimary = false)
{
	const LocalNode = CreateElement('button', Label, bPrimary ? 'primary' : '');
	LocalNode.type = 'button';
	LocalNode.addEventListener('click', Handler);
	return LocalNode;
}

/** 아이콘 버튼의 표시 이름과 스크린 리더 이름을 함께 갱신합니다. */
export function SetControlLabel(Control, Label)
{
	Control.setAttribute('aria-label', Label);
	Control.title = Label;
}

export function SetButtonIcon(Control, Label, Name)
{
	Control.classList.add('icon-button');
	SetControlLabel(Control, Label);
	const Icon = CreateElement('img', '', 'button-icon');
	Icon.src = IconCatalog.actions[Name];
	Icon.alt = '';
	Control.replaceChildren(Icon);
	return Control;
}

export function MountOptionsButton(Header, Announce)
{
	const Control = CreateButton('', async () =>
	{
		try
		{
			await chrome.runtime.openOptionsPage();
		}
		catch
		{
			Announce(Translate('view_options_failed'));
		}
	});
	Control.id = 'options';
	SetButtonIcon(Control, Translate('html_options'), 'options');
	let Actions=Header.querySelector('.window-actions');
	if(!Actions) {Actions=CreateElement('div','','window-actions');Header.append(Actions);}
	Actions.append(Control);
}

export async function SendRequest(Type, Data = {})
{
	const Started = DebugLog.IsEnabled() ? performance.now() : undefined;
	if (DebugLog.IsEnabled())
	{
		DebugLog.Record('RequestStarted', () => ({ operation: Type, requestId: Data.requestId }));
	}
	try
	{
		const HttpResponse = await chrome.runtime.sendMessage({ type: Type, ...Data });
		if (!HttpResponse?.ok)
		{
			throw ReceivedError(HttpResponse?.error);
		}
		if (DebugLog.IsEnabled())
		{
			DebugLog.Record('RequestFinished', () => ({ operation: Type, requestId: Data.requestId, result: HttpResponse.data?.state,
				count: HttpResponse.data?.candidates?.length, durationMs: Started === undefined ? undefined : performance.now() - Started }));
		}
		return HttpResponse.data;
	}
	catch (ErrorValue)
	{
		if (DebugLog.IsEnabled())
		{
			DebugLog.Record('RequestFailed', () => ({ operation: Type, error: ErrorValue, durationMs: Started === undefined ? undefined : performance.now() - Started }));
		}
		throw ErrorValue;
	}
}

export async function CopyLink(Load, Announce)
{
	try
	{
		await navigator.clipboard.writeText(await Load());
		Announce(Translate('view_copy_success'));
	}
	catch
	{
		Announce(Translate('view_copy_failed'));
	}
}
