/**
 * URL 확장자와 응답의 MIME 형식으로 미디어를 분류합니다. 표시용 형식 이름도 이곳에서 관리하므로 화면마다 판단 기준이 달라지지 않습니다.
 */
/** Chrome 응답 형식과 파일 확장자가 다를 때도 같은 형식 ID를 사용합니다. */
export const MediaFormat = Object.freeze({ Hls: 'M3U8', Dash: 'MPD', WebRtc: 'WEBRTC', Unknown: 'UNKNOWN' });
const StreamLabels = new Map([[MediaFormat.Hls, 'HLS'], [MediaFormat.Dash, 'DASH']]);
const AudioFormats = new Set(['MP3', 'M4A', 'WEBA', 'WAV', 'FLAC', 'OGA', 'OPUS', 'OGG']);
export const HlsReloadParameters = Object.freeze(['_HLS_msn', '_HLS_part', '_HLS_skip']);
export function IsStreamFormat(Format)
{
	return StreamLabels.has(Format);
}

/** LL-HLS의 갱신 위치만 같은 재생목록으로 비교합니다. 토큰 등 다른 쿼리는 그대로 유지합니다. */
export function MediaResourceKey(Value)
{
	const Url = new URL(Value);
	Url.hash = '';
	if (/\.m3u8$/i.test(Url.pathname))
	{
		// URLSearchParams의 재직렬화는 공백 등의 인코딩까지 바꿀 수 있으므로 원래 쿼리 문자열을 보존합니다.
		const Directives = new Set(HlsReloadParameters);
		const Fields = Url.search.slice(1).split('&');
		const Kept = Fields.filter(Field => !Directives.has(Field.split('=', 1)[0]));
		if (Fields.length !== Kept.length)
		{
			Url.search = Kept.length ? '?' + Kept.join('&') : '';
		}
	}
	return Url.href;
}

/** 본문을 읽을 수 없는 워커 요청도 같은 HLS 디렉터리·화질 접두사·조각 표기가 모두 맞을 때 구분합니다. */
export function IsHlsFragmentUrl(Playlist, Resource)
{
	const Parent = new URL(Playlist);
	const Child = new URL(Resource);
	if (!/\.m3u8$/i.test(Parent.pathname) || Parent.origin !== Child.origin)
	{
		return false;
	}
	const ParentPath = Parent.pathname.slice(0, Parent.pathname.lastIndexOf('/') + 1);
	if (Child.pathname.slice(0, Child.pathname.lastIndexOf('/') + 1) !== ParentPath)
	{
		return false;
	}
	const Stem = Parent.pathname.slice(ParentPath.length, -'.m3u8'.length);
	const Filename = Child.pathname.slice(ParentPath.length);
	if (!Filename.startsWith(Stem))
	{
		return false;
	}
	return /^[._-](?:.*[._-])?(?:init(?:[._-].*)?|part\d+)\.(?:mp4|m4a|m4v)$/i.test(Filename.slice(Stem.length));
}

export function IsAudioFormat(Format)
{
	return AudioFormats.has(Format);
}

export function GetMediaFormatLabel(Format)
{
	return Format === MediaFormat.WebRtc ? 'WebRTC' : Format === 'YOUTUBE' ? 'YouTube' : StreamLabels.get(Format) ?? Format;
}

/** Chrome 권한 검사는 HTTP(S) 호스트만 사용하며 경로나 인증 정보는 포함하지 않습니다. */
export function HostPattern(Value)
{
	try
	{
		const Url = new URL(Value);
		if (['http:', 'https:'].includes(Url.protocol) && !Url.username && !Url.password)
		{
			return Url.protocol + '//' + Url.hostname + '/*';
		}
	}
	catch
	{
		/* 올바른 URL이 아니면 접근 권한 패턴을 만들지 않습니다. */
	}
	return null;
}

export const IsHtmlMediaType = Mime => /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(Mime);
export function StreamPreviewPath(Url, Format)
{
	if (IsStreamFormat(Format))
	{
		return new URL(Url).pathname;
	}
}

