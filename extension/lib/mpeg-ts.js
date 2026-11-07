/** MPEG-TS 표준의 패킷 길이와 동기 바이트를 이용해 손상된 조각을 걸러냅니다. */
export const MPEG_TS_PACKET_BYTES = 188;
const MpegTsSyncByte = 0x47;
export function HasTransportStreamSync(Bytes, StartOffset = 0)
{
	// HTTP 응답 조각은 패킷 중간에서 시작할 수 있으므로 이미 쓴 바이트 수를 기준으로 동기 바이트 위치를 계산합니다.
	const FirstSync = (MPEG_TS_PACKET_BYTES - StartOffset % MPEG_TS_PACKET_BYTES) % MPEG_TS_PACKET_BYTES;
	for (let Offset = FirstSync; Offset < Bytes.length; Offset += MPEG_TS_PACKET_BYTES)
	{
		if (Bytes[Offset] !== MpegTsSyncByte)
		{
			return false;
		}
	}
	return true;
}
