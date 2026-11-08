/** A still image or moving primary page alone cannot satisfy hover playback acceptance. */
export function PreviewPassed(Report)
{
	const Clean = Value => !!Value && Value.open === false && Value.players === 0 && Value.loading === 0;
	return !!(Report.previewBefore?.exists && Report.previewBefore.ready >= 2 && Report.previewBefore.failed === false &&
		Report.previewAfter?.failed === false && Report.previewAfter.frames > Report.previewBefore.frames &&
		Report.sourceBefore?.page === Report.url && Report.sourceBefore.paused === false && !Report.sourceBefore.adShowing &&
		Report.sourceAfter?.time > Report.sourceBefore.time && Report.sourceAfter.frames > Report.sourceBefore.frames &&
		Report.sourceAfter.paused === false && !Report.sourceAfter.adShowing && Clean(Report.closed) && Clean(Report.fastClose) && Clean(Report.navigation));
}
