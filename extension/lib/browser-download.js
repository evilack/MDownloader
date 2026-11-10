/**
 * 브라우저 다운로드와 이름 결정을 연결합니다. Chrome ID가 도착하기 전에 이름 결정 이벤트가 올 수 있으므로 아직 등록 중인 요청도 ID가 확인될 때까지 추적합니다.
 * 파일 경로가 확정되거나 작업이 끝나면 감시를 해제합니다.
 */
import {AssertMediaAllowed} from './youtube-source-policy.js';
import {PrepareDistributionNetwork} from './distribution-network.js';
import {CanUseYoutube} from './distribution-policy.js';
const ConflictAction = 'uniquify';
const Naming = new Set();
const NamingById = new Map();
function Forget(Download)
{
	Naming.delete(Download);
	NamingById.delete(Download.id);
	if (Naming.size === 0)
	{
		chrome.downloads.onDeterminingFilename.removeListener(SuggestFilename);
	}
}

export async function DownloadNamedFile(Url, Filename, {saveAs} = {})
{
	AssertMediaAllowed({url: Url});
	if (!CanUseYoutube()) await PrepareDistributionNetwork();
	// 다른 확장이 파일명 결정을 감시하면 Chrome이 처음 전달한 이름을 사용하지 않을 수 있습니다.
	// 우리 작업의 경로가 정해지는 동안에만 이름 결정 이벤트를 구독합니다.
	if (Naming.size === 0)
	{
		chrome.downloads.onDeterminingFilename.addListener(SuggestFilename);
	}
	const Download = { url: Url, filename: Filename };
	Naming.add(Download);
	try
	{
		Download.start = chrome.downloads.download({ url: Url, filename: Filename, conflictAction: ConflictAction, ...(saveAs===undefined?{}:{saveAs}) });
		Download.id = await Download.start;
		NamingById.set(Download.id, Download);
		return Download.id;
	}
	catch (ErrorValue)
	{
		Forget(Download);
		throw ErrorValue;
	}
}

function SuggestFilename(Item, Suggest)
{
	if (Item.byExtensionId !== chrome.runtime.id)
	{
		Suggest();
		return;
	}
	const Download = NamingById.get(Item.id);
	if (Download)
	{
		Suggest({ filename: Download.filename, conflictAction: ConflictAction });
		return;
	}
	const Starting = [...Naming].filter(Download => Download.id === undefined && Download.url === Item.url);
	if (!Starting.length)
	{
		Suggest();
		return;
	}
	void (async () =>
	{
		// 같은 주소에서 두 작업을 시작하더라도 Chrome ID가 일치하는 요청의 이름을 제안합니다.
		const Filename = await Promise.any(Starting.map(async Download =>
		{
			if (await Download.start !== Item.id)
			{
				throw new Error('Different browser download');
			}
			return Download.filename;
		})).catch(() => undefined);
		if (Filename)
		{
			Suggest({ filename: Filename, conflictAction: ConflictAction });
		}
		else
		{
			Suggest();
		}
	})();
	return true;
}

export function ForgetDownloadFilename(Id)
{
	const Download = NamingById.get(Id);
	if (Download)
	{
		Forget(Download);
	}
}

export function FinishDownloadNaming(Change)
{
	if (Change.filename?.current || ['complete', 'interrupted'].includes(Change.state?.current))
	{
		ForgetDownloadFilename(Change.id);
	}
}
