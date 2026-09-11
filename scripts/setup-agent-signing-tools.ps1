[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root 'dist\tools'
$destination = Join-Path $tools 'signing'
$toolPath = Join-Path $destination 'Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe'

function Invoke-Installer([string]$File, [string]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    try {
        if (-not $process.WaitForExit(120000)) {
            $process.Kill()
            throw 'SDK operation timed out; inspect dist\tools logs. No elevation or security dialog can be accepted by this script.'
        }
        if ($process.ExitCode -ne 0) { throw "SDK operation failed (exit $($process.ExitCode))." }
    } finally { $process.Dispose() }
}

if (-not (Test-Path -LiteralPath $toolPath)) {
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    $setup = Join-Path $tools 'winsdksetup.exe'
    $url = 'https://download.microsoft.com/download/3/b/d/3bd97f81-3f5b-4922-b86d-dc5145cd6bfe/windowssdk/winsdksetup.exe'
    $hash = '3F73F59566B0CF3EDDDDAF61AD72BB0C6E4588A5D9E004ABF68115B752EBBBD8'
    if (-not (Test-Path -LiteralPath $setup)) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $setup }
    if ((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -ne $hash) { throw 'SDK bootstrap SHA256 mismatch.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $setup
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') { throw 'SDK bootstrap Microsoft signature invalid.' }
    $layout = Join-Path $tools 'sdk-layout'
    Invoke-Installer $setup ('/layout "' + $layout + '" /features OptionId.SigningTools /quiet /norestart /ceip off')
    $packages = @(Get-ChildItem -LiteralPath $layout -Recurse -Filter 'Windows SDK Signing Tools-x86_en-us.msi' -File)
    if ($packages.Count -ne 1) { throw 'Expected exactly one SDK signing-tools package.' }
    $log = Join-Path $tools 'signing-extract.log'
    Invoke-Installer (Join-Path $env:SystemRoot 'System32\msiexec.exe') ('/a "' + $packages[0].FullName + '" /qn TARGETDIR="' + $destination + '" /l*v "' + $log + '"')
}
$signature = Get-AuthenticodeSignature -LiteralPath $toolPath
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') { throw 'Extracted SignTool Microsoft signature invalid.' }
$env:Path = (Split-Path -Parent $toolPath) + ';' + $env:Path
Write-Host "Official Windows SDK SignTool ready: $toolPath"
Write-Host 'Only SDK package files were extracted locally. No Windows SDK product, service, trust, or machine PATH was changed.'
