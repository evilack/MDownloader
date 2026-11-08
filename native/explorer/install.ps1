param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string[]]$ExtensionId)
$ErrorActionPreference='Stop'
$Destination=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MDownloader\ExplorerBridge'
$Manifest=Join-Path $Destination 'host-manifest.json'
$Registry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mdownloader.explorer'
if(Test-Path -LiteralPath $Registry){$Existing=(Get-Item -LiteralPath $Registry).GetValue('');if($Existing -ne $Manifest){throw 'Another Explorer bridge registration exists; inspect it before replacing.'}}
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'host.ps1') -Destination (Join-Path $Destination 'host.ps1') -Force
$Launcher=Join-Path $Destination 'host.cmd'
[IO.File]::WriteAllText($Launcher,('@echo off'+"`r`n"+'"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File "%~dp0host.ps1" %*'+"`r`n"),[Text.Encoding]::ASCII)
$Config=@{name='com.mdownloader.explorer';description='MDownloader Windows Explorer file reveal';path=$Launcher;type='stdio';allowed_origins=@($ExtensionId | ForEach-Object {'chrome-extension://'+$_+'/'})}
[IO.File]::WriteAllText($Manifest,($Config | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
New-Item -Path $Registry -Force | Out-Null
Set-Item -LiteralPath $Registry -Value $Manifest
Write-Output ('Registered Explorer bridge for '+($ExtensionId -join ', '))
