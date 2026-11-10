param([switch]$Worker,[string]$Root=$PSScriptRoot,[string]$JobId,[string]$SetupOrigin,
      [switch]$NoRegister,[string]$CaptionDestination)
$ErrorActionPreference='Stop'
function Assert-CommonSetupPath([string]$Path,[string]$Directory){
 $Base=[IO.Path]::GetFullPath($Directory).TrimEnd('\');$Full=[IO.Path]::GetFullPath($Path)
 if($Full -ne $Base -and -not $Full.StartsWith($Base+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'unsafe_setup_path'}
 $Current=$Full
 while($Current){
  $Entry=Get-Item -LiteralPath $Current -Force -ErrorAction SilentlyContinue
  if($Entry -and ($Entry.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'unsafe_setup_path'}
  $Parent=[IO.Path]::GetDirectoryName($Current);if($Parent -eq $Current){break};$Current=$Parent
 }
 return $Full
}
function Write-CommonSetupState([string]$Directory,$State,[switch]$Owned,[string]$ExpectedStatus,[switch]$AllowChanged){
 $Path=Assert-CommonSetupPath (Join-Path $Directory 'caption-setup-state.json') $Directory
 $Temporary=$Path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
 $StateMutex=$null;$StateLocked=$false
 try{
  if($Owned){
   $StateMutex=New-Object Threading.Mutex($false,('Local\MDownloaderCaptionSetup-'+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value))
   try{$StateLocked=$StateMutex.WaitOne(10000)}catch [Threading.AbandonedMutexException]{$StateLocked=$true};if(-not $StateLocked){throw 'common_setup_busy'}
   $Current=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json
   if($Current.jobId -cne $State.jobId -or $Current.origin -cne $State.origin){throw 'invalid_setup_job'}
   if($ExpectedStatus -and $Current.status -cne $ExpectedStatus){if($AllowChanged){return};throw 'invalid_setup_job'}
  }
  [IO.File]::WriteAllText($Temporary,($State|ConvertTo-Json -Compress -Depth 5),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $Temporary -Destination $Path -Force
 }finally{if([IO.File]::Exists($Temporary)){[IO.File]::Delete($Temporary)};if($StateLocked){$StateMutex.ReleaseMutex()};if($StateMutex){$StateMutex.Dispose()}}
}
function Get-CommonSetupState([string]$Directory,[string]$Origin,[string]$RequestedJob){
 $Path=Assert-CommonSetupPath (Join-Path $Directory 'caption-setup-state.json') $Directory
 if(-not [IO.File]::Exists($Path)){return @{ok=$true;status='idle'}}
 $State=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json
 if($State.jobId -cnotmatch '^[a-f0-9]{32}$' -or $State.origin -cnotmatch '^chrome-extension://[a-p]{32}/$'){throw 'invalid_setup_state'}
 if($State.origin -cne $Origin){throw 'common_setup_busy'}
 if($RequestedJob -and $RequestedJob -cne $State.jobId){throw 'invalid_setup_job'}
 if($State.status -in @('queued','installing')){
  $Age=([DateTime]::UtcNow-[DateTime]::Parse($State.started)).TotalSeconds
  $Process=if($State.status -eq 'installing'){Get-Process -Id $State.processId -ErrorAction SilentlyContinue}else{$null}
  $Stopped=$State.status -eq 'installing' -and (-not $Process -or ($State.processStarted -and $Process.StartTime.ToUniversalTime().ToString('o') -cne $State.processStarted))
  # A live worker owns its children and must stay busy even on a slow installation.
  if(($State.status -eq 'queued' -and $Age -gt 30) -or $Stopped){$OldStatus=$State.status;$State.status='failed';$State.error='common_setup_interrupted';Write-CommonSetupState $Directory $State -Owned -ExpectedStatus $OldStatus -AllowChanged;return Get-CommonSetupState $Directory $Origin $RequestedJob}
 }
 return @{ok=$true;jobId=$State.jobId;status=$State.status;error=$State.error}
}
function Test-CommonSetupBusy([string]$Directory){
 $Path=Assert-CommonSetupPath (Join-Path $Directory 'caption-setup-state.json') $Directory
 if(-not [IO.File]::Exists($Path)){return $false}
 $State=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json
 return (Get-CommonSetupState $Directory $State.origin $State.jobId).status -in @('queued','installing')
}
function Assert-CommonPackageNames([string[]]$Names){
 if($Names.Count -lt 1 -or $Names.Count -gt 128 -or $Names -cnotcontains 'bootstrap.ps1'){throw 'invalid_setup_payload'}
 $Entries=@{};$Files=@{}
 foreach($Name in $Names){
  if(-not $Name -or $Name.Length -gt 240 -or $Name -cnotmatch '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$'){throw 'invalid_setup_payload'}
  $Parts=$Name.Split('/');$Prefix=''
  foreach($Part in $Parts){
   if($Part -in @('.','..') -or $Part.EndsWith('.') -or $Part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)'){throw 'invalid_setup_payload'}
   $Prefix=if($Prefix){$Prefix+'/'+$Part}else{$Part}
   if($Entries.ContainsKey($Prefix) -and $Entries[$Prefix] -cne $Prefix){throw 'invalid_setup_payload'}
   $Entries[$Prefix]=$Prefix
  }
  if($Files.ContainsKey($Name)){throw 'invalid_setup_payload'};$Files[$Name]=$true
 }
 foreach($Name in $Names){$Parent=[IO.Path]::GetDirectoryName($Name.Replace('/','\'));while($Parent){if($Files.ContainsKey($Parent.Replace('\','/'))){throw 'invalid_setup_payload'};$Parent=[IO.Path]::GetDirectoryName($Parent)}}
}
function Read-CommonCaptionPackage($Package,[switch]$RequirePackageVersion){
 if($Package -isnot [System.Management.Automation.PSCustomObject]){throw 'invalid_setup_payload'}
 $Keys=@($Package.PSObject.Properties.Name)
 if(@($Keys|Where-Object {$_ -cnotin @('version','packageVersion','files')}).Count -gt 0 -or $Keys -cnotcontains 'version' -or $Keys -cnotcontains 'files'){throw 'invalid_setup_payload'}
 if(($Package.version -isnot [int] -and $Package.version -isnot [long]) -or $Package.version -ne 1){throw 'invalid_setup_payload'}
 if($RequirePackageVersion -or $Keys -ccontains 'packageVersion'){
  if(($Package.packageVersion -isnot [int] -and $Package.packageVersion -isnot [long]) -or $Package.packageVersion -lt 1 -or $Package.packageVersion -gt 1000000){throw 'invalid_setup_payload'}
 }
 if($Package.files -isnot [System.Management.Automation.PSCustomObject]){throw 'invalid_setup_payload'}
 $Names=@($Package.files.PSObject.Properties.Name)
 Assert-CommonPackageNames $Names
 $Files=@{};$TotalBytes=0
 foreach($Name in $Names){
  $Item=$Package.files.PSObject.Properties[$Name].Value
  if($Item -isnot [System.Management.Automation.PSCustomObject]){throw 'invalid_setup_payload'}
  $ItemKeys=@($Item.PSObject.Properties.Name)
  if($ItemKeys.Count -ne 2 -or $ItemKeys -cnotcontains 'base64' -or $ItemKeys -cnotcontains 'sha256'){throw 'invalid_setup_payload'}
  if($Item.base64 -isnot [string] -or $Item.sha256 -isnot [string] -or $Item.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $Item.base64.Length -gt 1398104){throw 'invalid_setup_payload'}
  try{$Bytes=[Convert]::FromBase64String($Item.base64)}catch{throw 'invalid_setup_payload'}
  if([Convert]::ToBase64String($Bytes) -cne $Item.base64){throw 'invalid_setup_payload'}
  $TotalBytes+=$Bytes.Length
  if($Bytes.Length -gt 1048576 -or $TotalBytes -gt 1048576){throw 'invalid_setup_payload'}
  $Sha=[Security.Cryptography.SHA256]::Create()
  try{$Hash=[BitConverter]::ToString($Sha.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant()}finally{$Sha.Dispose()}
  if($Hash -cne $Item.sha256){throw 'invalid_setup_payload'}
  $Files[$Name]=$Bytes
 }
 return $Files
}
function Expand-CommonCaptionPackage([string]$Stage,[string]$Directory,$Files){
 $Stage=Assert-CommonSetupPath $Stage $Directory
 if(Test-Path -LiteralPath $Stage){throw 'unsafe_setup_path'}
 [void][IO.Directory]::CreateDirectory($Stage)
 foreach($Name in $Files.Keys){
  $Path=Assert-CommonSetupPath (Join-Path $Stage $Name) $Stage
  $Parent=Assert-CommonSetupPath ([IO.Path]::GetDirectoryName($Path)) $Stage
  [void][IO.Directory]::CreateDirectory($Parent)
  [void](Assert-CommonSetupPath $Path $Stage)
  $Stream=[IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$Stream.Write($Files[$Name],0,$Files[$Name].Length)}finally{$Stream.Dispose()}
 }
}
function Remove-CommonCaptionPackage([string]$Stage,[string]$Directory,$Files){
 $Stage=Assert-CommonSetupPath $Stage $Directory
 $Parents=@{}
 foreach($Name in $Files.Keys){
  $Path=Assert-CommonSetupPath (Join-Path $Stage $Name) $Stage
  if([IO.File]::Exists($Path)){[IO.File]::Delete($Path)}
  $Parent=[IO.Path]::GetDirectoryName($Path)
  while($Parent -and $Parent -ne $Stage){$Parents[$Parent]=$true;$Parent=[IO.Path]::GetDirectoryName($Parent)}
 }
 foreach($Parent in @($Parents.Keys|Sort-Object -Property Length -Descending)){
  [void](Assert-CommonSetupPath $Parent $Stage)
  if([IO.Directory]::Exists($Parent) -and [IO.Directory]::GetFileSystemEntries($Parent).Length -eq 0){[IO.Directory]::Delete($Parent)}
 }
 if([IO.Directory]::Exists($Stage) -and [IO.Directory]::GetFileSystemEntries($Stage).Length -eq 0){[IO.Directory]::Delete($Stage)}
}
function Save-CommonCaptionPackage([string]$Directory,$Package){
 [void](Read-CommonCaptionPackage $Package -RequirePackageVersion)
 $Path=Assert-CommonSetupPath (Join-Path $Directory 'caption-installer.json') $Directory
 $Temporary=Assert-CommonSetupPath ($Path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp') $Directory
 $Created=$false
 try{
  $Bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Package|ConvertTo-Json -Compress -Depth 5))
  if($Bytes.Length -gt 2097152){throw 'invalid_setup_payload'}
  $Stream=[IO.File]::Open($Temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);$Created=$true
  try{$Stream.Write($Bytes,0,$Bytes.Length);$Stream.Flush($true)}finally{$Stream.Dispose()}
  [void](Assert-CommonSetupPath $Path $Directory);[void](Assert-CommonSetupPath $Temporary $Directory)
  # PowerShell coerces bare $null to an empty string for .NET string arguments.
  # File.Replace needs a genuine null when no backup path is requested.
  if([IO.File]::Exists($Path)){[IO.File]::Replace($Temporary,$Path,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($Temporary,$Path)}
 }catch{
  if($_.Exception.Message -in @('invalid_setup_payload','unsafe_setup_path')){throw}
  throw [InvalidOperationException]::new('caption_package_write_failed',$_.Exception)
 }finally{if($Created -and [IO.File]::Exists($Temporary)){[void](Assert-CommonSetupPath $Temporary $Directory);[IO.File]::Delete($Temporary)}}
}
function Start-CommonCaptionSetup([string]$Directory,[string]$Origin,$Package){
 $HasPackage=$PSBoundParameters.ContainsKey('Package')
 $Directory=Assert-CommonSetupPath $Directory $Directory
 $Mutex=New-Object Threading.Mutex($false,('Local\MDownloaderCaptionSetup-'+[Security.Principal.WindowsIdentity]::GetCurrent().User.Value));$Locked=$false
 try{
  try{$Locked=$Mutex.WaitOne(1000)}catch [Threading.AbandonedMutexException]{$Locked=$true};if(-not $Locked){throw 'common_setup_busy'}
  $StatePath=Assert-CommonSetupPath (Join-Path $Directory 'caption-setup-state.json') $Directory
  if([IO.File]::Exists($StatePath)){
   $Previous=Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8|ConvertFrom-Json
   # A transferred package cannot replace sources while any worker owns them.
   if($HasPackage -and (Test-CommonSetupBusy $Directory)){throw 'common_setup_busy'}
   # Work owned by another extension must not be exposed or overwritten.
   if($Previous.origin -cne $Origin -and (Test-CommonSetupBusy $Directory)){throw 'common_setup_busy'}
   if($Previous.origin -ceq $Origin){$Current=Get-CommonSetupState $Directory $Origin '';if($Current.status -in @('queued','installing')){return $Current}}
  }
  foreach($Name in @('common-setup.ps1','caption-installer.json','caption-setup.stdout.log','caption-setup.stderr.log')){[void](Assert-CommonSetupPath (Join-Path $Directory $Name) $Directory)}
  if($HasPackage){Save-CommonCaptionPackage $Directory $Package}
  if(-not [IO.File]::Exists((Join-Path $Directory 'caption-installer.json'))){throw 'common_helper_update_required'}
  $NewJob=[Guid]::NewGuid().ToString('N')
  Write-CommonSetupState $Directory @{jobId=$NewJob;origin=$Origin;status='queued';error='';started=[DateTime]::UtcNow.ToString('o');processId=0}
  $PowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $Arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $Directory 'common-setup.ps1')+'" -Worker -JobId '+$NewJob+' -SetupOrigin "'+$Origin+'"'
  $Process=Start-Process -FilePath $PowerShell -ArgumentList $Arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Directory 'caption-setup.stdout.log') -RedirectStandardError (Join-Path $Directory 'caption-setup.stderr.log')
  $Process.Dispose()
  return @{ok=$true;jobId=$NewJob;status='queued'}
 }finally{if($Locked){$Mutex.ReleaseMutex()};$Mutex.Dispose()}
}
function Invoke-CommonCaptionWorker([string]$Directory,[string]$WorkerJob,[string]$Origin,[bool]$SkipRegistration,[string]$Destination){
 if($WorkerJob -cnotmatch '^[a-f0-9]{32}$' -or $Origin -cnotmatch '^chrome-extension://([a-p]{32})/$'){throw 'invalid_setup_job'}
 $ExtensionId=$Matches[1];$Directory=Assert-CommonSetupPath $Directory $Directory
 $Manifest=Get-Content -LiteralPath (Join-Path $Directory 'host-manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
 if($Manifest.allowed_origins -cnotcontains $Origin){throw 'origin_denied'}
 $StatePath=Join-Path $Directory 'caption-setup-state.json';$State=Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8|ConvertFrom-Json
 if($State.jobId -cne $WorkerJob -or $State.origin -cne $Origin -or $State.status -ne 'queued'){throw 'invalid_setup_job'}
 $Stage=Assert-CommonSetupPath (Join-Path $Directory ('caption-setup-'+$WorkerJob)) $Directory
 $State|Add-Member NoteProperty processStarted ((Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')) -Force
 $State.status='installing';$State.processId=$PID;Write-CommonSetupState $Directory $State -Owned -ExpectedStatus 'queued'
 $Files=@{};$StageOwned=$false
 try{
  # A Windows job kills every bootstrap descendant if this worker crashes or is terminated.
  # Keep its native handle open for the lifetime of this process; the kernel closes it on exit.
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MDownloaderSetupProcessJob {
 [StructLayout(LayoutKind.Sequential)] struct Basic {public long A,B;public uint Flags;public UIntPtr C,D;public uint E;public UIntPtr F;public uint G,H;}
 [StructLayout(LayoutKind.Sequential)] struct IO {public ulong A,B,C,D,E,F;}
 [StructLayout(LayoutKind.Sequential)] struct Limits {public Basic Basic;public IO IO;public UIntPtr A,B,C,D;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr Security,string Name);
 [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr Job,int Type,IntPtr Data,uint Size);
 [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr Job,IntPtr Process);
 [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
 static IntPtr Job;
 public static void Enable(){
  Job=CreateJobObject(IntPtr.Zero,null);if(Job==IntPtr.Zero)throw new Exception("setup_job_failed");
  var L=new Limits();L.Basic.Flags=0x2000;int Size=Marshal.SizeOf(L);IntPtr P=Marshal.AllocHGlobal(Size);
  try{Marshal.StructureToPtr(L,P,false);if(!SetInformationJobObject(Job,9,P,(uint)Size)||!AssignProcessToJobObject(Job,GetCurrentProcess()))throw new Exception("setup_job_failed");}
  finally{Marshal.FreeHGlobal(P);}
 }
}
'@
  [MDownloaderSetupProcessJob]::Enable()
  $BundlePath=Assert-CommonSetupPath (Join-Path $Directory 'caption-installer.json') $Directory
  if(([IO.FileInfo]$BundlePath).Length -gt 2097152){throw 'invalid_setup_payload'}
  $Bundle=Get-Content -LiteralPath $BundlePath -Raw -Encoding UTF8|ConvertFrom-Json
  $Files=Read-CommonCaptionPackage $Bundle
  [void](Assert-CommonSetupPath $Stage $Directory);if(Test-Path -LiteralPath $Stage){throw 'unsafe_setup_path'}
  $StageOwned=$true;Expand-CommonCaptionPackage $Stage $Directory $Files
  $Options=@{ExtensionId=$ExtensionId};if($SkipRegistration){$Options.NoRegister=$true};if($Destination){$Options.Destination=$Destination}
  & (Join-Path $Stage 'bootstrap.ps1') @Options
  $State.status='complete';$State.error=''
 }catch{$State.status='failed';$State.error=if($_.Exception.Message -eq 'invalid_setup_payload'){'invalid_setup_payload'}else{'caption_install_failed'}}
 finally{
  try{Write-CommonSetupState $Directory $State -Owned -ExpectedStatus 'installing'}finally{
   if($StageOwned){Remove-CommonCaptionPackage $Stage $Directory $Files}
  }
 }
 if($State.status -ne 'complete'){throw $State.error}
}
if($Worker){Invoke-CommonCaptionWorker $Root $JobId $SetupOrigin ([bool]$NoRegister) $CaptionDestination}
