param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
      [Parameter(Mandatory=$true)][string]$PythonPath)
$ErrorActionPreference = 'Stop'
$PythonPath = (Resolve-Path -LiteralPath $PythonPath).Path
& $PythonPath -c 'import frida; assert hasattr(__import__("hashlib"), "file_digest")'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 or later with frida is required.' }
$dir = $PSScriptRoot
$launcher = Join-Path $dir 'host.cmd'
$hostScript = Join-Path $dir 'host.py'
[IO.File]::WriteAllText($launcher, "@echo off`r`n`"$PythonPath`" `"$hostScript`" %*`r`n", [Text.Encoding]::ASCII)
$manifest = Join-Path $dir 'host-manifest.json'
@{name='com.mdownloader.kakao';description='MDownloader header observation bridge protocol 2';path=$launcher;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")} | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $manifest
foreach ($browser in @('Google\Chrome','Microsoft\Edge')) {
  $registry = "HKCU:\Software\$browser\NativeMessagingHosts\com.mdownloader.kakao"
  New-Item -Path $registry -Force | Out-Null
  Set-Item -Path $registry -Value $manifest
}
Write-Output 'Native host registered for Chrome and Edge.'
