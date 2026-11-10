import {DownloadNamedFile,ForgetDownloadFilename} from './browser-download.js';
import {LocalizedError} from './i18n.js';
const RequiredNames=['host.ps1','dialog.ps1','install.ps1'],AllowedNames=[...RequiredNames,'lifecycle.ps1','uninstall.ps1','common-setup.ps1','caption-installer.json'];
function Base64(Text){return btoa(Array.from(new TextEncoder().encode(Text),Byte=>String.fromCharCode(Byte)).join(''));}
export function ValidateExplorerInstaller(Bundle,ExtensionId){
	const Names=Object.keys(Bundle.files??{}),Lifecycle=Names.includes('lifecycle.ps1'),Uninstall=Names.includes('uninstall.ps1'),Common=Names.includes('common-setup.ps1'),LegacySpeech=Names.includes('caption-installer.json');
	if(!/^[a-p]{32}$/.test(ExtensionId)||RequiredNames.some(Name=>!Names.includes(Name))||Names.some(Name=>!AllowedNames.includes(Name)||typeof Bundle.files[Name]?.base64!=='string')||Lifecycle!==Uninstall||Common&&!Lifecycle||LegacySpeech&&!Common)throw Error('Invalid Explorer setup payload');
	return Names;
}
export function CreateExplorerInstaller(Bundle,ExtensionId,RemovalToken)
{
	const Names=ValidateExplorerInstaller(Bundle,ExtensionId);
	const NameList=Names.map(Name=>"'"+Name+"'").join(',');
	if(RemovalToken!==undefined&&(!/^[a-f0-9]{32}$/.test(RemovalToken)||!Names.includes('uninstall.ps1')))throw Error('Invalid removal payload');
	const Command=RemovalToken?`& (Join-Path $Directory 'uninstall.ps1') -Confirmed -CallbackToken '${RemovalToken}' -RequestedOrigin 'chrome-extension://${ExtensionId}/'`:`& (Join-Path $Directory 'install.ps1') -ExtensionId '${ExtensionId}'`;
	const Payload=Base64(JSON.stringify(Bundle));
	const Script=`$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$Bundle=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Payload}'))|ConvertFrom-Json
$Directory=Join-Path ([IO.Path]::GetDirectoryName($env:MDOWNLOADER_SETUP_FILE)) ('mdownloader-setup-'+[Guid]::NewGuid().ToString())
[void][IO.Directory]::CreateDirectory($Directory)
try {
 foreach($Name in @(${NameList})){
  [IO.File]::WriteAllBytes((Join-Path $Directory $Name),[Convert]::FromBase64String($Bundle.files.$Name.base64))
 }
 ${Command}
 Write-Host '${RemovalToken?'MDownloader helper removal started. Chrome will verify completion.':'MDownloader Windows helper installed and verified.'}'
} finally {
 foreach($Name in @(${NameList})){$Path=Join-Path $Directory $Name;if([IO.File]::Exists($Path)){[IO.File]::Delete($Path)}}
 if([IO.Directory]::Exists($Directory) -and [IO.Directory]::GetFileSystemEntries($Directory).Length -eq 0){[IO.Directory]::Delete($Directory)}
}
`;
	return ['@echo off','setlocal DisableDelayedExpansion','set "MDOWNLOADER_SETUP_FILE=%~f0"','"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:MDOWNLOADER_SETUP_FILE);$p=$t.Split(@(\'::MDOWNLOADER_WINDOWS_SETUP_PAYLOAD::\'),[StringSplitOptions]::None)[-1].Trim();&([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))))"','if errorlevel 1 (echo Installation failed. & pause & exit /b 1)','exit /b 0','::MDOWNLOADER_WINDOWS_SETUP_PAYLOAD::',Base64(Script),''].join('\r\n');
}
let PreparedBundle;
export function PrepareExplorerInstaller({refresh=false}={}){if(refresh)PreparedBundle=undefined;return PreparedBundle??=fetch(chrome.runtime.getURL('data/explorer-installer.json'),{cache:'no-store'}).then(async Response=>{if(!Response.ok)throw Error('Explorer setup payload unavailable');return Response.json();}).catch(ErrorValue=>{PreparedBundle=undefined;throw ErrorValue;});}
export async function DownloadExplorerInstaller(RemovalToken)
{
	const Text=CreateExplorerInstaller(await PrepareExplorerInstaller(),chrome.runtime.id,RemovalToken);
	const Url=URL.createObjectURL(new Blob([Text],{type:'application/octet-stream'}));
	let Id;
	try {
		Id=await DownloadNamedFile(Url,RemovalToken?'MDownloader-Windows-Remove.cmd':'MDownloader-Windows-Setup.cmd',{saveAs:false});
		const Until=Date.now()+15000;
		while(Date.now()<Until){const[Item]=await chrome.downloads.search({id:Id});if(Item?.state==='complete')return Id;if(Item?.state==='interrupted')throw Error(Item.error??'Installer download interrupted');await new Promise(Resolve=>setTimeout(Resolve,100));}
		throw new LocalizedError('explorer_setup_download_timeout');
	} finally {if(Id!==undefined)ForgetDownloadFilename(Id);URL.revokeObjectURL(Url);}
}
