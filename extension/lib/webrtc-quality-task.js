/** MAIN 함수: 인증/시그널링 상태 대신 서버가 공개한 안전한 화질 정보만 반환합니다. */
export async function WebRtcQualityTask(Options)
{
	if (location.href !== Options.page) return {error: 'webrtc_source_changed'};
	const Api = globalThis.MDownloaderWebRtcQuality;
	if (!Api) return {error: 'webrtc_quality_unavailable'};
	try
	{
		if (Options.action === 'list')
		{
			const Qualities = Api.list(Options.trackId);
			return Qualities.length ? {qualities: Qualities} : {error: 'webrtc_quality_unavailable'};
		}
		if (Options.action === 'select') return {quality: await Api.select(Options.trackId, Options.quality, Options.qualityLease)};
		if (Options.action === 'release') { Api.release(Options.qualityLease); return {released: true}; }
	}
	catch (ErrorValue)
	{
		return {error: ['webrtc_busy', 'webrtc_quality_unavailable'].includes(ErrorValue.message) ? ErrorValue.message : 'webrtc_quality_failed'};
	}
	return {error: 'request_unsupported'};
}
