$ErrorActionPreference='Stop'
$taskRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskExe=Join-Path $PSScriptRoot 'artifacts\x64\app\Nabat.Windows.exe'
if(!(Test-Path -LiteralPath $taskExe)){& (Join-Path $PSScriptRoot 'build.ps1')}
try{$null=Invoke-WebRequest -Uri 'http://127.0.0.1:3001/login' -TimeoutSec 2}
catch{Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npx tsx scripts/dev-operations.ts' -WorkingDirectory $taskRoot -WindowStyle Hidden}
# The explicitly invoked launcher opens the requested interactive Windows application.
Start-Process -FilePath $taskExe -WindowStyle Normal
