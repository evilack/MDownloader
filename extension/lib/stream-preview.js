/**
 * 호버 미리보기용 재생목록에서 짧은 구간만 선택해 메모리의 MP4로 변환합니다. 요청마다 호스트 접근을 확인하고 전체 다운로드와 별개로 동작합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { LocalizedError } from './i18n.js';
import { BufferTarget } from '../vendor/mediabunny-1.65.2.mjs';
import { ResolveDash } from './dash.js';
import { ParseMaster, ParseMediaPlaylist } from './hls.js';
import { CopyResponse, FetchMedia, ReadIndexRange, ReadPlaylist } from './hls-http.js';
import { RemuxHls } from './hls-remux.js';
import { InitializationKey, LocalPlaylist } from './stream-transfer.js';
import { HostPattern } from './media.js';
import { ReadPagePreviewResource } from './page-preview.js';
import { NormalizeHlsProtocol } from './hls-protocol.js';
async function RequireAccess(Urls)
{
	const Origins = [...new Set(Urls.map(HostPattern))];
	if (Origins.includes(null) || !await chrome.permissions.contains({ origins: Origins }))
	{
		throw new LocalizedError('stream_preview_host_permission');
	}
}

export async function StreamPreview({ url: Url, format: Format, pageStream: PageStream }, Signal, OnMetadata)
{
	Url = PageStream?.url ?? Url;
	async function ReadLocalPlaylist(Address)
	{
		// 마스터가 선언한 다른 CDN에는 원래 CDN의 헤더를 재사용하지 않습니다.
		// 호스트 권한을 확인한 일반 요청으로 읽고 자격 증명도 전송하지 않습니다.
		if (!PageStream || new URL(Address).origin !== PageStream.context.serverOrigin)
		{
			return ReadPlaylist(Address, Signal, !!PageStream);
		}
		const Bytes = await ReadPagePreviewResource(PageStream, { url: Address }, RuntimePolicy.Transfer.MaxPlaylistBytes, Signal);
		return NormalizeHlsProtocol(new TextDecoder().decode(Bytes), Address);
	}

	await RequireAccess([Url]);
	let TextValue = await ReadLocalPlaylist(Url);
	let Video;
	if (Format === 'MPD')
	{
		({ video: Video } = await ResolveDash(TextValue, Url, async (Address, LocalRange) =>
		{
			await RequireAccess([Address]);
			return ReadIndexRange(Address, LocalRange, Signal, true);
		}));
	}
	else
	{
		const Variant = ParseMaster(TextValue, Url)?.[0];
		if (Variant)
		{
			Url = Variant.url;
			await RequireAccess([Url]);
			TextValue = await ReadLocalPlaylist(Url);
		}
		Video = ParseMediaPlaylist(TextValue, Url);
	}
	OnMetadata?.({ live: !Video.ended,
		...(Video.ended ? { duration: Video.segments.reduce((Total, Segment) => Total + Segment.duration, 0) } : {}) });
	// 첫 조각이 매우 짧으면 다음 조각도 사용합니다. 초기화 데이터를 포함한 전체 미리보기는 메모리 상한 안에서 처리합니다.
	const Start = Video.ended ? 0 : Math.max(0, Video.segments.length - 2);
	const Sample = Video.segments.slice(Start, Start + (Video.segments[Start]?.duration < RuntimePolicy.Preview.ShortSegmentSeconds ? 2 : 1));
	await RequireAccess(Sample.flatMap(Segment => [...(Segment.parts ?? [Segment]).map(Part => Part.url), ...(Segment.init ? [Segment.init.url] : [])]));
	let Total = 0;
	const Files = new Map();
	async function Buffer(Resource, Path)
	{
		const Limit = RuntimePolicy.Preview.MaxSampleBytes - Total;
		if (Resource.parts)
		{
			const Pieces = [];
			for (const Part of Resource.parts)
			{
				const Key = Path + '-' + Pieces.length;
				await Buffer(Part, Key);
				Pieces.push(Files.get(Key));
				Files.delete(Key);
			}
			Files.set(Path, new Blob(Pieces));
			return;
		}
		if (PageStream && new URL(Resource.url).origin === PageStream.context.serverOrigin)
		{
			const Bytes = await ReadPagePreviewResource(PageStream, Resource, Limit, Signal);
			Total += Bytes.byteLength;
			Files.set(Path, new Blob([Bytes]));
			return;
		}
		const Pieces = [];
		const HttpResponse = await FetchMedia(Resource.url, Signal, !!PageStream, Resource.range, true);
		const Size = await CopyResponse(HttpResponse, Limit, Signal, Chunk => Pieces.push(Chunk));
		if (!Size)
		{
			throw new LocalizedError('stream_preview_empty_segment');
		}
		Total += Size;
		Files.set(Path, new Blob(Pieces));
	}
	const Initializations = new Map();
	const Segments = [];
	for (const Segment of Sample)
	{
		let Init;
		if (Segment.init)
		{
			const Key = InitializationKey(Segment.init);
			Init = Initializations.get(Key);
			if (!Init)
			{
				Init = 'init-' + Initializations.size + '.mp4';
				Initializations.set(Key, Init);
				await Buffer(Segment.init, Init);
			}
		}
		const Path = 'preview-' + Segments.length + (Init ? '.m4s' : '.ts');
		await Buffer(Segment, Path);
		Segments.push({ ...Segment, init: Init, path: Path });
	}
	const Target = new BufferTarget();
	await RemuxHls(LocalPlaylist(Segments), Path => Files.get(Path), Target, Signal);
	return new Blob([Target.buffer], { type: 'video/mp4' });
}
