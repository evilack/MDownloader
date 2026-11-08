import {ParseVtt, Serialize} from './subtitles.js';

export function SameLanguage(A, B)
{
	const Left = String(A || '').toLowerCase().replaceAll('_','-');
	const Right = String(B || '').toLowerCase().replaceAll('_','-');
	if (!Left || !Right || Left === 'und' || Right === 'und') return false;
	return Left === Right || (Left.split('-')[0] === Right.split('-')[0] && (!Left.includes('-') || !Right.includes('-')));
}

/** Preserve every original track and every cue timestamp; reject incomplete translations. */
export async function TranslateMissingSubtitle(Tracks, Options, Translate, Signal)
{
	if (!Options?.enabled || !Tracks.length) return Tracks;
	const Target = Options.targetLanguage;
	if (!Target || typeof Target !== 'string') throw new Error('subtitle_translation_target_required');
	if (Tracks.some(Track => SameLanguage(Track.language, Target))) return Tracks;
	const Source = Options.sourceLanguage && Options.sourceLanguage !== 'auto'
		? Tracks.find(Track => SameLanguage(Track.language, Options.sourceLanguage)) : Tracks.find(Track => Track.language && Track.language !== 'und') || Tracks[0];
	if (!Source) throw new Error('subtitle_translation_source_missing');
	Signal?.throwIfAborted();
	const Parsed = ParseVtt(Source.content);
	if (!Parsed.cues.length) throw new Error('subtitle_translation_source_empty');
	const Values = [];
	for (let Index = 0; Index < Parsed.cues.length;)
	{
		const Batch = []; let Size = 0;
		while (Index < Parsed.cues.length && Batch.length < 40)
		{
			const Text = Parsed.cues[Index].text;
			if (Batch.length && Size + Text.length > 8000) break;
			if (Text.length > 8000) throw new Error('subtitle_translation_cue_too_long');
			Batch.push(Text); Size += Text.length; Index++;
		}
		const Result = await Translate(Batch, {source:Source.language, target:Target, signal:Signal});
		if (!Array.isArray(Result) || Result.length !== Batch.length) throw new Error('subtitle_translation_incomplete');
		Values.push(...Result);
	}
	Signal?.throwIfAborted();
	if (!Array.isArray(Values) || Values.length !== Parsed.cues.length || Values.some(Value => typeof Value !== 'string' || !Value.trim() || Value.includes('-->') || /\n[ \t]*\n/.test(Value.replace(/\r\n?/g,'\n'))))
		throw new Error('subtitle_translation_incomplete');
	const Cues = Parsed.cues.map((Cue, Index) => ({...Cue, text:Values[Index].replace(/\r\n?/g,'\n').trim()}));
	return [...Tracks, {language:Target, label:Target + ' (translated)', content:Serialize({cues:Cues, extras:Parsed.extras}),
		...(Source.timeBase ? {timeBase:Source.timeBase} : {}), ...(Source.recordingClock ? {recordingClock:Source.recordingClock} : {})}];
}
