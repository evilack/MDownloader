function Get-ExplorerDirectory {
    return Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MDownloader\ExplorerBridge'
}
function Get-ExplorerIdentity([string]$Directory) {
    $Path=Join-Path $Directory 'lifecycle.json'
    if(-not [IO.File]::Exists($Path)){return $null}
    $State=Get-Content -LiteralPath $Path -Encoding UTF8 -Raw|ConvertFrom-Json
    if($State.installationId -cnotmatch '^[a-f0-9]{32}$'){throw 'invalid_installation'}
    return $State
}
function Normalize-ExplorerPath([string]$Path) {
    $Full=[IO.Path]::GetFullPath($Path);$Root=[IO.Path]::GetPathRoot($Full)
    return $Root+(($Full.Substring($Root.Length) -split '[\\/]+'|Where-Object {$_}) -join '\')
}
function Save-ExplorerClient([string]$Directory,[string]$Origin) {
    $ProcessId=$PID;$Chrome=$null
    for($Index=0;$Index -lt 6;$Index++){
        $Process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ProcessId) -ErrorAction SilentlyContinue
        if(-not $Process){break}
        if($Process.Name -ieq 'chrome.exe' -and $Process.CommandLine -notmatch '--type='){$Chrome=$Process;break}
        $ProcessId=$Process.ParentProcessId
    }
    $UserData=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Google\Chrome\User Data'
    if(-not $Chrome){return}
    $ClientProfile='Default'
    if($Chrome.CommandLine -match '--user-data-dir=(?:"([^"]+)"|([^\s]+))'){$UserData=if($Matches[1]){$Matches[1]}else{$Matches[2]}}
    if($Chrome.CommandLine -match '--profile-directory=(?:"([^"]+)"|([^\s]+))'){$ClientProfile=if($Matches[1]){$Matches[1]}else{$Matches[2]}}
    $Mutex=New-Object Threading.Mutex($false,('Local\MDownloaderExplorerLifecycle-'+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value));$Locked=$false
    try {
    try{$Locked=$Mutex.WaitOne(15000)}catch [Threading.AbandonedMutexException]{$Locked=$true};if(-not $Locked){throw 'lifecycle_busy'}
    $State=Get-ExplorerIdentity $Directory;if(-not $State){return}
    $Client=@{origin=$Origin;userData=(Normalize-ExplorerPath $UserData);profile=$ClientProfile;chromePath=$Chrome.ExecutablePath}
    if(@($State.clients|Where-Object {$_.origin -eq $Client.origin -and $_.userData -eq $Client.userData -and $_.profile -eq $Client.profile -and $_.chromePath -eq $Client.chromePath}).Count){return}
    $Clients=@($State.clients|Where-Object {$_ -and -not ($_.origin -eq $Client.origin -and $_.userData -eq $Client.userData -and $_.profile -eq $Client.profile)})
    $State.clients=@($Clients+$Client)
    $Temporary=Join-Path $Directory ('lifecycle.'+[Guid]::NewGuid().ToString('N')+'.tmp')
    try{[IO.File]::WriteAllText($Temporary,($State|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $Temporary -Destination (Join-Path $Directory 'lifecycle.json') -Force}
    finally{if(Test-Path -LiteralPath $Temporary){Remove-Item -LiteralPath $Temporary}}
    } finally {if($Locked){$Mutex.ReleaseMutex()};$Mutex.Dispose()}
}
function Assert-ExplorerDirectory([string]$Directory,[string]$Expected) {
    $Full=[IO.Path]::GetFullPath($Directory).TrimEnd('\');$ExpectedFull=[IO.Path]::GetFullPath($Expected).TrimEnd('\')
    if(-not [string]::Equals($Full,$ExpectedFull,[StringComparison]::OrdinalIgnoreCase) -or
       [IO.Path]::GetFileName($Full) -ne 'ExplorerBridge' -or [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($Full)) -ne 'MDownloader'){throw 'unsafe_directory'}
    if([IO.Directory]::Exists($Full) -and ((Get-Item -LiteralPath $Full -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'unsafe_directory'}
    $Parent=[IO.Path]::GetDirectoryName($Full)
    if([IO.Directory]::Exists($Parent) -and ((Get-Item -LiteralPath $Parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'unsafe_directory'}
    return $Full
}
function Assert-ExplorerRegistration([string]$NativeKey,[string]$AppsKey,[string]$Directory,[string]$ManifestPath) {
    if(Test-Path -LiteralPath $NativeKey){if((Get-Item -LiteralPath $NativeKey).GetValue('') -ne $ManifestPath){throw 'foreign_registration'}}
    if(Test-Path -LiteralPath $AppsKey){if((Get-ItemProperty -LiteralPath $AppsKey).InstallLocation -ne $Directory){throw 'foreign_registration'}}
}
function Remove-ExplorerFiles([string]$Directory,[string]$Expected) {
    $Full=Assert-ExplorerDirectory $Directory $Expected
    $Names=@('host.ps1','host.cmd','dialog.ps1','lifecycle.ps1','uninstall.ps1','uninstall.cmd','host-manifest.json','folder-bindings.json','lifecycle.json')
    if([IO.Directory]::Exists($Full)){
        foreach($Name in $Names){$Path=Join-Path $Full $Name;if([IO.File]::Exists($Path)){Remove-Item -LiteralPath $Path -Force}}
        foreach($File in Get-ChildItem -LiteralPath $Full -File -Force){if($File.Name -match '^(?:folder-bindings\.json|lifecycle)\.[a-f0-9-]{32,36}\.tmp$'){Remove-Item -LiteralPath $File.FullName -Force}}
        if([IO.Directory]::GetFileSystemEntries($Full).Length -eq 0){[IO.Directory]::Delete($Full)}
    }
    return @{removed=$true;retainedFiles=[IO.Directory]::Exists($Full)}
}
function Get-ExplorerCallbacks($Snapshot) {
    $Fallback=@(${env:ProgramFiles},${env:ProgramFiles(x86)},([Environment]::GetFolderPath('LocalApplicationData')))|Where-Object {$_}|ForEach-Object {Join-Path $_ 'Google\Chrome\Application\chrome.exe'}|Where-Object {[IO.File]::Exists($_)}|Select-Object -First 1
    $Clients=@($Snapshot.clients)
    foreach($Origin in @($Snapshot.origins)){if(-not @($Clients|Where-Object {$_.origin -eq $Origin}).Count){$Clients+=@{origin=$Origin;userData=(Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Google\Chrome\User Data');profile='Default'}}}
    $Targets=@{}
    foreach($Client in $Clients){
        if($Client.origin -cnotmatch '^chrome-extension://([a-p]{32})/$'){continue};$Id=$Matches[1]
        $UserData=Normalize-ExplorerPath $Client.userData
        $Chrome=if($Client.chromePath -and [IO.File]::Exists($Client.chromePath) -and [IO.Path]::GetFileName($Client.chromePath) -ieq 'chrome.exe'){$Client.chromePath}else{$Fallback}
        if(-not $Chrome){throw 'chrome_missing'}
        if(-not [IO.Directory]::Exists($UserData)){continue}
        # The root Chrome command line does not identify the native caller's profile.
        # Only installed profiles are targeted; each must authenticate its own token.
        foreach($Profile in Get-ChildItem -LiteralPath $UserData -Directory -ErrorAction SilentlyContinue){
            if($Profile.Attributes -band [IO.FileAttributes]::ReparsePoint){continue}
            $Installed=$false
            foreach($Name in @('Preferences','Secure Preferences')){
                $Path=Join-Path $Profile.FullName $Name
                if([IO.File]::Exists($Path)){try{$Preferences=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json;if($Preferences.extensions.settings.PSObject.Properties.Name -contains $Id){$Installed=$true;break}}catch{}}
            }
            # A just-loaded non-default profile may not have flushed Preferences yet.
            # Its own extension storage WAL already contains the installation identity
            # acknowledged by chrome.storage.local.set. Inspect only this extension's
            # bounded recent logs; never copy or emit profile data.
            if(-not $Installed -and $Snapshot.installationId -cmatch '^[a-f0-9]{32}$'){
                $Storage=Join-Path $Profile.FullName ('Local Extension Settings\'+$Id)
                if([IO.Directory]::Exists($Storage)){
                    foreach($Log in @(Get-ChildItem -LiteralPath $Storage -Filter '*.log' -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 3)){
                        if($Log.Length -gt 8388608){continue}
                        $Reader=$null
                        try{
                            $Reader=[IO.File]::Open($Log.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
                            if($Reader.Length -gt 8388608){continue}
                            $Bytes=New-Object byte[] ([int]$Reader.Length);$Offset=0
                            while($Offset -lt $Bytes.Length){$Read=$Reader.Read($Bytes,$Offset,$Bytes.Length-$Offset);if($Read -le 0){break};$Offset+=$Read}
                            if([Text.Encoding]::UTF8.GetString($Bytes,0,$Offset).Contains([string]$Snapshot.installationId)){$Installed=$true;break}
                        }catch{}finally{if($Reader){$Reader.Dispose()}}
                    }
                }
            }
            if(-not $Installed){continue}
            $Key=$Client.origin+'|'+$UserData+'|'+$Profile.Name
            $Targets[$Key]=@{origin=$Client.origin;userData=$UserData;profile=$Profile.Name;chromePath=$Chrome}
        }
    }
    return @($Targets.Values)
}
function Send-ExplorerLifecycle($Snapshot,[string]$Event,$Targets) {
    foreach($Client in $Targets){
        $Url=$Client.origin+'explorer-helper-lifecycle.html?event='+$Event+'&token='+$Snapshot.installationId
        $Arguments='--user-data-dir="'+$Client.userData+'" --profile-directory="'+$Client.profile+'" "'+$Url+'"'
        Start-Process -FilePath $Client.chromePath -ArgumentList $Arguments -WindowStyle Hidden
    }
}
