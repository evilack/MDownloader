/** GIF 재생 상태와 안내 대화상자를 연결합니다. 모션 축소 설정은 시작 시점과 변경
 * 이벤트에서 적용하며 사용자 버튼 상태·접근성 이름을 같은 카탈로그로 갱신합니다. */
import {SiteCatalog} from './site-catalog.js';
const Locale = document.documentElement.lang === 'ko' ? 'ko' : 'en';
const Messages = SiteCatalog.messages[Locale];
const SampleMotion = document.querySelector('#sample-motion');
const MotionToggle = document.querySelector('.capture-motion-toggle');
if (SampleMotion && MotionToggle)
{
	const MotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
	let bPlaying = false;
	function SetMotion(bEnabled)
	{
		bPlaying = bEnabled;
		SampleMotion.src = bEnabled ? SampleMotion.dataset.animatedSrc : SampleMotion.dataset.stillSrc;
		MotionToggle.textContent = bEnabled ? Messages.pause : Messages.play;
		MotionToggle.setAttribute('aria-label', bEnabled ? Messages.pauseLabel : Messages.playLabel);
	}
	SetMotion(!MotionPreference.matches);
	MotionToggle.hidden = false;
	MotionToggle.addEventListener('click', () => SetMotion(!bPlaying));
	MotionPreference.addEventListener('change', Event => SetMotion(!Event.matches));
}
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
