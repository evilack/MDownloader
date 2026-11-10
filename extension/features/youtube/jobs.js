import {EnsureRunner} from '../../hls-jobs.js';
import {LocalizedError, ReceivedError} from '../../lib/i18n.js';
import {IdentifyYoutubeUrl} from '../../lib/youtube-source-policy.js';
import {CanUseYoutube} from '../../lib/distribution-policy.js';
import {ReadAuthorizedYoutubePlayer} from './watch-player.js';
const RuleId = 2146999997;
let Users = 0;
let RuleQueue = Promise.resolve();
function Context(Change)
{
	const Next = RuleQueue.then(async () => {
		const NextUsers = Math.max(0, Users + Change);
		await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [RuleId], addRules: NextUsers ? [{id: RuleId, priority: 2,
			condition: {urlFilter: '|https://www.youtube.com/youtubei/', initiatorDomains: [chrome.runtime.id], requestMethods: ['post'], resourceTypes: ['xmlhttprequest']},
			action: {type: 'modifyHeaders', requestHeaders: [{header: 'Origin', operation: 'set', value: 'https://www.youtube.com'}, {header: 'Referer', operation: 'set', value: 'https://www.youtube.com/'}]}}] : []});
		Users = NextUsers;
	});
	RuleQueue = Next.catch(() => {}); return Next;
}
export function SetYoutubeRequestContext(Enabled)
{
	if (!CanUseYoutube()) throw new LocalizedError('youtube_distribution_disabled');
	if (typeof Enabled !== 'boolean') throw new LocalizedError('job_invalid_request');
	return Context(Enabled ? 1 : -1);
}
async function Request(Type, Fields)
{
	if (!CanUseYoutube()) throw new LocalizedError('youtube_distribution_disabled');
	await EnsureRunner();
	const Result = await chrome.runtime.sendMessage({type: Type, ...Fields});
	if (!Result?.ok) throw ReceivedError(Result?.error, 'youtube_extraction_failed');
	return Result.data;
}
export async function DiscoverYoutube(Item)
{
	if (!CanUseYoutube()) throw new LocalizedError('youtube_distribution_disabled');
	await Context(1);
	try { const WatchPlayer=await ReadAuthorizedYoutubePlayer(Item);return await Request('youtubeDiscover', {pageUrl: Item.url,...(WatchPlayer?{watchPlayer:WatchPlayer}:{})}); }
	finally { await Context(-1); }
}
export async function ResolveYoutubeSelection(Job, Item, Quality)
{
	if (!Quality || Quality.videoId !== IdentifyYoutubeUrl(Item.url)?.videoId) throw new LocalizedError('youtube_session_changed');
	return Request('youtubeRun', {job: Job, quality: Quality});
}
export async function CancelYoutube(RequestId) { return Request('youtubeCancel', {requestId: RequestId}); }
export async function FinishYoutube(RequestId) { return Request('youtubeFinish', {requestId: RequestId}); }
export async function SavePartialYoutube(RequestId, Job) { return Request('youtubeSnapshot', {requestId: RequestId, job: Job}); }
