$ErrorActionPreference='Stop'
$Registry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mdownloader.explorer'
$Expected=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MDownloader\ExplorerBridge\host-manifest.json'
if(Test-Path -LiteralPath $Registry){if((Get-Item -LiteralPath $Registry).GetValue('') -ne $Expected){throw 'Registration belongs to another location.'};Remove-Item -LiteralPath $Registry}
Write-Output 'Explorer bridge unregistered. Its files and folder bindings remain under LocalAppData\MDownloader\ExplorerBridge.'
