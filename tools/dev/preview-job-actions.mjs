/** 실제 행 컴포넌트를 루프백 웹에서 검사합니다. Chrome 메시지는 메모리 대역이며 설치된 확장이나 다운로드에는 접근하지 않습니다. */
import Http from 'node:http';
import {readFile as ReadFile} from 'node:fs/promises';
import {CreatePreviewServer} from '../../website/serve.mjs';
import {ProjectPath} from '../lib/tool-config.mjs';
const Fixture = String.raw`
import {CreateJobRow, UpdateJobRowMetrics} from './job-row.js';
import {InitializeLocale, LocalizePage} from './lib/i18n.js';
globalThis.chrome = {runtime: {sendMessage: async Message =>
{
 document.getElementById('status').textContent = Message.action + ' · ' + Message.requestId;
 return {ok: true};
}}};
await InitializeLocale(new URL(location.href).searchParams.get('lang') || 'ko');
LocalizePage();
document.getElementById('empty').hidden = true;
const Active = document.getElementById('active');
Active.hidden = false;
const Jobs = [
 {requestId: 'finite-ready', filename: '샘플 영상 — HLS 다운로드.mp4', hls: true, snapshotAvailable: true, finished: 500, bytesReceived: 10700000},
 {requestId: 'live-ready', filename: '샘플 라이브 — WebRTC 다운로드.mp4', recording: true, live: true, snapshotAvailable: true, finished: 4, bytesReceived: 10400000},
 {requestId: 'finite-waiting', filename: '준비 중 — 첫 구간을 받는 중.mp4', hls: true, snapshotAvailable: false, finished: 0},
 {requestId: 'canceled', filename: '샘플 영상 — 취소된 다운로드.mp4', hls: true, state: 'canceled'},
];
const CountFormat = new Intl.NumberFormat();
for (const Value of Jobs)
{
 const Job = {state: 'active', count: 1304, bytesReceived: 0, live: false, ...Value};
 const Control = document.createElement('div');
 Control.className = 'candidate-preview';
 const Image = document.createElement('img');
 Image.src = 'fixture-thumbnail.png';
 Image.alt = '';
 Control.append(Image);
 const Entry = CreateJobRow(Job, {control: Control}, {CountFormat, bShowDiagnostics: false,
 Announce: Text => {document.getElementById('status').textContent = Text;}, Refresh: () => {}});
 Active.querySelector('ul').append(Entry.row);
 Entry.previous = {time: 1000, bytes: Math.max(0, Job.bytesReceived - 1100000)};
 UpdateJobRowMetrics(Entry, Job, 2000, CountFormat);
}
document.getElementById('status').textContent = 'UI 검사 픽스처 · 설치 확장 아님';
`;
const Static = CreatePreviewServer({root: ProjectPath('extension')});
const Serve = Static.listeners('request')[0];
Http.createServer(async (Request, Response) =>
{
	const Route = Request.url.split('?')[0];
	if (Route === '/fixture.js')
	{
		Response.writeHead(200, {'Content-Type': 'application/javascript; charset=utf-8'}).end(Fixture);
		return;
	}
	if (Route === '/fixture-thumbnail.png')
	{
		Response.writeHead(200, {'Content-Type': 'image/png'}).end(await ReadFile(ProjectPath('website/assets/screenshots/ko/sample-still.png')));
		return;
	}
	if (Route === '/sidepanel.html')
	{
		const Html = await ReadFile(ProjectPath('extension/sidepanel.html'), 'utf8');
		Response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(Html.replace('src="sidepanel.js"', 'src="fixture.js"'));
		return;
	}
	await Serve(Request, Response);
}).listen(0, '127.0.0.1', function ()
{
	console.log('JOB_ACTIONS_FIXTURE_URL=http://127.0.0.1:' + this.address().port + '/sidepanel.html');
});
