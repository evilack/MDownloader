param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string[]]$ExtensionId,
      [switch]$CurrentUserProcess)
$ErrorActionPreference='Stop'
# Tool-hosted processes can see a redirected LocalAppData filesystem that the
# already-running desktop Chrome cannot see. Run the write through Windows' WMI
# process service, then wait for its read-back result instead of reporting a
# successful write in the caller's filesystem view.
if(-not $CurrentUserProcess){
    $ResultPath=Join-Path $PSScriptRoot ('install-result-'+[Guid]::NewGuid().ToString()+'.json')
    $ScriptLiteral=$PSCommandPath.Replace("'","''")
    $ResultLiteral=$ResultPath.Replace("'","''")
    $Ids=($ExtensionId | ForEach-Object {"'"+$_+"'"}) -join ','
    $Command=@"
`$ErrorActionPreference='Stop'
try {
    & '$ScriptLiteral' -ExtensionId @($Ids) -CurrentUserProcess | Out-Null
    `$Result=@{ok=`$true}
} catch {`$Result=@{ok=`$false;error=`$_.Exception.Message}}
[IO.File]::WriteAllText('$ResultLiteral.tmp',(`$Result|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new(`$false))
[IO.File]::Move('$ResultLiteral.tmp','$ResultLiteral')
"@
    $Encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Command))
    $PowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $Startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
    try {
        $Started=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=('"'+$PowerShell+'" -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand '+$Encoded);ProcessStartupInformation=$Startup}
        if($Started.ReturnValue -ne 0){throw ('Desktop installer could not start: '+$Started.ReturnValue)}
        $Until=[DateTime]::UtcNow.AddSeconds(20)
        while(-not [IO.File]::Exists($ResultPath) -and [DateTime]::UtcNow -lt $Until){Start-Sleep -Milliseconds 100}
        if(-not [IO.File]::Exists($ResultPath)){throw 'Desktop installer did not return a verification result.'}
        $Result=Get-Content -LiteralPath $ResultPath -Encoding UTF8 -Raw | ConvertFrom-Json
        if(-not $Result.ok){throw ('Desktop installer failed: '+$Result.error)}
        Write-Output ('Registered desktop Explorer bridge for '+($ExtensionId -join ', '))
    } finally {if(Test-Path -LiteralPath $ResultPath){Remove-Item -LiteralPath $ResultPath}}
    return
}
$Destination=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MDownloader\ExplorerBridge'
. (Join-Path $PSScriptRoot 'lifecycle.ps1')
[void](Assert-ExplorerDirectory $Destination $Destination)
$Manifest=Join-Path $Destination 'host-manifest.json'
$Registry='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mdownloader.explorer'
$AppsKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MDownloaderExplorerBridge'
[void](Assert-ExplorerRegistration $Registry $AppsKey $Destination $Manifest)
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
foreach($Name in @('host.ps1','dialog.ps1','lifecycle.ps1','uninstall.ps1','common-setup.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $Name) -Destination (Join-Path $Destination $Name) -Force}
foreach($Name in @('host.ps1','dialog.ps1','lifecycle.ps1','uninstall.ps1','common-setup.ps1')){
    if((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot $Name)).Hash -ne
       (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Destination $Name)).Hash){throw 'Desktop helper copy verification failed.'}
}
$Launcher=Join-Path $Destination 'host.cmd'
[IO.File]::WriteAllText($Launcher,('@echo off'+"`r`n"+'set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules;%PSModulePath%"'+"`r`n"+'"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File "%~dp0host.ps1" %*'+"`r`n"),[Text.Encoding]::ASCII)
$Origins=@($ExtensionId | ForEach-Object {'chrome-extension://'+$_+'/'})
if(Test-Path -LiteralPath $Manifest){
    $Previous=Get-Content -LiteralPath $Manifest -Encoding UTF8 -Raw|ConvertFrom-Json
    if($Previous.name -eq 'com.mdownloader.explorer' -and $Previous.path -eq $Launcher){$Origins+=@($Previous.allowed_origins|Where-Object {$_ -cmatch '^chrome-extension://[a-p]{32}/$'})}
}
$Config=@{name='com.mdownloader.explorer';description='MDownloader common helper';path=$Launcher;type='stdio';allowed_origins=@($Origins|Select-Object -Unique)}
[IO.File]::WriteAllText($Manifest,($Config | ConvertTo-Json -Depth 4),[Text.UTF8Encoding]::new($false))
. (Join-Path $PSScriptRoot 'lifecycle.ps1')
$Identity=Get-ExplorerIdentity $Destination
if(-not $Identity){$Identity=@{installationId=[Guid]::NewGuid().ToString('N');clients=@()};[IO.File]::WriteAllText((Join-Path $Destination 'lifecycle.json'),($Identity|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))}
$AppsKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MDownloaderExplorerBridge'
New-Item -Path $AppsKey -Force|Out-Null
$UninstallCommand='"'+(Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')+'" -NoProfile -ExecutionPolicy Bypass -STA -File "'+(Join-Path $Destination 'uninstall.ps1')+'"'
foreach($Property in @{DisplayName='MDownloader Helper';DisplayVersion='2.0.0';Publisher='MDownloader';InstallLocation=$Destination;UninstallString=$UninstallCommand}.GetEnumerator()){New-ItemProperty -LiteralPath $AppsKey -Name $Property.Key -Value $Property.Value -PropertyType String -Force|Out-Null}
foreach($Name in @('NoModify','NoRepair')){New-ItemProperty -LiteralPath $AppsKey -Name $Name -Value 1 -PropertyType DWord -Force|Out-Null}
New-Item -Path $Registry -Force | Out-Null
Set-Item -LiteralPath $Registry -Value $Manifest
$Readback=Get-Content -LiteralPath $Manifest -Encoding UTF8 -Raw | ConvertFrom-Json
if($Readback.name -ne 'com.mdownloader.explorer' -or -not [IO.File]::Exists($Readback.path) -or
   (Get-Item -LiteralPath $Registry).GetValue('') -ne $Manifest){throw 'Desktop host read-back verification failed.'}
$Start=New-Object Diagnostics.ProcessStartInfo
$Start.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Start.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File "'+(Join-Path $Destination 'host.ps1')+'" "chrome-extension://'+$ExtensionId[0]+'/"'
$Start.UseShellExecute=$false;$Start.CreateNoWindow=$true;$Start.RedirectStandardInput=$true;$Start.RedirectStandardOutput=$true;$Start.RedirectStandardError=$true
$Process=New-Object Diagnostics.Process;$Process.StartInfo=$Start
try {
    [void]$Process.Start();$Payload=[Text.Encoding]::UTF8.GetBytes('{"action":"ping"}');$Header=[BitConverter]::GetBytes([uint32]$Payload.Length)
    $Process.StandardInput.BaseStream.Write($Header,0,4);$Process.StandardInput.BaseStream.Write($Payload,0,$Payload.Length);$Process.StandardInput.Close()
    $Output=New-Object IO.MemoryStream;$Process.StandardOutput.BaseStream.CopyTo($Output);$Process.WaitForExit();$Bytes=$Output.ToArray()
    if($Bytes.Length -lt 4 -or [BitConverter]::ToUInt32($Bytes,0) -ne $Bytes.Length-4){throw 'Desktop host ping framing failed.'}
    $Reply=[Text.Encoding]::UTF8.GetString($Bytes,4,$Bytes.Length-4)|ConvertFrom-Json
    if(-not $Reply.ok -or $Reply.protocol -ne 1){throw 'Desktop host ping failed.'}
} finally {$Process.Dispose()}
Write-Output ('Registered Explorer bridge for '+($ExtensionId -join ', '))
