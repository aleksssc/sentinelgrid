[CmdletBinding()]
param(
    [string]$OutputDirectory,
    [string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '..\..\..\dist\native\video' }
if (-not $Version) {
    $outputLeaf = Split-Path -Leaf (Resolve-Path -LiteralPath $OutputDirectory -ErrorAction SilentlyContinue)
    if ($outputLeaf -match '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        $Version = $outputLeaf
    } else {
        $Version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\..\agent\VERSION') -Raw).Trim()
    }
}
if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Version must be major.minor.patch.' }
$versionParts = $Version.Split('.')
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio Installer (vswhere.exe) is required.' }
$installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installation) { throw 'Visual Studio 2022 C++ x64 build tools are required.' }
$devCmd = Join-Path $installation 'Common7\Tools\VsDevCmd.bat'
if (-not (Test-Path -LiteralPath $devCmd)) { throw 'VsDevCmd.bat was not found in the selected Visual Studio installation.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$source = Join-Path $PSScriptRoot 'SentinelGridVideo.cpp'
$resourceSource = Join-Path $PSScriptRoot 'SentinelGridVideo.rc'
$output = Join-Path $OutputDirectory 'SentinelGridVideo.dll'
$object = Join-Path $OutputDirectory 'SentinelGridVideo.obj'
$resource = Join-Path $OutputDirectory 'SentinelGridVideo.res'
$importLibrary = Join-Path $OutputDirectory 'SentinelGridVideo.lib'
$command = 'call "{0}" -arch=amd64 -host_arch=amd64 >nul && rc.exe /nologo /dSG_VERSION_MAJOR={6} /dSG_VERSION_MINOR={7} /dSG_VERSION_PATCH={8} /fo "{4}" "{3}" && cl.exe /nologo /std:c++17 /EHsc /LD /O2 /DWIN32_LEAN_AND_MEAN /Fo"{2}" "{1}" "{4}" /link /OUT:"{5}" /IMPLIB:"{9}" d3d11.lib dxgi.lib' -f $devCmd, $source, $object, $resourceSource, $resource, $output, $versionParts[0], $versionParts[1], $versionParts[2], $importLibrary
cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw "Native x64 DLL build failed (exit $LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath $output)) { throw 'Native build did not produce SentinelGridVideo.dll.' }
$info = (Get-Item -LiteralPath $output).VersionInfo
if ([version]$info.FileVersion -ne [version]($Version + '.0') -or [version]$info.ProductVersion -ne [version]($Version + '.0')) { throw 'Native video DLL version resources do not match the requested version.' }
if ($info.ProductName -ne 'SentinelGrid Native Video' -or $info.FileDescription -ne 'SentinelGrid native video module' -or $info.OriginalFilename -ne 'SentinelGridVideo.dll') { throw 'Native video DLL identity resources are invalid.' }
Write-Host "SentinelGridVideo.dll built: $output"
Write-Host "VERSIONINFO $Version"
Write-Host 'BUILD_TARGET x64'
