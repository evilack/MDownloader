import {Innertube, Platform, Log} from 'youtubei.js/web';
// 라이브러리의 원시 오류/URL/서명 로그가 브라우저 콘솔로 나가지 않게 합니다.
Log.setLevel(Log.Level.NONE);
export async function CreateInnertube({fetch, evaluate})
{
	Platform.shim.eval = evaluate;
	return Innertube.create({fetch, retrieve_player: true, enable_session_cache: false, generate_session_locally: false, fail_fast: true});
}
