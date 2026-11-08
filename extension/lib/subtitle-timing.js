import {LocalizedError} from './i18n.js';
import {RuntimePolicy} from './runtime-policy.js';

/** Native MediaStream currentTime advances at wall-clock rate. Sample it at discovery,
 * then project to the instant the independent recorder actually starts, after connection setup.
 */
export function AlignRecordingSubtitles(Tracks, StartedAt)
{
	for (const Track of Tracks ?? [])
	{
		const Clock = Track.recordingClock;
		const Elapsed = StartedAt - Clock?.sampledAt;
		if (!Clock || !Number.isFinite(Clock.time) || Clock.time < 0 || Clock.rate !== 1 ||
			!Number.isFinite(Elapsed) || Elapsed < 0 || Elapsed > RuntimePolicy.Transfer.RequestTimeoutMs)
			throw new LocalizedError('subtitle_unsupported');
		Track.offset = -(Clock.time + Elapsed / 1000);
	}
}

export function SubtitleTracksForOutput(Tracks, MediaStart = 0, Partial = false)
{
	return Tracks.map(Track => ({...Track, offset: (Track.offset ?? 0) + (Track.timeBase === 'media' ? -MediaStart : 0),
		allowEmptyAfterClip: Partial}));
}
