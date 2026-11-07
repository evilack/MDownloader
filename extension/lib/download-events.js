/** 전송 단계의 번역 키와 결과 코드는 결과 보관·상세 진단이 같은 카탈로그를 사용합니다. */
export const DownloadStages = Object.freeze( {
	'partial-read': 'view_job_snapshot_saving',
	'partial-mux': 'view_job_snapshot_muxing',
	'master-access': 'view_stage_master_access',
	'master-request': 'view_stage_master_request',
	'master-parse': 'view_stage_master_parse',
	'variant-selection': 'view_stage_variant_selection',
	'variant-access': 'view_stage_variant_access',
	'variant-request': 'view_stage_variant_request',
	'media-parse': 'view_stage_media_parse',
	'segments-access': 'view_stage_segments_access',
	'temporary-storage': 'view_stage_temporary_storage',
	'segments-transfer': 'view_stage_segments_transfer',
	'mp4-mux': 'view_stage_mp4_mux',
	'browser-save': 'view_stage_browser_save',
});
export const DownloadResults = Object.freeze(['started', 'ok', 'complete', 'failed', 'canceled', 'http-error']);
