/** 이미 닫힌 파일만 사용해 현재까지의 연속 구간을 고정합니다.
 * 병렬 전송에서 뒤 조각이 먼저 끝나도 앞의 빈 구간을 건너뛰지 않습니다.
 */
export function ReadCommittedSnapshot(Tracks, Files)
{
	const Ready = Tracks.map(Track =>
	{
		const Result = [];
		for (const Segment of Track.saved)
		{
			if (!Files.has(Segment.path) || (Segment.init && !Files.has(Segment.init)))
			{
				break;
			}
			Result.push({...Segment});
		}
		return Result;
	});
	if (Ready.some(Segments => !Segments.length))
	{
		return null;
	}
	const Duration = Segments => Segments.reduce((Total, Segment) => Total + Segment.duration, 0);
	const AudioShift = (Tracks[0].playlist?.presentationTimeOffset ?? 0) - (Tracks[1]?.playlist?.presentationTimeOffset ?? 0);
	if (Ready[1])
	{
		const AudioEnd = Duration(Ready[1]) + AudioShift;
		let End = 0;
		Ready[0] = Ready[0].filter(Segment =>
		{
			End += Segment.duration;
			return End <= AudioEnd;
		});
		if (!Ready[0].length)
		{
			return null;
		}
		const VideoEnd = Duration(Ready[0]);
		End = AudioShift;
		Ready[1] = Ready[1].filter(Segment =>
		{
			const Include = End < VideoEnd;
			End += Segment.duration;
			return Include;
		});
		if (!Ready[1].length)
		{
			return null;
		}
	}
	const Paths = new Set(Ready.flat().flatMap(Segment => [Segment.path, Segment.init].filter(Boolean)));
	const Count = Ready.reduce((Total, Segments) => Total + Segments.length, 0);
	return {video: Ready[0], audio: Ready[1], audioShift: AudioShift,
		progress: {live: false, count: Count, finished: Count, received: [...Paths].reduce((Total, Path) => Total + Files.get(Path), 0)}};
}
