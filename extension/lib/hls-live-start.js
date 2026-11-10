import {LocalizedError} from './i18n.js';

export function NormalizeHlsLiveStart(Value = 'beginning')
{
	if (Value !== 'beginning' && Value !== 'current') throw new LocalizedError('job_invalid_request');
	return Value;
}

/** Set initial cursors only. Keep each retained segment's map, key and sequence intact. */
export function InitializeHlsLiveStart(Tracks, Mode, TargetDurations)
{
	if (NormalizeHlsLiveStart(Mode) !== 'current') return;
	const Open = Tracks.filter(Track => !Track.playlist.ended);
	if (!Open.length) return;
	// Separate audio may have different durations/sequence bases. Use the same
	// recent duration for both tracks, retaining a small complete-segment buffer.
	const Window = Math.max(...Open.map(Track => Track.playlist.targetDuration)) * TargetDurations;
	for (const Track of Open)
	{
		const Segments = Track.playlist.segments;
		let Start = Segments.length, Duration = 0;
		while (Start > 0 && Duration < Window) Duration += Segments[--Start].duration;
		Track.next = Segments[Start]?.sequence;
	}
}
