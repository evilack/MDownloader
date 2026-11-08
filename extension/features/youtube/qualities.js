import {LocalizedError} from '../../lib/i18n.js';
/** Packet-copy compatible AVC/AAC pairs retain the upstream format index. */
export function YoutubeQualities(Info)
{
	if (Info.mode === 'upcoming') return [{scheduled: true, resolution: '', bandwidth: 0,
		quality: {videoId: Info.videoId, scheduled: true}}];
	const Audio = Info.formats.filter(F => F.kind === 'audio' && F.codecs.some(C => C.startsWith('mp4a'))).sort((A, B) => B.bitrate - A.bitrate)[0];
	const Videos = Info.formats.filter(F => F.kind === 'video' && F.codecs.some(C => C.startsWith('avc1'))).sort((A, B) => B.height - A.height || B.bitrate - A.bitrate);
	if (!Audio || !Videos.length) throw new LocalizedError('youtube_format_unavailable');
	return Videos.map(Video => ({resolution: `${Video.width}x${Video.height}`, bandwidth: Video.bitrate + Audio.bitrate,
		quality: {sessionKey: Info.sessionKey, videoId: Info.videoId, ...(Info.mode === 'live' ? {live: true} : {}), selection: {videoFormatId: Video.id, audioFormatId: Audio.id}}}));
}
