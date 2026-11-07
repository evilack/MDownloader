/** MAIN 함수: 목록에는 공개 화질만, 다운로드 시작에는 해당 트랙의 일회성 수신 연결 정보만 반환합니다. */
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
		if (Options.action === 'connection')
		{
			if (typeof Api.connection !== 'function') return {error: 'webrtc_background_unavailable'};
			return {connection: Api.connection(Options.trackId, Options.quality)};
		}
		if (Options.action === 'release') { Api.release(Options.qualityLease); return {released: true}; }
	}
	catch (ErrorValue)
	{
		return {error: ['webrtc_busy', 'webrtc_quality_unavailable', 'webrtc_background_unavailable'].includes(ErrorValue.message) ? ErrorValue.message : 'webrtc_quality_failed'};
	}
	return {error: 'request_unsupported'};
}
