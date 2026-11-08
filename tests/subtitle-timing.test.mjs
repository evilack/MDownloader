import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
Test('projects the source caption clock onto the actual recorder start', async() =>
{
	const {AlignRecordingSubtitles, SubtitleTracksForOutput} = await import('../extension/lib/subtitle-timing.js');
	const Tracks = [{recordingClock: {time: 120, sampledAt: 100000, rate: 1}}];
	AlignRecordingSubtitles(Tracks, 102000);
	Assert.equal(Tracks[0].offset, -122);
	Assert.equal(SubtitleTracksForOutput(Tracks)[0].offset, -122, 'the MP4 mux receives the recorder alignment');
	Assert.equal(SubtitleTracksForOutput([{offset: -2, timeBase: 'media'}], 8, true)[0].offset, -10);
	Assert.throws(() => AlignRecordingSubtitles([{}], 102000), {key: 'subtitle_unsupported'});
	Assert.throws(() => AlignRecordingSubtitles(Tracks, 200000), {key: 'subtitle_unsupported'});
});
