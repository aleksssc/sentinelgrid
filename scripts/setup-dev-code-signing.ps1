[CmdletBinding()]
param(
    [switch]$SetUserEnvironment,
    [ValidateSet('LocalMachine', 'CurrentUser')][string]$CertificateStore = 'LocalMachine'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')
if ($env:OS -ne 'Windows_NT') { throw 'Development certificate setup requires Windows.' }
if ($CertificateStore -eq 'LocalMachine') {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'LocalMachine development trust requires elevation. CurrentUser signing can build artifacts but does not establish SYSTEM/test-machine trust.'
    }
}

$certificates = @(Get-ChildItem "Cert:\$CertificateStore\My" | Where-Object { $_.Subject -eq $SentinelGridDevelopmentSubject })
if ($certificates.Count -gt 1) { throw 'Multiple SentinelGrid development certificates exist. Resolve duplicates explicitly; no certificate was changed.' }
if ($certificates.Count -eq 1) {
    $certificate = $certificates[0]
    Assert-CodeSigningCertificate $certificate $true
} else {
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject $SentinelGridDevelopmentSubject `
        -FriendlyName 'SentinelGrid DEVELOPMENT ONLY - disposable test machines' `
        -CertStoreLocation "Cert:\$CertificateStore\My" -KeyAlgorithm RSA -KeyLength 3072 `
        -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -Provider 'Microsoft Software Key Storage Provider' `
        -NotAfter (Get-Date).AddMonths(6)
    Assert-CodeSigningCertificate $certificate $true
}
$key = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
try {
    if ($key -isnot [Security.Cryptography.RSACng] -or $key.Key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None) {
        throw 'Development private key must be a non-exportable CNG key. Existing certificate was not replaced.'
    }
    $null = $key.SignData([Text.Encoding]::UTF8.GetBytes('SentinelGrid development signing accessibility check'),
        [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
} finally { if ($null -ne $key) { $key.Dispose() } }

# Trust only public bytes, in the explicitly selected scope.
$publicCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate.RawData)
try {
    foreach ($name in @('Root', 'TrustedPublisher')) {
        $store = [Security.Cryptography.X509Certificates.X509Store]::new($name, $CertificateStore)
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
    SENTINELGRID_DEV_SIGN_CERT_STORE = $CertificateStore
}
foreach ($entry in $values.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    if ($SetUserEnvironment) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'User') }
}
Write-Host "DEVELOPMENT ONLY: public certificate trusted in $CertificateStore; production settings unchanged."
Write-Host "Certificate thumbprint: $($certificate.Thumbprint)"
Write-Host "Signer SHA256: $fingerprint"
Write-Host "Certificate store: Cert:\$CertificateStore\My\$($certificate.Thumbprint)"
Write-Host "Expires: $($certificate.NotAfter.ToString('o'))"
Write-Host 'Private key is non-exportable and remains in the Windows certificate store.'
if ($CertificateStore -eq 'CurrentUser') { Write-Host 'SYSTEM services and other machines do NOT inherit this trust. Installed readiness remains unqualified.' }
Write-Host 'No update was enabled or performed. Do not distribute this certificate to production machines.'
