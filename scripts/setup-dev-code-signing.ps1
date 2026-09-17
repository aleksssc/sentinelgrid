[CmdletBinding()]
param(
    [switch]$SetUserEnvironment,
    [ValidateSet('LocalMachine', 'CurrentUser')][string]$CertificateStore = 'LocalMachine'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Write-Warning 'setup-dev-code-signing.ps1 is deprecated. Use .\scripts\setup-signing.ps1 -Profile Beta.'
& (Join-Path $PSScriptRoot 'setup-signing.ps1') -Profile Beta -CertificateStore $CertificateStore -SetUserEnvironment $SetUserEnvironment.IsPresent
