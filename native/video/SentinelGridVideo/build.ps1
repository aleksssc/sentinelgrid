[CmdletBinding()]
param([string]$OutputDirectory, [string]$Version)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '..\..\..\dist\native\video' }
if (-not $Version) { $outputLeaf = Split-Path -Leaf $OutputDirectory; if ($outputLeaf -match '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { $Version = $outputLeaf } else { $Version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\..\agent\VERSION') -Raw).Trim() } }
if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Version must be major.minor.patch.' }
$versionParts = $Version.Split('.')
$roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'C:\Program Files', 'C:\Program Files (x86)') | Where-Object { $_ } | Select-Object -Unique
$vswhere = $roots | ForEach-Object { Join-Path $_ 'Microsoft Visual Studio\Installer\vswhere.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$installation = if ($vswhere) { & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath } else { $null }
$devCmd = if ($installation) { Join-Path $installation 'Common7\Tools\VsDevCmd.bat' } else { $null }
if (-not $devCmd -or -not (Test-Path -LiteralPath $devCmd)) { $devCmd = $roots | ForEach-Object { Get-ChildItem -LiteralPath (Join-Path $_ 'Microsoft Visual Studio\2022') -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'Common7\Tools\VsDevCmd.bat' } } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 }
if (-not $devCmd) { throw 'Visual Studio 2022 C++ x64 build tools (VsDevCmd.bat) are required.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$source = Join-Path $PSScriptRoot 'SentinelGridVideo.cpp'; $h264Source = Join-Path $PSScriptRoot 'SentinelGridH264.cpp'; $decoderSource = Join-Path $PSScriptRoot 'SentinelGridH264Decoder.cpp'; $resourceSource = Join-Path $PSScriptRoot 'SentinelGridVideo.rc'; $output = Join-Path $OutputDirectory 'SentinelGridVideo.dll'; $object = Join-Path $OutputDirectory 'SentinelGridVideo.obj'; $h264Object = Join-Path $OutputDirectory 'SentinelGridH264.obj'; $decoderObject = Join-Path $OutputDirectory 'SentinelGridH264Decoder.obj'; $resource = Join-Path $OutputDirectory 'SentinelGridVideo.res'; $importLibrary = Join-Path $OutputDirectory 'SentinelGridVideo.lib'
$command = 'call "{0}" -arch=amd64 -host_arch=amd64 >nul && rc.exe /nologo /dSG_VERSION_MAJOR={10} /dSG_VERSION_MINOR={11} /dSG_VERSION_PATCH={12} /fo "{6}" "{5}" && cl.exe /nologo /std:c++17 /EHsc /O2 /DWIN32_LEAN_AND_MEAN /c /Fo"{2}" "{1}" && cl.exe /nologo /std:c++17 /EHsc /O2 /DWIN32_LEAN_AND_MEAN /c /Fo"{3}" "{7}" && cl.exe /nologo /std:c++17 /EHsc /O2 /DWIN32_LEAN_AND_MEAN /c /Fo"{4}" "{8}" && link.exe /nologo /DLL /OUT:"{9}" /IMPLIB:"{13}" "{2}" "{3}" "{4}" "{6}" d3d11.lib d3dcompiler.lib dxgi.lib mfplat.lib mfuuid.lib ole32.lib oleaut32.lib user32.lib' -f $devCmd,$source,$object,$h264Object,$decoderObject,$resourceSource,$resource,$h264Source,$decoderSource,$output,$versionParts[0],$versionParts[1],$versionParts[2],$importLibrary
cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw "Native x64 DLL build failed (exit $LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath $output)) { throw 'Native build did not produce SentinelGridVideo.dll.' }
$info = (Get-Item -LiteralPath $output).VersionInfo
if ([version]$info.FileVersion -ne [version]($Version + '.0') -or [version]$info.ProductVersion -ne [version]($Version + '.0')) { throw 'Native video DLL version resources do not match the requested version.' }
if ($info.ProductName -ne 'SentinelGrid Native Video' -or $info.FileDescription -ne 'SentinelGrid native video module' -or $info.OriginalFilename -ne 'SentinelGridVideo.dll') { throw 'Native video DLL identity resources are invalid.' }
Write-Host "SentinelGridVideo.dll built: $output"; Write-Host "VERSIONINFO $Version"; Write-Host 'BUILD_TARGET x64'
