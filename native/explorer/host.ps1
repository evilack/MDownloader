param([Parameter(Position=0)][string]$CallerOrigin,
      [string]$ManifestPath,
      [string]$BindingsPath,
      [switch]$TestMode,[string]$TestFolder,
      [Parameter(ValueFromRemainingArguments=$true)][string[]]$ExtraArguments)
$ErrorActionPreference='Stop'
if(-not $ManifestPath){$ManifestPath=Join-Path $PSScriptRoot 'host-manifest.json'}
if(-not $BindingsPath){$BindingsPath=Join-Path $PSScriptRoot 'folder-bindings.json'}
function Read-Exact([IO.Stream]$Stream,[int]$Count) {
    $Buffer=New-Object byte[] $Count; $Offset=0
    while($Offset -lt $Count){$Read=$Stream.Read($Buffer,$Offset,$Count-$Offset);if($Read -le 0){throw 'invalid_message'};$Offset+=$Read}
    return ,$Buffer
}
function Get-SampleHash([string]$Path) {
    $Stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
    $Data=New-Object IO.MemoryStream
    try {
        $First=[int][Math]::Min($Stream.Length,65536);$Tail=[Math]::Max($First,$Stream.Length-65536)
        $Bytes=Read-Exact $Stream $First;$Data.Write($Bytes,0,$Bytes.Length)
        [void]$Stream.Seek($Tail,[IO.SeekOrigin]::Begin)
        $Bytes=Read-Exact $Stream ([int]($Stream.Length-$Tail));$Data.Write($Bytes,0,$Bytes.Length)
        $Sha=[Security.Cryptography.SHA256]::Create()
        try {return [BitConverter]::ToString($Sha.ComputeHash($Data.ToArray())).Replace('-','').ToLowerInvariant()}
        finally {$Sha.Dispose()}
    } finally {$Data.Dispose();$Stream.Dispose()}
}
function Resolve-SavedFile([string]$Directory,$Message) {
    if(-not [IO.Directory]::Exists($Directory)){throw 'folder_missing'}
    $Directory=[IO.Path]::GetFullPath($Directory)
    if(-not [string]::Equals(([IO.DirectoryInfo]$Directory).Name,[string]$Message.folderName,[StringComparison]::OrdinalIgnoreCase)){throw 'folder_mismatch'}
    $Path=[IO.Path]::Combine($Directory,[string]$Message.filename)
    if(-not [IO.File]::Exists($Path)){throw 'file_missing'}
    if(([IO.FileInfo]$Path).Length -ne [long]$Message.size -or (Get-SampleHash $Path) -ne $Message.sampleHash){throw 'file_mismatch'}
    return $Path
}
$InputStream=[Console]::OpenStandardInput();$OutputStream=[Console]::OpenStandardOutput()
$Mutex=$null;$Locked=$false
try {
    $Manifest=Get-Content -LiteralPath $ManifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
    if($CallerOrigin -cnotmatch '^chrome-extension://[a-p]{32}/$' -or $Manifest.allowed_origins -cnotcontains $CallerOrigin){throw 'origin_denied'}
    $Header=Read-Exact $InputStream 4;$Size=[BitConverter]::ToUInt32($Header,0)
    if($Size -eq 0 -or $Size -gt 2097152){throw 'invalid_message'}
    $Message=[Text.Encoding]::UTF8.GetString((Read-Exact $InputStream ([int]$Size))) | ConvertFrom-Json
    if($Size -gt 16384 -and $Message.action -cne 'installCaptions'){throw 'invalid_message'}
    if($Message.action -ceq 'ping'){
        $Status=@{ok=$true;protocol=1;platform='win';helperVersion=9;helperRevision=1;capabilities=@('explorer')}
        if([IO.File]::Exists((Join-Path $PSScriptRoot 'common-setup.ps1'))){$Status.capabilities+=@('captionSetup','captionPackageUpdate','genericPackageManifest')}
        if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'lifecycle.ps1')){
            . (Join-Path $PSScriptRoot 'lifecycle.ps1')
            $Identity=Get-ExplorerIdentity $PSScriptRoot
            if($Identity){$Status.installationId=$Identity.installationId;$Status.canUninstall=$true;try{Save-ExplorerClient $PSScriptRoot $CallerOrigin}catch{}}
        }
        $Payload=[Text.Encoding]::UTF8.GetBytes(($Status|ConvertTo-Json -Compress))
        $Header=[BitConverter]::GetBytes([uint32]$Payload.Length);$OutputStream.Write($Header,0,4);$OutputStream.Write($Payload,0,$Payload.Length);$OutputStream.Flush()
        return
    }
    if($Message.action -cin @('installCaptions','captionSetupStatus')){
        $AllowedKeys=if($Message.action -ceq 'installCaptions'){@('action','jobId','package')}else{@('action','jobId')}
        if(@($Message.PSObject.Properties.Name|Where-Object {$_ -cnotin $AllowedKeys}).Count -gt 0){throw 'invalid_message'}
        if(-not [IO.File]::Exists((Join-Path $PSScriptRoot 'common-setup.ps1'))){throw 'common_helper_update_required'}
        . (Join-Path $PSScriptRoot 'common-setup.ps1')
        if($Message.action -ceq 'installCaptions'){
            if($Message.jobId){throw 'invalid_message'}
            if($Message.PSObject.Properties.Name -ccontains 'package'){
                if($null -eq $Message.package){throw 'invalid_setup_payload'}
                $Response=Start-CommonCaptionSetup $PSScriptRoot $CallerOrigin -Package $Message.package
            }else{$Response=Start-CommonCaptionSetup $PSScriptRoot $CallerOrigin}
        }else{
            if($Message.jobId -cnotmatch '^[a-f0-9]{32}$'){throw 'invalid_setup_job'}
            $Response=Get-CommonSetupState $PSScriptRoot $CallerOrigin $Message.jobId
        }
    } elseif($Message.action -ceq 'uninstall'){
        if([IO.File]::Exists((Join-Path $PSScriptRoot 'common-setup.ps1'))){. (Join-Path $PSScriptRoot 'common-setup.ps1');if(Test-CommonSetupBusy $PSScriptRoot){throw 'common_setup_busy'}}
        . (Join-Path $PSScriptRoot 'lifecycle.ps1')
        $Identity=Get-ExplorerIdentity $PSScriptRoot
        if(-not $Identity -or $Message.installationId -cne $Identity.installationId){throw 'invalid_message'}
        Save-ExplorerClient $PSScriptRoot $CallerOrigin
        $PowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $Startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}
        $Started=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=('"'+$PowerShell+'" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'uninstall.ps1')+'" -Confirmed -WaitProcessId '+$PID);ProcessStartupInformation=$Startup}
        if($Started.ReturnValue -ne 0){throw 'reveal_failed'}
        $Payload=[Text.Encoding]::UTF8.GetBytes('{"ok":true,"scheduled":true}')
        $Header=[BitConverter]::GetBytes([uint32]$Payload.Length);$OutputStream.Write($Header,0,4);$OutputStream.Write($Payload,0,$Payload.Length);$OutputStream.Flush()
        return
    } else {
    $ParsedGuid=[Guid]::Empty
    if($Message.action -cne 'reveal' -or -not [Guid]::TryParse([string]$Message.folderKey,[ref]$ParsedGuid)){throw 'invalid_message'}
    $Name=[string]$Message.filename
    if(-not $Name -or $Name -ne [IO.Path]::GetFileName($Name) -or $Name.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0){throw 'invalid_filename'}
    if([string]$Message.sampleHash -cnotmatch '^[a-f0-9]{64}$' -or [long]$Message.size -lt 0){throw 'invalid_message'}
    $Sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $Mutex=New-Object Threading.Mutex($false,('Local\MDownloaderExplorerBridge-'+$Sid))
    try {$Locked=$Mutex.WaitOne(300000)} catch [Threading.AbandonedMutexException] {$Locked=$true}
    if(-not $Locked){throw 'binding_required'}
    $Bindings=@{}
    if(Test-Path -LiteralPath $BindingsPath){$Stored=Get-Content -LiteralPath $BindingsPath -Encoding UTF8 -Raw | ConvertFrom-Json;foreach($Property in $Stored.PSObject.Properties){$Bindings[$Property.Name]=[string]$Property.Value}}
    $Key=$CallerOrigin+'|'+$ParsedGuid.ToString();$Path=$null
    if($Bindings.ContainsKey($Key)){try{$Path=Resolve-SavedFile $Bindings[$Key] $Message}catch{$Path=$null}}
    if(-not $Path){
        if($TestMode){if(-not $TestFolder){throw 'binding_required'};$Directory=$TestFolder}
        else {
            Add-Type -AssemblyName System.Windows.Forms
            $Picker=New-Object Windows.Forms.FolderBrowserDialog
            try {
                $Picker.Description="Choose the saved file's folder once to link Windows Explorer: "+$Message.folderName
                $Picker.ShowNewFolderButton=$false
                . (Join-Path $PSScriptRoot 'dialog.ps1')
                if((Invoke-SavedFolderPicker $Picker (Get-ChromeParentWindow $ExtraArguments)) -ne [Windows.Forms.DialogResult]::OK){throw 'canceled'}
                $Directory=$Picker.SelectedPath
            } finally {$Picker.Dispose()}
        }
        $Path=Resolve-SavedFile $Directory $Message
        $Bindings[$Key]=[IO.Path]::GetDirectoryName($Path)
        $Temporary=$BindingsPath+'.'+[Guid]::NewGuid().ToString()+'.tmp'
        try {[IO.File]::WriteAllText($Temporary,($Bindings | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $Temporary -Destination $BindingsPath -Force}
        finally {if(Test-Path -LiteralPath $Temporary){Remove-Item -LiteralPath $Temporary}}
    }
    if(-not $TestMode){
        $Explorer=Join-Path ([Environment]::GetFolderPath('Windows')) 'explorer.exe'
        Start-Process -FilePath $Explorer -ArgumentList ('/select,"'+$Path+'"')
    }
    $Response=@{ok=$true;testMode=[bool]$TestMode}
    }
} catch {
    $Failure=$_;$IsSetup=$Message.action -cin @('installCaptions','captionSetupStatus')
    $Codes=@('origin_denied','invalid_message','invalid_filename','folder_missing','folder_mismatch','file_missing','file_mismatch','binding_required','canceled','common_helper_update_required','invalid_setup_job','invalid_setup_state','invalid_setup_payload','unsafe_setup_path','common_setup_busy','caption_package_write_failed')
    $Code=$Failure.Exception.Message;if($Code -notin $Codes){$Code=if($IsSetup){'common_setup_failed'}else{'reveal_failed'}}
    if($IsSetup){try{
        if(Get-Command Assert-CommonSetupPath -CommandType Function -ErrorAction SilentlyContinue){
            $DiagnosticPath=Assert-CommonSetupPath (Join-Path $PSScriptRoot 'helper-last-error.json') $PSScriptRoot
            $Cause=$Failure.Exception.GetBaseException();$Detail=[string]$Cause.Message
            if($Detail.Length -gt 1000){$Detail=$Detail.Substring(0,1000)}
            $Diagnostic=@{code=$Code;action=$Message.action;helperVersion=9;helperRevision=1;exceptionType=$Cause.GetType().FullName;hResult=$Cause.HResult;message=$Detail;script=[IO.Path]::GetFileName($Failure.InvocationInfo.ScriptName);line=$Failure.InvocationInfo.ScriptLineNumber;updated=[DateTime]::UtcNow.ToString('o')}
            [IO.File]::WriteAllText($DiagnosticPath,($Diagnostic|ConvertTo-Json -Compress -Depth 3),[Text.UTF8Encoding]::new($false))
        }
    }catch{}}
    $Response=@{ok=$false;code=$Code}
}
finally {if($Locked){$Mutex.ReleaseMutex()};if($Mutex){$Mutex.Dispose()}}
$Payload=[Text.Encoding]::UTF8.GetBytes(($Response | ConvertTo-Json -Compress))
$Header=[BitConverter]::GetBytes([uint32]$Payload.Length);$OutputStream.Write($Header,0,4);$OutputStream.Write($Payload,0,$Payload.Length);$OutputStream.Flush()
