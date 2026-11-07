/** 실제 options.html/options.js를 일반 웹에서 렌더링하는 격리된 검사 픽스처입니다.
 * Chrome 저장소·권한은 메모리/로컬 웹 저장소 대역이며 설치 확장 검증이 아닙니다.
 * 권한 변경·폴더 선택·확장 재시작은 수행하지 않습니다. 루프백의 임의 빈 포트만 씁니다. */
import Http from 'node:http';
import {readFile as ReadFile} from 'node:fs/promises';
import {CreatePreviewServer} from '../../website/serve.mjs';
import {ProjectPath} from '../lib/tool-config.mjs';
const Fixture = String.raw`
const Listeners = new Set();
const Values = JSON.parse(localStorage.getItem('mdownloader-options-fixture') || '{}');
Values.language = new URL(location.href).searchParams.get('lang') || Values.language || 'ko';
const Denied = async () => { throw new Error('Unavailable in UI fixture'); };
globalThis.chrome = {
 storage: {
  local: {
   get: async Keys => Object.fromEntries((Keys === null ? Object.keys(Values) : Array.isArray(Keys) ? Keys : [Keys]).map(Key => [Key, Values[Key]])),
   set: async Changes => {
    const Events = Object.fromEntries(Object.entries(Changes).map(([Key, Value]) => [Key, {oldValue: Values[Key], newValue: Value}]));
    Object.assign(Values, Changes); localStorage.setItem('mdownloader-options-fixture', JSON.stringify(Values));
    for (const Listener of Listeners) Listener(Events, 'local');
   },
   remove: async Key => {delete Values[Key];},
  },
  onChanged: {addListener: Listener => Listeners.add(Listener), removeListener: Listener => Listeners.delete(Listener)},
 },
 permissions: {contains: async () => false, request: Denied, remove: Denied},
 runtime: {getManifest: () => ({version: 'render-fixture', optional_host_permissions: ['http://*/*', 'https://*/*']}), reload: Denied},
 tabs: {create: Denied},
};
window.addEventListener('DOMContentLoaded', () => {
 const Banner = document.createElement('p'); Banner.textContent = 'UI 검사 픽스처 · Chrome API 대역 · 설치 확장 아님';
 Banner.style.cssText = 'padding:12px;background:#fff1c2;color:#221a00;text-align:center'; document.body.prepend(Banner);
});
`;
const Static = CreatePreviewServer({root: ProjectPath('extension')});
const Serve = Static.listeners('request')[0];
Http.createServer(async (Request, Response) =>
{
	if (Request.url.startsWith('/fixture.js'))
	{
		Response.writeHead(200, {'Content-Type': 'application/javascript'}).end(Fixture);
		return;
	}
	if (Request.url.split('?')[0] === '/options.html')
	{
		const Html = await ReadFile(ProjectPath('extension/options.html'), 'utf8');
		Response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(Html.replace('<body class="options">', '<body class="options"><script src="fixture.js"></script>'));
		return;
	}
	await Serve(Request, Response);
}).listen(0, '127.0.0.1', function ()
{
	console.log('OPTIONS_FIXTURE_URL=http://127.0.0.1:' + this.address().port + '/options.html');
});
