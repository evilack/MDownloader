/** 로컬 정적 미리보기 서버입니다. HEAD는 메타데이터만 응답하고 Range는
 * 필요한 바이트만 스트리밍합니다. 연결이 닫히면 파일 스트림도 해제합니다.
 * 외부에 게시하는 서버가 아니며 기본 수신 주소는 루프백입니다. */
import Http from 'node:http';
import {createReadStream as CreateReadStream} from 'node:fs';
import {stat as Stat, realpath as Realpath} from 'node:fs/promises';
import Path from 'node:path';
import {fileURLToPath as FileURLToPath} from 'node:url';
import {ToolConfig} from '../tools/lib/tool-config.mjs';
const Types = Object.freeze({'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm'});
export function CreatePreviewServer({root: Root = ToolConfig.websiteRoot} = {})
{
	const ResolvedRoot = Realpath(Root);
	return Http.createServer(async (Request, Response) =>
	{
		try
		{
			if (!['GET', 'HEAD'].includes(Request.method))
			{
				Response.writeHead(405, {Allow: 'GET, HEAD'}).end();
				return;
			}
			const Base = await ResolvedRoot;
			const Pathname = decodeURIComponent(new URL(Request.url, 'http://localhost').pathname);
			let Filename = Path.resolve(Base, '.' + (Pathname === '/' ? '/index.html' : Pathname));
			const IsInside = Value => Value.startsWith(Base + Path.sep);
			if (!IsInside(Filename))
			{
				Response.writeHead(403).end();
				return;
			}
			if ((await Stat(Filename)).isDirectory())
			{
				Filename = Path.join(Filename, 'index.html');
			}
			Filename = await Realpath(Filename);
			if (!IsInside(Filename))
			{
				Response.writeHead(403).end();
				return;
			}
			const Info = await Stat(Filename);
			if (!Info.isFile())
			{
				Response.writeHead(404).end();
				return;
			}
			const Headers = {'Content-Type': Types[Path.extname(Filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes'};
			// RFC 9110의 단일 bytes 범위만 처리합니다. 여러 범위는 무시하고 정상 전체 응답을 보냅니다.
			const Range = /^bytes=(\d+)-(\d*)$/.exec(Request.headers.range || '');
			const Start = Range ? Number(Range[1]) : 0;
			const End = Range ? Math.min(Range[2] ? Number(Range[2]) : Info.size - 1, Info.size - 1) : Info.size - 1;
			if (Range && (!Number.isSafeInteger(Start) || !Number.isSafeInteger(End) || Start >= Info.size || End < Start))
			{
				Response.writeHead(416, {'Content-Range': 'bytes */' + Info.size}).end();
				return;
			}
			if (Range)
			{
				Headers['Content-Range'] = 'bytes ' + Start + '-' + End + '/' + Info.size;
			}
			Headers['Content-Length'] = Range ? End - Start + 1 : Info.size;
			Response.writeHead(Range ? 206 : 200, Headers);
			if (Request.method === 'HEAD' || !Info.size)
			{
				Response.end();
				return;
			}
			const Stream = CreateReadStream(Filename, {start: Start, end: End});
			Response.once('close', () => Stream.destroy());
			Stream.once('error', () => Response.destroy());
			Stream.pipe(Response);
		}
		catch
		{
			if (!Response.headersSent)
			{
				Response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
			}
			Response.end();
		}
	});
}

if (process.argv[1] && Path.resolve(process.argv[1]) === FileURLToPath(import.meta.url))
{
	CreatePreviewServer().listen(ToolConfig.port, '127.0.0.1', () => console.log('MDownloader preview: ' + ToolConfig.previewUrl));
}
