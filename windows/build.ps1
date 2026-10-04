param([ValidateSet('x64','arm64')][string]$Architecture='x64',[switch]$Package,[string]$CertificateThumbprint='')
$ErrorActionPreference='Stop'
$taskRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDotnet=Join-Path $taskRoot '.tools\dotnet\dotnet.exe'
if(!(Test-Path -LiteralPath $taskDotnet)){ $taskDotnet=(Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_CLI_TELEMETRY_OPTOUT='1'
$taskOutput=Join-Path $PSScriptRoot "artifacts\$Architecture\app"
$taskPlatform=if($Architecture -eq 'arm64'){'ARM64'}else{'x64'}
& $taskDotnet publish (Join-Path $PSScriptRoot 'Nabat.Windows\Nabat.Windows.csproj') -c Release -p:Platform=$taskPlatform -p:PlatformTarget=$taskPlatform -p:RuntimeIdentifier="win-$Architecture" -o $taskOutput
if($LASTEXITCODE -ne 0){throw 'Native publish failed.'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PREVIEW.md') -Destination $taskOutput
if($Package){
  $taskSdk=Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory | Where-Object {Test-Path (Join-Path $_.FullName 'x64\makeappx.exe')} | Sort-Object Name -Descending | Select-Object -First 1
  if(!$taskSdk){throw 'MSIX packaging requires the Windows SDK makeappx tool.'}
  $taskAssets=Join-Path $taskOutput 'Assets';New-Item -ItemType Directory -Path $taskAssets -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $taskRoot 'public\icons\icon-192.png') -Destination (Join-Path $taskAssets 'Logo.png')
  $taskManifest=[System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Package.appxmanifest')).Replace('ARCHITECTURE',$Architecture)
  if($CertificateThumbprint){$taskCert=Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint";$taskManifest=$taskManifest.Replace('CN=NABAT',[System.Security.SecurityElement]::Escape($taskCert.Subject))}
  [System.IO.File]::WriteAllText((Join-Path $taskOutput 'AppxManifest.xml'),$taskManifest)
  $taskPackage=Join-Path $PSScriptRoot "artifacts\NABAT-1.1.0-$Architecture-unsigned.msix"
  & (Join-Path $taskSdk.FullName 'x64\makeappx.exe') pack /d $taskOutput /p $taskPackage /o
  if($LASTEXITCODE -ne 0){throw 'MSIX creation failed.'}
  if($CertificateThumbprint){& (Join-Path $taskSdk.FullName 'x64\signtool.exe') sign /sha1 $CertificateThumbprint /fd SHA256 /td SHA256 /tr 'http://timestamp.digicert.com' $taskPackage;if($LASTEXITCODE -ne 0){throw 'Signing failed.'};Move-Item -LiteralPath $taskPackage -Destination $taskPackage.Replace('-unsigned','-signed') -Force}
}
Write-Output "NABAT native release: $taskOutput"

$taskZip=Join-Path $PSScriptRoot "artifacts\NABAT-1.1.0-$Architecture-portable.zip"
Compress-Archive -Path (Join-Path $taskOutput '*') -DestinationPath $taskZip -Force -CompressionLevel Optimal
$taskFiles=Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'artifacts') -File | Where-Object {$_.Name -match "^NABAT-1.1.0-$Architecture-(portable\.zip|unsigned\.msix|signed\.msix)$"} | ForEach-Object { @{file=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} }
$taskRelease=@{version='1.1.0';channel='pilot';architecture=$Architecture;contract='operations/1.1';signed=[bool]$CertificateThumbprint;runtimeVerified=$false;hardwareVerified=$false;files=@($taskFiles)}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "artifacts\release-$Architecture.json"),($taskRelease | ConvertTo-Json -Depth 5))
