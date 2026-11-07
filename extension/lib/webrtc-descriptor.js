import {LocalizedError} from './i18n.js';

/** MAIN 반환값을 그대로 특권 수신기에 전달하지 않습니다. 관측된 서비스의
 * 허용 WSS 호스트와 제한된 스칼라 필드만 취하고 인증값은 영속 저장하지 않습니다. */
export function RequireWebRtcConnection(Value, AllowedHosts)
{
	const Fail = () => { throw new LocalizedError('webrtc_background_unavailable'); };
	if (!Value || Value.protocol !== 'ristretto-v1' || typeof Value.url !== 'string' || Value.url.length > 8192) return Fail();
	let Url;
	try { Url = new URL(Value.url); } catch { return Fail(); }
	if (Url.protocol !== 'wss:' || Url.username || Url.password || Url.hash || Url.port && Url.port !== '443' ||
		!AllowedHosts?.includes(Url.hostname)) return Fail();
	const Connection = Value.connection;
	const Text = (Input, Max, Empty = false) => typeof Input === 'string' && Input.length <= Max && (Empty || Input.length > 0);
	if (!Text(Connection?.appKey, 256) || !Text(Connection?.custom?.name, 256) ||
		!Text(Connection?.custom?.aclAuth, 65536, true) || !Text(Value.streamId, 256) || !Text(Value.quality, 100) ||
		Value.quality.toLowerCase().includes('blurred') || !Object.hasOwn(Value.profiles || {}, Value.quality)) return Fail();
	return {url: Url.href, protocol: 'ristretto-v1', streamId: Value.streamId, quality: Value.quality,
		connection: {appKey: Connection.appKey, custom: {name: Connection.custom.name, aclAuth: Connection.custom.aclAuth}},
		profiles: {[Value.quality]: {available: true}}};
}
