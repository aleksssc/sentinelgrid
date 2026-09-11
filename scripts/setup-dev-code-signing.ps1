#Requires -RunAsAdministrator
[CmdletBinding()]
param([switch]$SetUserEnvironment)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')
if ($env:OS -ne 'Windows_NT') { throw 'Development certificate setup requires Windows.' }

$certificates = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -eq $SentinelGridDevelopmentSubject })
if ($certificates.Count -gt 1) { throw 'Multiple SentinelGrid development certificates exist. Resolve duplicates explicitly; no certificate was changed.' }
if ($certificates.Count -eq 1) {
    $certificate = $certificates[0]
    Assert-CodeSigningCertificate $certificate $true
} else {
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject $SentinelGridDevelopmentSubject `
        -FriendlyName 'SentinelGrid DEVELOPMENT ONLY - disposable test machines' `
        -CertStoreLocation Cert:\LocalMachine\My -KeyAlgorithm RSA -KeyLength 3072 `
        -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -Provider 'Microsoft Software Key Storage Provider' `
        -NotAfter (Get-Date).AddMonths(6)
    Assert-CodeSigningCertificate $certificate $true
}
$key = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
try {
    if ($key -isnot [Security.Cryptography.RSACng] -or $key.Key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None) {
        throw 'Development private key must be a non-exportable CNG key. Existing certificate was not replaced.'
    }
} finally { if ($null -ne $key) { $key.Dispose() } }

# Only public certificate bytes are added to the local machine trust stores.
$publicCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate.RawData)
try {
    foreach ($name in @('Root', 'TrustedPublisher')) {
        $store = [Security.Cryptography.X509Certificates.X509Store]::new($name, 'LocalMachine')
        try {
            $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            if ($store.Certificates.Find('FindByThumbprint', $certificate.Thumbprint, $false).Count -eq 0) { $store.Add($publicCertificate) }
        } finally { $store.Close() }
    }
} finally { $publicCertificate.Dispose() }

$fingerprint = Get-SignerSHA256 $certificate
$values = @{
    SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT = $certificate.Thumbprint
    SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 = $fingerprint
}
foreach ($entry in $values.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    if ($SetUserEnvironment) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'User') }
}
Write-Host 'DEVELOPMENT ONLY: public certificate trusted on this machine; production settings unchanged.'
Write-Host "Certificate thumbprint: $($certificate.Thumbprint)"
Write-Host "Signer SHA256: $fingerprint"
Write-Host "Certificate store: Cert:\LocalMachine\My\$($certificate.Thumbprint)"
Write-Host "Expires: $($certificate.NotAfter.ToString('o'))"
Write-Host 'Private key is non-exportable and remains in the local Windows certificate store.'
Write-Host 'No update was enabled or performed. Do not distribute this certificate to production machines.'
