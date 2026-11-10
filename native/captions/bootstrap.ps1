param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
      [string]$Destination=(Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MDownloader\Captions'),
      [switch]$NoRegister)
$ErrorActionPreference='Stop'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$Root=[IO.Path]::GetFullPath($Destination).TrimEnd('\','/')
[void][IO.Directory]::CreateDirectory($Root)
# Same OS byte-range lock as engine.PackageLease. Hold it before changing uv,
# venv dependencies, source copies, verification or registration.
$PackageLock=[IO.File]::Open((Join-Path $Root '.package.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
try {$PackageLock.Lock(0,1)} catch {$PackageLock.Dispose();throw 'caption_busy'}
$PackageToken=[Guid]::NewGuid().ToString('N')
$PreviousPackageRoot=$env:MDOWNLOADER_CAPTION_PACKAGE_ROOT
$PreviousPackageToken=$env:MDOWNLOADER_CAPTION_PACKAGE_TOKEN
$env:MDOWNLOADER_CAPTION_PACKAGE_ROOT=$Root
$env:MDOWNLOADER_CAPTION_PACKAGE_TOKEN=$PackageToken
[IO.File]::WriteAllText((Join-Path $Root '.package-owner'),$PackageToken,(New-Object Text.UTF8Encoding($false)))
$Log=Join-Path $Root 'setup.log'
Start-Transcript -LiteralPath $Log -Force | Out-Null
try {
 $Config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bootstrap.json') -Raw | ConvertFrom-Json
 # Both engines have x64 wheels. Windows ARM uses x64 emulation.
 $Asset=$Config.uv.'win-x64'
 $Archive=Join-Path $Root 'uv.zip'
 $Curl=Join-Path $env:SystemRoot 'System32\curl.exe'
 if(Test-Path -LiteralPath $Curl){
  & $Curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 120 --output $Archive $Asset.url
  if($LASTEXITCODE -ne 0){throw 'Runtime download failed'}
 }else{
  $ProgressPreference='SilentlyContinue'
  Invoke-WebRequest -UseBasicParsing -Uri $Asset.url -OutFile $Archive -TimeoutSec 120
 }
 if((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Asset.sha256){throw 'Runtime download checksum mismatch'}
 $Tools=Join-Path $Root 'tools';Expand-Archive -LiteralPath $Archive -DestinationPath $Tools -Force
 $Uv=Join-Path $Tools 'uv.exe'
 $env:UV_PYTHON_INSTALL_DIR=Join-Path $Root 'runtime'
 $env:UV_PYTHON_BIN_DIR=Join-Path $Root 'bin'
 $env:UV_CACHE_DIR=Join-Path $Root 'cache'
 $env:UV_PYTHON_INSTALL_REGISTRY='0'
 $env:UV_NO_CONFIG='1'
 $Venv=Join-Path $Root 'venv'
 if(-not (Test-Path -LiteralPath (Join-Path $Venv 'Scripts\python.exe'))){
  & $Uv venv --python ($Config.python+'-windows-x86_64-none') --managed-python --no-project $Venv
  if($LASTEXITCODE -ne 0){throw 'Private runtime preparation failed'}
 }
 $Python=Join-Path $Venv 'Scripts\python.exe'
 & $Uv pip install --python $Python --only-binary :all: -r (Join-Path $PSScriptRoot 'requirements.txt')
 if($LASTEXITCODE -ne 0){throw 'Speech engine installation failed'}
 & $Python (Join-Path $PSScriptRoot 'install.py') --extension-id $ExtensionId --destination $Root --skip-dependencies --no-register
 if($LASTEXITCODE -ne 0){throw 'Helper preparation failed'}
 & $Python (Join-Path $Root 'verify_install.py') $Root
 if($LASTEXITCODE -ne 0){throw 'Helper verification failed'}
 if(-not $NoRegister){
  & $Python (Join-Path $PSScriptRoot 'install.py') --extension-id $ExtensionId --destination $Root --skip-dependencies
  if($LASTEXITCODE -ne 0){throw 'Browser registration failed'}
 }
 Write-Host 'MDownloader caption helper is ready. Models are downloaded separately in Options.'
} finally {
 try {Stop-Transcript | Out-Null} finally {
  $env:MDOWNLOADER_CAPTION_PACKAGE_ROOT=$PreviousPackageRoot
  $env:MDOWNLOADER_CAPTION_PACKAGE_TOKEN=$PreviousPackageToken
  Remove-Item -LiteralPath (Join-Path $Root '.package-owner') -Force -ErrorAction SilentlyContinue
  $PackageLock.Dispose()
 }
}
