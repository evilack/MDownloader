import Assert from 'node:assert/strict';
import {test as Test} from 'node:test';
import {mkdtemp as Mkdtemp, writeFile as WriteFile, rm as Rm} from 'node:fs/promises';
import {tmpdir as Tmpdir} from 'node:os';
import Http from 'node:http';
import Path from 'node:path';
import {CreatePreviewServer} from '../website/serve.mjs';
Test('streams exact ranges and serves HEAD metadata on persistent HTTP connections', async T =>
{
	const Root = await Mkdtemp(Path.join(Tmpdir(), 'mdownloader-http-'));
	const Bytes = Buffer.from('0123456789abcdef');
	await WriteFile(Path.join(Root, 'test.mp4'), Bytes);
	const Server = CreatePreviewServer({root: Root});
	const Agent = new Http.Agent({keepAlive: true});
	await new Promise(Resolve => Server.listen(0, '127.0.0.1', Resolve));
	T.after(async () =>
	{
		Agent.destroy();
		await new Promise(Resolve => Server.close(Resolve));
		await Rm(Root, {recursive: true});
	});
	const Url = 'http://127.0.0.1:' + Server.address().port + '/test.mp4';
	// 이 Windows 환경의 HEAD/연결 종료 경로는 메모리 응답 대조 서버에서도 RST가
	// 재현됩니다. 재시도 없이 실제 HTTP 지속 연결로 서버의 바이트 계약을 검증합니다.
	const Read = Options => new Promise((Resolve, Reject) =>
	{
		const Request = Http.request(Url, {agent: Agent, ...Options}, Response =>
		{
			const Chunks = [];
			Response.on('data', Chunk => Chunks.push(Chunk));
			Response.on('error', Reject);
			Response.on('end', () => Resolve({status: Response.statusCode, headers: Response.headers, bytes: Buffer.concat(Chunks)}));
		});
		Request.on('error', Reject);
		Request.end();
	});
	for (let Iteration = 0; Iteration < 20; Iteration++)
	{
		const Head = await Read({method: 'HEAD'});
		Assert.equal(Head.status, 200);
		Assert.equal(Head.headers['content-length'], String(Bytes.length));
		Assert.equal(Head.bytes.length, 0);
		const Range = await Read({headers: {Range: 'bytes=3-7'}});
		Assert.equal(Range.status, 206);
		Assert.equal(Range.headers['content-range'], 'bytes 3-7/16');
		Assert.equal(Range.bytes.toString(), '34567');
		Assert.equal((await Read({headers: {Range: 'bytes=99-'}})).status, 416);
		Assert.equal((await Read({method: 'POST'})).status, 405);
		Assert.deepEqual((await Read({})).bytes, Bytes);
	}
});