const MediaFamilies = [
	[['mp4', 'm4v', 'f4v', 'm4a'], {
			'video/mp4': 'mp4', 'video/x-m4v': 'm4v', 'video/x-f4v': 'f4v',
			'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
		}],
	[['webm', 'weba'], { 'video/webm': 'webm', 'audio/webm': 'weba' }],
	[['mov'], { 'video/quicktime': 'mov' }],
	[['mkv'], { 'video/matroska': 'mkv', 'video/x-matroska': 'mkv' }],
	[['avi'], { 'video/vnd.avi': 'avi', 'video/x-msvideo': 'avi', 'video/avi': 'avi' }],
	[['flv'], { 'video/x-flv': 'flv', 'video/flv': 'flv' }],
	[['mp3'], { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/x-mp3': 'mp3' }],
	[['ogg', 'oga', 'ogv', 'opus'], {
			'application/ogg': 'ogg', 'audio/ogg': 'ogg', 'video/ogg': 'ogv', 'audio/opus': 'opus',
		}],
	[['wav'], { 'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav', 'audio/vnd.wave': 'wav' }],
	[['flac'], { 'audio/flac': 'flac', 'audio/x-flac': 'flac' }],
	[['m3u8'], {
			'application/vnd.apple.mpegurl': 'm3u8', 'application/mpegurl': 'm3u8', 'application/x-mpegurl': 'm3u8',
			'audio/mpegurl': 'm3u8', 'audio/x-mpegurl': 'm3u8', 'video/mpegurl': 'm3u8', 'video/x-mpegurl': 'm3u8',
		}],
	[['mpd'], { 'application/dash+xml': 'mpd', 'application/mpd+xml': 'mpd' }],
];
const Extensions = new Set(MediaFamilies.flatMap(([Suffixes]) => Suffixes));
const ResponseTypes = new Map(MediaFamilies.flatMap(([Suffixes, Types]) =>
Object.entries(Types).map(([Mime, Extension]) => [Mime, { extension: Extension, suffixes: Suffixes }])));
export function ClassifyMediaUrl(Value)
{
	let Address;
	try
	{
		Address = new URL(Value);
	}
	catch
	{
		return null;
	}
	if (!['http:', 'https:'].includes(Address.protocol) || Address.username || Address.password)
	{
		return null;
	}
	let Name = Address.pathname.split('/').at(-1) || 'media';
	try
	{
		Name = decodeURIComponent(Name);
	}
	catch
	{
		/* 주소 인코딩을 해석하지 못하면 원래 이름을 유지합니다. */
	}
	// AAC와 MPEG-TS 주소는 HLS 조각일 수 있습니다. 주소의 확장자만으로 완전한 파일이라고 판단하지 않습니다.
	if (/\.(?:m4s|m4f|ts|m2ts|aac|cmfv|cmfa)$/i.test(Name) ||
	/^(?:init-stream\d+|chunk-stream\d+-\d+)\.(?:mp4|m4a|m4v|webm)$/i.test(Name))
	{
		return null;
	}
	const Extension = Name.slice(Name.lastIndexOf('.') + 1).toLowerCase();
	const bSupported = Name.includes('.') && Extensions.has(Extension);
	return { name: Name, format: bSupported ? Extension.toUpperCase() : MediaFormat.Unknown, supported: bSupported, url: Address.href };
}

export function ClassifyResponseMedia(Value, Mime)
{
	const Candidate = ClassifyMediaUrl(Value);
	if (!Candidate)
	{
		return null;
	}
	const Match = ResponseTypes.get(Mime);
	if (Match)
	{
		if (Match.suffixes.includes(Candidate.format.toLowerCase()))
		{
			return Candidate;
		}
		return { ...Candidate, name: `${Candidate.name}.${Match.extension}`, format: Match.extension.toUpperCase(), supported: true };
	}
	const bGeneric = !Mime || Mime === 'application/octet-stream';
	const bPlaylist = (Candidate.format === MediaFormat.Hls && Mime === 'text/plain') ||
	(Candidate.format === MediaFormat.Dash && ['application/xml', 'text/xml'].includes(Mime));
	return Candidate.supported && (bGeneric || bPlaylist) ? Candidate : null;
}
