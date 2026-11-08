import {LocalizedError} from '../../lib/i18n.js';
import {YoutubeQualities} from './qualities.js';

export function WaitForBroadcastPoll(Milliseconds, Signal)
{
	Signal.throwIfAborted();
	return new Promise((Resolve, Reject) =>
	{
		const Abort = () => {clearTimeout(Timer); Reject(Signal.reason);};
		const Timer = setTimeout(() => {Signal.removeEventListener('abort', Abort); Resolve();}, Milliseconds);
		Signal.addEventListener('abort', Abort, {once: true});
	});
}

/** Upcoming responses carry no durable signed URLs or guessed format IDs. */
export async function WaitForYoutubeBroadcast(Client, Quality, {signal: Signal,
	report: Report, wait: Wait = WaitForBroadcastPoll})
{
	let Failures = 0;
	for (;;)
	{
		Signal.throwIfAborted();
		await Report({waiting: true});
		let Info;
		try {Info = await Client.DiscoverYoutube({pageUrl: 'https://www.youtube.com/watch?v=' + Quality.videoId, transport: 'sabr'}, Signal);}
		catch (ErrorValue)
		{
			Signal.throwIfAborted();
			if (!['youtube_network_failed', 'youtube_extraction_failed'].includes(ErrorValue.code) || ++Failures > 3) throw ErrorValue;
			await Wait(30000, Signal);
			continue;
		}
		if (Info?.videoId !== Quality.videoId) throw new LocalizedError('youtube_session_changed');
		Failures = 0;
		if (Info.mode !== 'upcoming') return YoutubeQualities(Info)[0].quality;
		await Wait(30000, Signal);
	}
}
