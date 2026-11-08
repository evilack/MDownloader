import {SabrStream} from 'googlevideo/sabr-stream';
import {Logger, LogLevel, buildSabrFormat} from 'googlevideo/utils';
Logger.getInstance().setLogLevels(LogLevel.NONE);
export function CreateSabrStream(Config, Fetch)
{
	return new SabrStream({videoId: Config.videoId, formats: Config.formats.map(buildSabrFormat),
		serverAbrStreamingUrl: Config.url, videoPlaybackUstreamerConfig: Config.ustreamerConfig, clientInfo: Config.clientInfo,
		poToken: Config.poToken, fetchFunction: Fetch, videoHighWaterMark: 4 * 1024 ** 2, audioHighWaterMark: 1024 ** 2});
}
export {UmpReader, UmpWriter, CompositeBuffer} from 'googlevideo/ump';
export {MediaHeader, VideoPlaybackAbrRequest, UMPPartId} from 'googlevideo/protos';
