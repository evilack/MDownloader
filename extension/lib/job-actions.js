/** 화면과 작업 제어가 같은 준비 상태를 사용합니다. 영상·음성의 연속 구간이 확보돼야 중지 후 저장할 수 있습니다. */
export function CanFinishJob(Job)
{
	return Job?.state === 'active' && !Job.snapshot && !Job.muxing && !Job.saving && !Job.pendingAction && Job.downloadId === undefined &&
	(Job.hls || Job.youtube ? !!Job.snapshotAvailable : !!Job.live && Job.finished > 0);
}
