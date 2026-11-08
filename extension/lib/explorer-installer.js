import {DownloadNamedFile,ForgetDownloadFilename} from './browser-download.js';
import {LocalizedError} from './i18n.js';
const Names=['host.ps1','dialog.ps1','install.ps1'];
function Base64(Text){return btoa(Array.from(new TextEncoder().encode(Text),Byte=>String.fromCharCode(Byte)).join(''));}
export function CreateExplorerInstaller(Bundle,ExtensionId)
{
	if(!/^[a-p]{32}$/.test(ExtensionId)||Object.keys(Bundle.files??{}).length!==Names.length||Names.some(Name=>typeof Bundle.files?.[Name]?.base64!=='string'))throw Error('Invalid Explorer setup payload');
	const Payload=Base64(JSON.stringify(Bundle));
	const Script=`$ErrorActionPreference='Stop'
$Bundle=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Payload}'))|ConvertFrom-Json
$Directory=Join-Path ([IO.Path]::GetDirectoryName($env:MDOWNLOADER_SETUP_FILE)) ('mdownloader-setup-'+[Guid]::NewGuid().ToString())
[void][IO.Directory]::CreateDirectory($Directory)
try {
 foreach($Name in @('host.ps1','dialog.ps1','install.ps1')){
  [IO.File]::WriteAllBytes((Join-Path $Directory $Name),[Convert]::FromBase64String($Bundle.files.$Name.base64))
 }
 & (Join-Path $Directory 'install.ps1') -ExtensionId '${ExtensionId}'
 Write-Host 'MDownloader Windows helper installed and verified.'
} finally {
 foreach($Name in @('host.ps1','dialog.ps1','install.ps1')){$Path=Join-Path $Directory $Name;if([IO.File]::Exists($Path)){[IO.File]::Delete($Path)}}
 if([IO.Directory]::Exists($Directory) -and [IO.Directory]::GetFileSystemEntries($Directory).Length -eq 0){[IO.Directory]::Delete($Directory)}
}
`;
	return ['@echo off','setlocal DisableDelayedExpansion','set "MDOWNLOADER_SETUP_FILE=%~f0"','"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:MDOWNLOADER_SETUP_FILE);$p=$t.Split(@(\'::MDOWNLOADER_WINDOWS_SETUP_PAYLOAD::\'),[StringSplitOptions]::None)[-1].Trim();&([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))))"','if errorlevel 1 (echo Installation failed. & pause & exit /b 1)','exit /b 0','::MDOWNLOADER_WINDOWS_SETUP_PAYLOAD::',Base64(Script),''].join('\r\n');
}
export async function DownloadExplorerInstaller()
{
	const Response=await fetch(chrome.runtime.getURL('data/explorer-installer.json'));
	if(!Response.ok)throw Error('Explorer setup payload unavailable');
	const Text=CreateExplorerInstaller(await Response.json(),chrome.runtime.id);
	const Url='data:application/octet-stream;base64,'+Base64(Text);
	let Id;
	try {
		Id=await DownloadNamedFile(Url,'MDownloader-Windows-Setup.cmd');
		const Until=Date.now()+15000;
		while(Date.now()<Until){const[Item]=await chrome.downloads.search({id:Id});if(Item?.state==='complete')return Id;if(Item?.state==='interrupted')throw Error(Item.error??'Installer download interrupted');await new Promise(Resolve=>setTimeout(Resolve,100));}
		throw new LocalizedError('explorer_setup_download_timeout');
	} finally {if(Id!==undefined)ForgetDownloadFilename(Id);}
}
