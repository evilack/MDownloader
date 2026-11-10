param([switch]$Confirmed,[switch]$Worker,[string]$SnapshotPath,[int]$WaitProcessId=0,[string]$CallbackToken,[string]$RequestedOrigin)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'lifecycle.ps1')
$Directory=Get-ExplorerDirectory
$ManifestPath=Join-Path $Directory 'host-manifest.json'
$NativeKey='HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mdownloader.explorer'
$AppsKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MDownloaderExplorerBridge'
if(-not $Worker){
    [void](Assert-ExplorerDirectory $Directory (Get-ExplorerDirectory))
    if([IO.File]::Exists((Join-Path $Directory 'common-setup.ps1'))){. (Join-Path $Directory 'common-setup.ps1');if(Test-CommonSetupBusy $Directory){throw 'Caption setup is running. Try removal after setup finishes.'}}
    if(-not $Confirmed){
        Add-Type -AssemblyName System.Windows.Forms
        . (Join-Path $PSScriptRoot 'dialog.ps1')
        $Prompt=New-Object PSObject
        $Prompt|Add-Member ScriptMethod ShowDialog {param($Owner) [Windows.Forms.MessageBox]::Show($Owner,"Remove the MDownloader Windows helper?`n`nHelper files and folder links will be removed.`nDownloaded videos and subtitles will be kept.`nThe download location will return to the browser default.",'MDownloader Windows Helper',[Windows.Forms.MessageBoxButtons]::YesNo,[Windows.Forms.MessageBoxIcon]::Question,[Windows.Forms.MessageBoxDefaultButton]::Button2)}
        if((Invoke-SavedFolderPicker $Prompt ([IntPtr]::Zero)) -ne [Windows.Forms.DialogResult]::Yes){return}
    }
    $Manifest=Get-Content -LiteralPath $ManifestPath -Encoding UTF8 -Raw|ConvertFrom-Json
    $Identity=Get-ExplorerIdentity $Directory
    if($CallbackToken){
        if($CallbackToken -cnotmatch '^[a-f0-9]{32}$' -or $Manifest.allowed_origins -cnotcontains $RequestedOrigin){throw 'invalid_removal_request'}
        $Identity=@{installationId=$CallbackToken;clients=@()};$Manifest.allowed_origins=@($RequestedOrigin)
    }
    if(-not $Identity){throw 'Helper update required before removal.'}
    $Temporary=Join-Path ([IO.Path]::GetTempPath()) ('MDownloaderExplorerRemoval-'+[Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($Temporary)
    foreach($Name in @('uninstall.ps1','lifecycle.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $Name) -Destination (Join-Path $Temporary $Name)}
    $Snapshot=@{installationId=$Identity.installationId;legacy=[bool]$CallbackToken;origins=@($Manifest.allowed_origins);clients=@($Identity.clients);entryProcess=$PID;hostProcess=$WaitProcessId}
    $SnapshotPath=Join-Path $Temporary 'receipt.json'
    [IO.File]::WriteAllText($SnapshotPath,($Snapshot|ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
    $PowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $Startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
    $Started=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=('"'+$PowerShell+'" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $Temporary 'uninstall.ps1')+'" -Worker -Confirmed -SnapshotPath "'+$SnapshotPath+'"');ProcessStartupInformation=$Startup}
    if($Started.ReturnValue -ne 0){throw 'removal_worker_failed'}
    return
}
$ExpectedPrefix=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\MDownloaderExplorerRemoval-'
if(-not [IO.Path]::GetFullPath($PSScriptRoot).StartsWith($ExpectedPrefix,[StringComparison]::OrdinalIgnoreCase) -or
   [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($SnapshotPath)) -ne [IO.Path]::GetFullPath($PSScriptRoot)){throw 'unsafe_worker'}
$Snapshot=Get-Content -LiteralPath $SnapshotPath -Encoding UTF8 -Raw|ConvertFrom-Json
try {
    foreach($ProcessId in @($Snapshot.entryProcess,$Snapshot.hostProcess)){
        $Until=[DateTime]::UtcNow.AddSeconds(20)
        while($ProcessId -gt 0 -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $Until){Start-Sleep -Milliseconds 100}
    }
    [void](Assert-ExplorerRegistration $NativeKey $AppsKey $Directory $ManifestPath)
    $Targets=Get-ExplorerCallbacks $Snapshot
    $Mutex=New-Object Threading.Mutex($false,('Local\MDownloaderExplorerLifecycle-'+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value));$Locked=$false
    try{
        try{$Locked=$Mutex.WaitOne(15000)}catch [Threading.AbandonedMutexException]{$Locked=$true};if(-not $Locked){throw 'lifecycle_busy'}
        $Current=Get-ExplorerIdentity $Directory
        if($Current -and -not $Snapshot.legacy -and $Current.installationId -ne $Snapshot.installationId){throw 'installation_changed'}
        $SetupMutex=New-Object Threading.Mutex($false,('Local\MDownloaderCaptionSetup-'+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value));$SetupLocked=$false
        try{
            try{$SetupLocked=$SetupMutex.WaitOne(15000)}catch [Threading.AbandonedMutexException]{$SetupLocked=$true};if(-not $SetupLocked){throw 'setup_busy'}
            if([IO.File]::Exists((Join-Path $Directory 'common-setup.ps1'))){. (Join-Path $Directory 'common-setup.ps1');if(Test-CommonSetupBusy $Directory){throw 'setup_busy'}}
            [void](Remove-ExplorerFiles $Directory (Get-ExplorerDirectory))
        }finally{if($SetupLocked){$SetupMutex.ReleaseMutex()};$SetupMutex.Dispose()}
    }finally{if($Locked){$Mutex.ReleaseMutex()};$Mutex.Dispose()}
    if(Test-Path -LiteralPath $NativeKey){Remove-Item -LiteralPath $NativeKey}
    if(Test-Path -LiteralPath $AppsKey){Remove-Item -LiteralPath $AppsKey}
    Send-ExplorerLifecycle $Snapshot 'removed' $Targets
} finally {
    foreach($Name in @('uninstall.ps1','lifecycle.ps1','receipt.json')){$Path=Join-Path $PSScriptRoot $Name;if([IO.File]::Exists($Path)){[IO.File]::Delete($Path)}}
    if([IO.Directory]::Exists($PSScriptRoot) -and [IO.Directory]::GetFileSystemEntries($PSScriptRoot).Length -eq 0){[IO.Directory]::Delete($PSScriptRoot)}
}
