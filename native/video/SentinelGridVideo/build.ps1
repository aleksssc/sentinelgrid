[CmdletBinding()]
param([string]$OutputDirectory)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '..\..\..\dist\native\video' }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio Installer (vswhere.exe) is required.' }
$installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Visual Studio 2022 C++ x64 build tools are required.' }
$devCmd = Join-Path $installation 'Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $devCmd)) { throw 'VsDevCmd.bat was not found in the selected Visual Studio installation.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$source = Join-Path $PSScriptRoot 'SentinelGridVideo.cpp'
$output = Join-Path $OutputDirectory 'SentinelGridVideo.dll'
$object = Join-Path $OutputDirectory 'SentinelGridVideo.obj'
$importLibrary = Join-Path $OutputDirectory 'SentinelGridVideo.lib'
$command = 'call "{0}" -arch=amd64 -host_arch=amd64 >nul && cl.exe /nologo /std:c++17 /EHsc /LD /O2 /DWIN32_LEAN_AND_MEAN /Fo:"{2}" "{1}" /link /OUT:"{3}" /IMPLIB:"{4}" d3d11.lib dxgi.lib' -f $devCmd, $source, $object, $output, $importLibrary
cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw "Native x64 DLL build failed (exit $LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath $output)) { throw 'Native build did not produce SentinelGridVideo.dll.' }
Write-Host "SentinelGridVideo.dll built: $output"
Write-Host 'BUILD_TARGET x64'
