/**
 * 로컬 검사 도구의 환경 경계를 한곳에서 관리합니다. 프로젝트는 이 파일의 위치에서
 * 찾고 브라우저/자동화 모듈은 환경으로 전달받습니다. 과거 임시 폴더·개인 경로를
 * 검색하거나 패키지를 설치하지 않습니다. 확장 실행 시점에는 이 모듈을 사용하지 않습니다.
 */
import Path from 'node:path';
import {fileURLToPath as FileURLToPath, pathToFileURL as PathToFileURL} from 'node:url';
export function ResolveToolConfig(Environment = process.env)
{
	const Root = Path.resolve(Environment.MDOWNLOADER_ROOT || FileURLToPath(new URL('../../', import.meta.url)));
	const Port = Number(Environment.MDOWNLOADER_PREVIEW_PORT || 4173);
	if (!Number.isInteger(Port) || Port < 1 || Port > 65535)
	{
		throw new TypeError('Invalid preview port');
	}
	const Preview = new URL(Environment.MDOWNLOADER_PREVIEW_URL || `http://127.0.0.1:${Port}/`);
	if (!['http:', 'https:'].includes(Preview.protocol))
	{
		throw new TypeError('Preview URL must use HTTP(S)');
	}
	return Object.freeze({root: Root, websiteRoot: Path.join(Root, 'website'), previewUrl: Preview.href,
		port: Port, browserPath: Environment.MDOWNLOADER_BROWSER_PATH,
		puppeteerModule: Environment.MDOWNLOADER_PUPPETEER_MODULE,
		artifacts: Environment.MDOWNLOADER_ARTIFACTS || new Date().toISOString().replace(/[:.]/g, '-'),
	});
}

export const ToolConfig = ResolveToolConfig();
export const ProjectPath = (...Parts) => Path.join(ToolConfig.root, ...Parts);
/** 실행 산출물은 Git에서 제외하는 artifacts/<실행>에만 씁니다. */
export const ArtifactPath = (...Parts) => ProjectPath('artifacts', ToolConfig.artifacts, ...Parts);
export const PreviewUrl = Relative => new URL(Relative, ToolConfig.previewUrl).href;
export const BrowserOptions = Object.freeze(ToolConfig.browserPath ? {executablePath: ToolConfig.browserPath} : {});
export async function LoadBrowserAutomation()
{
	const Module = ToolConfig.puppeteerModule;
	try
	{
		const Loaded = await import(Module && Path.isAbsolute(Module) ? PathToFileURL(Module).href : Module || 'puppeteer');
		return Loaded.puppeteer ?? Loaded.default ?? Loaded;
	}
	catch
	{
		throw new Error('Set MDOWNLOADER_PUPPETEER_MODULE to an existing automation module; no dependency is installed automatically.');
	}
}
