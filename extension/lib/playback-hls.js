/**
 * 브라우저 플레이어가 성공적으로 받은 HLS 조각만 수집합니다. 같은 주소가 재생목록에 반복될 수 있으므로 파일을 한 번 저장하더라도 재생 순서에는 각 항목을 포함합니다.
 */
import { RuntimePolicy } from './runtime-policy.js';
import { LocalizedError } from './i18n.js';
import { ParseMaster, ParseVod } from './hls.js';
import { HasTransportStreamSync, MPEG_TS_PACKET_BYTES } from './mpeg-ts.js';
export const PlaybackScratchName = 'mdownloader-playback';
export const IsFullPlaybackResponse = Entry => Entry.request.method === 'GET' && Entry.response.status === 200;
export async function StorePlaybackSegment(Directory, Filename, Bytes)
{
	const MediaFile = await Directory.getFileHandle(Filename, { create: true });
	const Stream = await MediaFile.createWritable();
	try
	{
		await Stream.write(Bytes);
		await Stream.close();
	}
	catch (ErrorValue)
	{
		await Stream.abort().catch(() =>
		{
		});
		throw ErrorValue;
	}
}

async function ResponseBody(Entry, Limit)
{
	if (Entry.response.content?.size > Limit)
	{
		throw new LocalizedError('stream_playback_response_limit');
	}
	const { content: Content, encoding: Encoding } = await new Promise(Resolve =>
	{
		Entry.getContent((Content, Encoding) => Resolve({ content: Content, encoding: Encoding }));
	});
	if (!Content)
	{
		return null;
	}
	if (Content.length > (Encoding === 'base64' ? 4 * Math.ceil(Limit / 3) : Limit))
	{
		throw new LocalizedError('stream_playback_response_limit');
	}
	return { content: Content, encoding: Encoding };
}

function DecodeBase64(Content)
{
	const Binary = atob(Content);
	const Bytes = new Uint8Array(Binary.length);
	for (let I = 0; I < Bytes.length; I++)
	{
		Bytes[I] = Binary.charCodeAt(I);
	}
	return Bytes;
}

export class PlaybackHls
{
	#Playlists;
	#Segments = new Map();
	#Bytes = 0;
	#SaveSegment;
	#Received = 0;
	#Playlist;
	constructor(Url, SaveSegment)
	{
		const Source = new URL(Url);
		if (!['http:', 'https:'].includes(Source.protocol) || Source.username || Source.password)
		{
			throw new LocalizedError('stream_playback_playlist_url');
		}
		Source.hash = '';
		this.#Playlists = new Set([Source.href]);
		this.#SaveSegment = SaveSegment;
	}

	get count()
	{
		return this.#Playlist?.urls.length ?? 0;
	}
	get received()
	{
		return this.#Received;
	}
	get complete()
	{
		return this.count > 0 && this.received === this.count;
	}

	async Accept(Entry)
	{
		if (this.complete || !IsFullPlaybackResponse(Entry))
		{
			return;
		}
		const { url: Url } = Entry.request;
		if (this.#Playlists.has(Url))
		{
			const Body = await ResponseBody(Entry, RuntimePolicy.Transfer.MaxPlaylistBytes);
			if (!Body)
			{
				return;
			}
			const TextValue = Body.encoding === 'base64' ? new TextDecoder().decode(DecodeBase64(Body.content)) : Body.content;
			const Variants = ParseMaster(TextValue, Url, { allowSeparateAudio: false });
			if (Variants)
			{
				this.#Playlists = new Set(Variants.map(Variant => Variant.url));
				return;
			}
			this.#Playlist = ParseVod(TextValue, Url);
			this.#Playlists.clear();
			for (const [Index, Address] of this.#Playlist.urls.entries())
			{
				const Resource = this.#Segments.get(Address);
				// 반복 주소도 재생목록에서 등장한 횟수만큼 수집 범위에 포함하되 임시 파일은 공유합니다.
				if (Resource)
				{
					Resource.occurrences++;
				}
				else
				{
					this.#Segments.set(Address, { index: Index, occurrences: 1, stored: false });
				}
			}
			return;
		}
		const Resource = this.#Segments.get(Url);
		if (!Resource || Resource.stored)
		{
			return;
		}
		const Body = await ResponseBody(Entry, RuntimePolicy.Transfer.MaxSegmentBytes);
		if (!Body)
		{
			return;
		}
		if (Body.encoding !== 'base64')
		{
			throw new LocalizedError('stream_playback_raw_bytes_missing');
		}
		const Bytes = DecodeBase64(Body.content);
		if (Bytes.length > RuntimePolicy.Transfer.MaxSegmentBytes || this.#Bytes + Bytes.length > RuntimePolicy.Transfer.MaxScratchBytes)
		{
			throw new LocalizedError('stream_playback_storage_limit');
		}
		if (!Bytes.length || Bytes.length % MPEG_TS_PACKET_BYTES)
		{
			throw new LocalizedError('stream_playback_ts_incomplete');
		}
		if (!HasTransportStreamSync(Bytes))
		{
			throw new LocalizedError('stream_playback_ts_only');
		}
		await this.#SaveSegment(`segment-${Resource.index}.ts`, Bytes);
		Resource.stored = true;
		this.#Bytes += Bytes.length;
		this.#Received += Resource.occurrences;
	}

	LocalInput()
	{
		if (!this.complete)
		{
			throw new LocalizedError('stream_playback_segments_missing');
		}
		return {
			playlist: this.#Playlist.local.replace(/^segment-(\d+)\.ts$/gm, (_line, Index) =>
			{
				const Resource = this.#Segments.get(this.#Playlist.urls[Number(Index)]);
				if (!Resource)
				{
					throw new LocalizedError('stream_playback_unknown_segment');
				}
				return `segment-${Resource.index}.ts`;
			}),
			bytes: this.#Bytes,
		};
	}
}
