/** 실제 스토어 링크가 준비될 때까지 설치 안내 대화상자를 연결합니다. */
import {SiteCatalog} from './site-catalog.js';
const Locale = document.documentElement.lang === 'ko' ? 'ko' : 'en';
const Messages = SiteCatalog.messages[Locale];
const Dialog = document.querySelector('#notice-dialog');
function ShowNotice(Message)
{
	document.querySelector('#notice-body').textContent = Message;
	Dialog.showModal();
}
document.querySelectorAll('.dialog-close, .dialog-confirm').forEach(Button => Button.addEventListener('click', () => Dialog.close()));
Dialog?.addEventListener('click', Event =>
{
	if (Event.target === Dialog)
	{
		const Bounds = Dialog.getBoundingClientRect();
		if (Event.clientX < Bounds.left || Event.clientX > Bounds.right || Event.clientY < Bounds.top || Event.clientY > Bounds.bottom)
		{
			Dialog.close();
		}
	}
});
document.querySelectorAll('[data-store]').forEach(Button => Button.addEventListener('click', () =>
{
	const Store = SiteCatalog.stores[Button.dataset.store];
	if (!Store)
	{
		return;
	}
	if (Store.url)
	{
		window.location.assign(Store.url);
	}
	else
	{
		ShowNotice(Messages.storePending.replace('{store}', Store[Locale]));
	}
}));
