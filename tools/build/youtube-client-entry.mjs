import {Innertube, Platform, Log, Constants, YT, YTNodes} from 'youtubei.js/web';
export const SabrClientProfile=Object.freeze({name:'VISIONOS',clientInfo:Object.freeze({clientName:Number(Constants.CLIENT_NAME_IDS.VISIONOS),clientVersion:Constants.CLIENTS.VISIONOS.VERSION})});
// 라이브러리의 원시 오류/URL/서명 로그가 브라우저 콘솔로 나가지 않게 합니다.
Log.setLevel(Log.Level.NONE);
export async function CreateInnertube({fetch, evaluate})
{
	Platform.shim.eval = evaluate;
	return Innertube.create({fetch, retrieve_player: true, enable_session_cache: false, generate_session_locally: false, fail_fast: true});
}
/** Same session/client, with the reload context supplied by the SABR server. */
export async function ReloadPlayerInfo(Tube, VideoId, ReloadContext)
{
	const Endpoint = new YTNodes.NavigationEndpoint({watchEndpoint: {videoId: VideoId, racyCheckOk: true, contentCheckOk: true}});
	const Response = await Endpoint.call(Tube.actions, {client: SabrClientProfile.name, playbackContext: {
		contentPlaybackContext: {vis: 0, splay: false, lactMilliseconds: '-1', signatureTimestamp: Tube.session.player?.signature_timestamp},
		reloadPlaybackContext: ReloadContext,
	}});
	const Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
	const Cpn = Array.from(crypto.getRandomValues(new Uint8Array(16)), Byte => Alphabet[Byte & 63]).join('');
	return new YT.VideoInfo([Response], Tube.actions, Cpn);
}
