/** Confirmed reports are sent by the service worker to FormSubmit. */
import {ErrorText, Translate} from './lib/i18n.js';
import {CreateButton, CreateElement, SendRequest} from './lib/ui.js';

/** A native modal makes the report underneath inert, including its read-only URL. */
function ShowReportMessage(Message, Stage)
{
	const Dialog = CreateElement('dialog', '', 'issue-report-dialog issue-report-message');
	Dialog.dataset.issueReportStage = Stage;
	Dialog.setAttribute('closedby', 'none');
	const Form = CreateElement('form');
	Form.method = 'dialog';
	const Header = CreateElement('header');
	const Title = CreateElement('h2', Translate('issue_report_title'));
	Title.id = 'issue-report-message-' + crypto.randomUUID();
	Dialog.setAttribute('aria-labelledby', Title.id);
	Header.append(Title);
	const Body = CreateElement('div', '', 'issue-report-message-body');
	const Text = CreateElement('p', Message);
	Text.id = Title.id + '-text';
	Dialog.setAttribute('aria-describedby', Text.id);
	Body.append(Text);
	Form.append(Header, Body);
	if (Stage === 'sending')
	{
		const Progress = CreateElement('progress');
		Progress.setAttribute('aria-label', Message);
		Body.append(Progress);
	}
	else
	{
		const Footer = CreateElement('footer');
		const Confirm = CreateElement('button', Translate('issue_report_confirm'), 'primary');
		Confirm.type = 'submit';
		Confirm.value = 'confirm';
		Confirm.autofocus = true;
		Footer.append(Confirm);
		Form.append(Footer);
	}
	Dialog.append(Form);
	// Explicit acknowledgement is required; this also supports Chrome versions without closedby.
	Dialog.addEventListener('cancel', Event => Event.preventDefault());
	const Confirmed = new Promise(Resolve => Dialog.addEventListener('close', () =>
	{
		const Accepted = Dialog.returnValue === 'confirm';
		Dialog.returnValue = '';
		Dialog.remove();
		Resolve(Accepted);
	}, {once: true}));
	document.body.append(Dialog);
	Dialog.showModal();
	return {dialog: Dialog, confirmed: Confirmed};
}

