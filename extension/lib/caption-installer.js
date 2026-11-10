import {InstallCaptionsWithCommonHelper} from './common-helper.js';
import {SendRequest} from './ui.js';
import {CaptionPackageFiles as Names,CaptionPackageVersion} from '../data/caption-runtime-metadata.js';
const Base64=Text=>btoa(Array.from(new TextEncoder().encode(Text),B=>String.fromCharCode(B)).join(''));
let Payload;
export function PrepareCaptionInstaller(){return Payload??=fetch(chrome.runtime.getURL('data/caption-installer.json')).then(async R=>{if(!R.ok)throw Error('Caption installer unavailable');return R.json();}).catch(E=>{Payload=undefined;throw E;});}
export function ValidateCaptionInstaller(Bundle,ExtensionId){
 if(!/^[a-p]{32}$/.test(ExtensionId)||Bundle.version!==1||Bundle.packageVersion!==CaptionPackageVersion||Object.keys(Bundle.files??{}).length!==Names.length||Names.some(N=>typeof Bundle.files[N]?.base64!=='string'||!/^[a-f0-9]{64}$/.test(Bundle.files[N]?.sha256??'')))throw Error('Invalid caption installer');
}
export function CreateWindowsCaptionInstaller(Bundle,ExtensionId){
 ValidateCaptionInstaller(Bundle,ExtensionId);
 const Script=`$ErrorActionPreference='Stop'
$env:PSModulePath=(Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\Modules')+[IO.Path]::PathSeparator+$env:PSModulePath
$Bundle=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Base64(JSON.stringify(Bundle))}'))|ConvertFrom-Json
$Directory=Join-Path ([IO.Path]::GetTempPath()) ('mdownloader-captions-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($Directory)
try {
 foreach($Name in @(${Names.map(N=>"'"+N+"'").join(',')})){
  $Path=Join-Path $Directory $Name
  [IO.File]::WriteAllBytes($Path,[Convert]::FromBase64String($Bundle.files.$Name.base64))
  if((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Bundle.files.$Name.sha256){throw 'Installer payload checksum mismatch'}
 }
 & (Join-Path $Directory 'bootstrap.ps1') -ExtensionId '${ExtensionId}'
} finally {
 foreach($Name in @(${Names.map(N=>"'"+N+"'").join(',')})){$Path=Join-Path $Directory $Name;if([IO.File]::Exists($Path)){[IO.File]::Delete($Path)}}
 if([IO.Directory]::Exists($Directory) -and [IO.Directory]::GetFileSystemEntries($Directory).Length -eq 0){[IO.Directory]::Delete($Directory)}
}`;
 return ['@echo off','setlocal DisableDelayedExpansion','set "MDOWNLOADER_CAPTION_SETUP=%~f0"','"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:MDOWNLOADER_CAPTION_SETUP);$p=$t.Split(@(\'::MDOWNLOADER_CAPTION_PAYLOAD::\'),[StringSplitOptions]::None)[-1].Trim();&([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))))"','if errorlevel 1 (echo Setup failed. See MDownloader/Captions/setup.log. & pause & exit /b 1)','exit /b 0','::MDOWNLOADER_CAPTION_PAYLOAD::',Base64(Script),''].join('\r\n');
}
export async function DownloadCaptionInstaller(Platform){
 // Compatibility export: installers must go through the registered common helper on both OSes.
 throw Error('common_helper_required');
}
export async function InstallCaptionHelper(Platform,Probe,OnState){
 if(!['win','mac'].includes(Platform))throw Error('unsupported_platform');
 const Bundle=await PrepareCaptionInstaller();ValidateCaptionInstaller(Bundle,chrome.runtime.id);
 await SendRequest('captionReconnect');let Reconnected=false;
 return InstallCaptionsWithCommonHelper(async()=>{if(!Reconnected){await SendRequest('captionReconnect');Reconnected=true;}return Probe({engine:Platform==='mac'?'whisper.cpp':'faster-whisper',model:''});},OnState,{bundle:Bundle});
}
