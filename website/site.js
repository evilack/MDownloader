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

const ManagerPreview = document.querySelector('iframe[data-fit-preview]');
if (ManagerPreview)
{
	let Observer;
	function FitManagerPreview()
	{
		Observer?.disconnect();
		const Preview = ManagerPreview.contentDocument;
		const Header = Preview?.querySelector('body > header');
		const Main = Preview?.querySelector('body > main');
		if (!Header || !Main)
		{
			return;
		}

		// The preview body has a viewport-height minimum. Measure its content so the frame can also shrink.
		Observer = new ResizeObserver(() =>
		{
			const ContentHeight = Main.getBoundingClientRect().bottom + Preview.defaultView.scrollY;
			const BorderHeight = ManagerPreview.offsetHeight - ManagerPreview.clientHeight;
			ManagerPreview.style.height = Math.ceil(ContentHeight + BorderHeight) + 'px';
		});
		Observer.observe(Header, {box: 'border-box'});
		Observer.observe(Main, {box: 'border-box'});
	}

	ManagerPreview.addEventListener('load', FitManagerPreview);
	FitManagerPreview();
}