export function ShowIssueReportDialog(Page)
{
	if (document.querySelector('.issue-report-dialog[open]')) return;
	const Id = 'issue-report-' + crypto.randomUUID();
	const Dialog = CreateElement('dialog', '', 'issue-report-dialog');
	const Form = CreateElement('form');
	Form.method = 'dialog';
	const Header = CreateElement('header');
	const Title = CreateElement('h2', Translate('issue_report_title'));
	Title.id = Id + '-title';
	Dialog.setAttribute('aria-labelledby', Title.id);
	Dialog.setAttribute('closedby', 'closerequest');
	Header.append(Title);
	const Body = CreateElement('div', '', 'issue-report-body');
	const Intro = CreateElement('p', Translate('issue_report_intro'));
	Intro.id = Id + '-intro';
	Dialog.setAttribute('aria-describedby', Intro.id);
	const PageField = CreateElement('div', '', 'issue-report-field');
	const PageLabel = CreateElement('label', Translate('issue_report_page'));
	const PageUrl = CreateElement('input');
	PageUrl.id = Id + '-page';
	PageUrl.type = 'text';
	PageUrl.readOnly = true;
	PageUrl.value = Page?.url || Translate('issue_report_page_unavailable');
	PageUrl.title = PageUrl.value;
	PageLabel.htmlFor = PageUrl.id;
	PageField.append(PageLabel, PageUrl);
	const Types = CreateElement('fieldset', '', 'issue-report-types');
	const Legend = CreateElement('legend', Translate('issue_report_types'));
	const TypeHint = CreateElement('p', Translate('issue_report_multiple'), 'muted');
	TypeHint.id = Id + '-type-hint';
	Types.setAttribute('aria-describedby', TypeHint.id);
	Types.append(Legend, TypeHint);
	const Choices = CreateElement('div', '', 'issue-report-choices');
	for (const Type of ['detection', 'download', 'other'])
	{
		const Input = CreateElement('input');
		Input.type = 'checkbox';
		Input.name = 'issueType';
		Input.value = Type;
		Input.id = Id + '-' + Type;
		Input.autofocus = Type === 'detection';
		const Label = CreateElement('label', '', 'issue-report-choice');
		Label.htmlFor = Input.id;
		Label.append(Input, CreateElement('span', Translate('issue_report_' + Type)));
		Choices.append(Label);
	}
	Types.append(Choices);
	const DetailsField = CreateElement('div', '', 'issue-report-field');
	const DetailsLabel = CreateElement('label', Translate('issue_report_details'));
	const Details = CreateElement('textarea');
	Details.id = Id + '-details';
	Details.name = 'details';
	Details.rows = 3;
	Details.maxLength = 2000;
	Details.placeholder = Translate('issue_report_placeholder');
	DetailsLabel.htmlFor = Details.id;
	DetailsField.append(DetailsLabel, Details);
	const Question = CreateElement('p', Translate('issue_report_question'), 'issue-report-question');
	const Notice = CreateElement('p', Translate('issue_report_send_notice'), 'muted');
	const Feedback = CreateElement('p', '', 'issue-report-feedback');
	Feedback.setAttribute('role', 'status');
	Body.append(Intro, PageField, Types, DetailsField, Question, Notice, Feedback);
	const Footer = CreateElement('footer');
	const Cancel = CreateButton(Translate('html_cancel'), () => Dialog.close());
	const Confirm = CreateElement('button', Translate('issue_report_confirm'), 'primary');
	Confirm.type = 'submit';
	Footer.append(Cancel, Confirm);
	Form.append(Header, Body, Footer);
	Dialog.append(Form);
	let Sending = false, Sent = false, ShowingResult = false;
	Form.addEventListener('submit', async Event =>
	{
		Event.preventDefault();
		if (Sending || Sent || ShowingResult) return;
		const Selected = [...Form.querySelectorAll('input[name="issueType"]:checked')];
		if (!Selected.length)
		{
			Feedback.dataset.error = 'true';
			Feedback.textContent = Translate('issue_report_select_type');
			Choices.querySelector('input').focus();
			Feedback.scrollIntoView({block: 'nearest'});
			return;
		}
		Sending = true;
		Feedback.dataset.error = 'false';
		Feedback.textContent = Translate('issue_report_sending');
		Form.setAttribute('aria-busy', 'true');
		for (const Control of [...Choices.querySelectorAll('input'), Details, Cancel, Confirm]) Control.disabled = true;
		const Pending = ShowReportMessage(Translate('issue_report_sending'), 'sending');
		try
		{
			await SendRequest('submitIssueReport', {report: {pageUrl: Page?.url || '', types: Selected.map(Input => Input.value), description: Details.value}});
			Sent = true;
			Feedback.textContent = Translate('issue_report_sent');
			Cancel.textContent = Translate('issue_report_close');
		}
		catch (ErrorValue)
		{
			Feedback.dataset.error = 'true';
			Feedback.textContent = ErrorText(ErrorValue, 'issue_report_failed');
		}
		finally
		{
			Sending = false;
			ShowingResult = true;
			Form.removeAttribute('aria-busy');
			Cancel.disabled = false;
			if (!Sent) for (const Control of [...Choices.querySelectorAll('input'), Details, Confirm]) Control.disabled = false;
			Pending.dialog.close();
		}
		const Result = ShowReportMessage(Feedback.textContent, 'result');
		const Accepted = await Result.confirmed;
		ShowingResult = false;
		if (Sent && Accepted) Dialog.close();
		else if (Sent) Cancel.focus();
		else Confirm.focus();
	});
	Types.addEventListener('change', () => { Feedback.textContent = ''; });
	Dialog.addEventListener('cancel', Event => { if (Sending || ShowingResult) Event.preventDefault(); });
	Dialog.addEventListener('close', () => Dialog.remove(), {once: true});
	document.body.append(Dialog);
	Dialog.showModal();
}
