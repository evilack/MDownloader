const DismissedKey = 'siteAccessIntroDismissed';

export async function MountSiteAccessIntro()
{
	const Intro = document.querySelector('[data-site-access-intro]');
	const Dismiss = Intro.querySelector('[data-site-access-dismiss]');
	const Link = Intro.querySelector('a');
	let Dismissed = false;
	chrome.storage.onChanged.addListener((Changes, Area) =>
	{
		if (Area !== 'local' || !Changes[DismissedKey]?.newValue) return;
		Dismissed = true;
		Intro.hidden = true;
	});
	async function SaveDismissal()
	{
		await chrome.storage.local.set({[DismissedKey]: true});
		Dismissed = true;
		Intro.hidden = true;
	}
	Dismiss.addEventListener('click', async () =>
	{
		try
		{
			await SaveDismissal();
		}
		catch
		{
			Intro.hidden = true;
		}
	});
	// Keep the settings link usable even if storing the first-use state fails.
	Link.addEventListener('click', () => void SaveDismissal().catch(() => {}));
	const Stored = await chrome.storage.local.get(DismissedKey).catch(() => ({}));
	Intro.hidden = Dismissed || Stored[DismissedKey] === true;
}
