/** Fixed-destination issue submission, owned by the extension service worker. */
import {LocalizedError, SerializeError} from './i18n.js';

const Endpoint = 'https://formsubmit.co/ajax/evilackyt01@gmail.com';
// One stable app identity: FormSubmit activation is tied to the submitting source.
const SubmissionSource = 'https://evilack.github.io/';
const IssueTypes = Object.freeze({detection:'url_detection_failed', download:'download_failed', other:'other'});
const SourceRuleId = 2147000001;
let HeaderUpdates = Promise.resolve();

/** FormSubmit AJAX requires an HTTP Referer even when _url is present.
 * Serialize the rule lifetime so one send cannot remove another send's header.
 */
function WithSourceHeader(Api, Send)
{
	const Pending = HeaderUpdates.catch(() => {}).then(async () =>
	{
		await Api.declarativeNetRequest.updateSessionRules({removeRuleIds: [SourceRuleId], addRules: [{
			id: SourceRuleId, priority: 1,
			condition: {urlFilter: '|' + Endpoint + '|', initiatorDomains: [Api.runtime.id], requestMethods: ['post'], resourceTypes: ['xmlhttprequest']},
			action: {type: 'modifyHeaders', requestHeaders: [
				{header: 'referer', operation: 'set', value: SubmissionSource},
				{header: 'origin', operation: 'set', value: new URL(SubmissionSource).origin},
			]},
		}]});
		try { return await Send(); }
		finally
		{
			// Cleanup must not turn an accepted report into a retryable failure.
			// The next submission replaces this exact, extension-only session rule.
			await Api.declarativeNetRequest.updateSessionRules({removeRuleIds: [SourceRuleId]}).catch(() => {});
		}
	});
	HeaderUpdates = Pending.then(() => {}, () => {});
	return Pending;
}

export async function SubmitIssueReport(Input, {Api = chrome, Fetch = globalThis.fetch, Now} = {})
{
	let Page;
	try { Page = new URL(Input?.pageUrl); } catch { throw new LocalizedError('issue_report_invalid_page'); }
	if (!['http:', 'https:'].includes(Page.protocol) || Page.href.length > 8192)
		throw new LocalizedError('issue_report_invalid_page');
	if (!Array.isArray(Input.types) || !Input.types.length || Input.types.length > 3 ||
		Input.types.some(Type => !Object.hasOwn(IssueTypes, Type))) throw new LocalizedError('issue_report_select_type');
	if (typeof Input.description !== 'string' || Input.description.length > 2000)
		throw new LocalizedError('issue_report_failed');
	return WithSourceHeader(Api, async () =>
	{
		Now ??= new Date();
		const Report = {
			app: 'MDownloader', extension_version: Api.runtime.getManifest().version,
			reported_at: Now.toISOString(), page_url: Page.href,
			issue_types: Object.keys(IssueTypes).filter(Type => Input.types.includes(Type)).map(Type => IssueTypes[Type]),
			description: Input.description.trim(),
		};
		const SendingTime = new Date(Now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
		const Suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
		const Subject = `MDownloader_report_${SendingTime}_${Suffix}`;
		let ResponseValue;
		try
		{
			ResponseValue = await Fetch(Endpoint, {
				method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
				credentials: 'omit', signal: AbortSignal.timeout(20000),
				// The app source stays fixed; the reported page is preserved in message.page_url.
				body: JSON.stringify({_subject: Subject, _url: SubmissionSource, message: JSON.stringify(Report, null, 2)}),
			});
		}
		catch { throw new LocalizedError('issue_report_network_error'); }
		if (!ResponseValue.ok) throw new LocalizedError('issue_report_failed');
		let Result;
		try { Result = await ResponseValue.json(); } catch { throw new LocalizedError('issue_report_network_error'); }
		if (Result?.success !== true && Result?.success !== 'true')
		{
			throw new LocalizedError(/needs activation/i.test(Result?.message || '') ? 'issue_report_activation' : 'issue_report_failed');
		}
		return {subject: Subject};
	});
}

export function HandleIssueReport(Message, Sender, Respond, Api = chrome)
{
	if (Message?.type !== 'submitIssueReport') return false;
	const Root = Api.runtime.getURL('');
	const Source = Sender.url?.split('?')[0];
	if (Sender.id !== Api.runtime.id || ![Root + 'popup.html', Root + 'sidepanel.html'].includes(Source)) return false;
	void SubmitIssueReport(Message.report, {Api}).then(
		Data => Respond({ok: true, data: Data}), ErrorValue => Respond({ok: false, error: SerializeError(ErrorValue)}));
	return true;
}
