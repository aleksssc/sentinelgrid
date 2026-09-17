[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Beta', 'Production')][string]$Profile,
    [ValidateSet('LocalMachine', 'CurrentUser')][string]$CertificateStore,
    [string]$CertificateThumbprint,
    [string]$TimestampUrl,
    [bool]$SetUserEnvironment = $true
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')
if ($env:OS -ne 'Windows_NT') { throw 'Certificate setup requires Windows.' }
$development = $Profile -eq 'Beta'
$prefix = if ($development) { 'SENTINELGRID_DEV_' } else { 'SENTINELGRID_' }
$subject = if ($development) { $SentinelGridDevelopmentSubject } else { $SentinelGridProductionSubject }
if (-not $CertificateThumbprint) { $CertificateThumbprint = [Environment]::GetEnvironmentVariable("${prefix}SIGN_CERT_THUMBPRINT", 'Process') }
if ($CertificateThumbprint -and $CertificateThumbprint -notmatch '^[A-Fa-f0-9]{40}\z') { throw 'Configured certificate thumbprint must be 40 hex characters.' }
if (-not $CertificateStore) { $CertificateStore = [Environment]::GetEnvironmentVariable("${prefix}SIGN_CERT_STORE", 'Process') }
if (-not $CertificateStore) {
    # Avoid creating another signer just because the existing certificate is in the other scope.
    $locations = @(
        foreach ($scope in @('CurrentUser', 'LocalMachine')) {
            foreach ($candidate in (Get-ChildItem -LiteralPath "Cert:\$scope\My")) {
                if (($CertificateThumbprint -and $candidate.Thumbprint -ieq $CertificateThumbprint) -or (-not $CertificateThumbprint -and $candidate.Subject -eq $subject)) {
                    [pscustomobject]@{ Store = $scope; Thumbprint = $candidate.Thumbprint }
                }
            }
        }
    )
    if ($locations.Count -gt 1) { throw 'Multiple matching certificate locations exist. Select -CertificateStore and -CertificateThumbprint explicitly; no certificate was changed.' }
    if ($locations.Count -eq 1) { $CertificateStore = $locations[0].Store; $CertificateThumbprint = $locations[0].Thumbprint }
    else { $CertificateStore = if ($development) { 'LocalMachine' } else { 'CurrentUser' } }
}
if ($CertificateStore -notin @('LocalMachine', 'CurrentUser')) { throw 'Invalid certificate store.' }
if ($CertificateStore -eq 'LocalMachine') {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'LocalMachine signing/trust setup requires an elevated PowerShell. CurrentUser does not establish SYSTEM trust.'
    }
}
if (-not $TimestampUrl) { $TimestampUrl = [Environment]::GetEnvironmentVariable("${prefix}SIGN_TIMESTAMP_URL", 'Process') }
if (-not $development -and -not $TimestampUrl) { $TimestampUrl = 'https://timestamp.digicert.com' }
if ($TimestampUrl) {
    $url = [uri]$TimestampUrl
    if (-not $url.IsAbsoluteUri -or $url.Scheme -ne 'https' -or $url.UserInfo -or $url.Fragment) { throw 'TimestampUrl must be an HTTPS RFC3161 URL without credentials or fragments.' }
}
if ($CertificateThumbprint) {
    if (-not (Test-Path -LiteralPath "Cert:\$CertificateStore\My\$CertificateThumbprint")) {
        throw 'Configured certificate was not found. Existing configuration was not replaced; select the intended certificate/store explicitly.'
    }
    $certificate = Get-Item -LiteralPath "Cert:\$CertificateStore\My\$CertificateThumbprint"
} else {
    $certificates = @(Get-ChildItem "Cert:\$CertificateStore\My" | Where-Object { $_.Subject -eq $subject })
    if ($certificates.Count -gt 1) { throw 'Multiple matching certificates exist. Select -CertificateThumbprint explicitly; no certificate was changed.' }
    if ($certificates.Count -eq 1) { $certificate = $certificates[0] }
    else {
        $existingPin = [Environment]::GetEnvironmentVariable("${prefix}UPDATE_SIGNER_SHA256", 'Process')
        if ($existingPin) { throw 'A signer pin is already configured but its certificate is missing. Restore that certificate; automatic rotation is forbidden.' }
        $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -FriendlyName "SentinelGrid $Profile Code Signing" `
            -CertStoreLocation "Cert:\$CertificateStore\My" -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
            -KeyExportPolicy NonExportable -Provider 'Microsoft Software Key Storage Provider' `
            -NotAfter $(if ($development) { (Get-Date).AddMonths(6) } else { (Get-Date).AddYears(1) })
    }
}
Assert-CodeSigningCertificate $certificate $development
$fingerprint = Get-SignerSHA256 $certificate
$configuredPins = [Environment]::GetEnvironmentVariable("${prefix}UPDATE_SIGNER_SHA256", 'Process')
if ($configuredPins -and ($configuredPins -notmatch '^[A-Fa-f0-9]{64}(,[A-Fa-f0-9]{64})*\z' -or $configuredPins.ToUpperInvariant().Split(',') -notcontains $fingerprint)) {
    throw 'Certificate differs from the configured signer pin. Existing trust was not changed; signer rotation requires an explicit migration.'
}
if ($development -and $configuredPins -and $configuredPins -notmatch '^[A-Fa-f0-9]{64}\z') { throw 'Development signing requires a single pin.' }
if (-not $development -and ($certificate.Thumbprint -ieq $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT -or $fingerprint -ieq $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 -or ($configuredPins -and $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 -and $configuredPins.ToUpperInvariant().Split(',') -contains $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256.ToUpperInvariant()))) {
    throw 'Production must not reuse the development certificate or its pin.'
}
$key = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
$publicKey = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($certificate)
try {
    if ($null -eq $key -or $null -eq $publicKey) { throw 'An accessible RSA code signing key is required.' }
    if ($development -and ($key -isnot [Security.Cryptography.RSACng] -or $key.Key.ExportPolicy -ne [Security.Cryptography.CngExportPolicies]::None)) {
        throw 'Development private key must be a non-exportable CNG key. Existing certificate was not replaced.'
    }
    $challenge = [Text.Encoding]::UTF8.GetBytes('SentinelGrid signing accessibility check')
    $signature = $key.SignData($challenge, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    if (-not $publicKey.VerifyData($challenge, $signature, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)) { throw 'Private key signing verification failed.' }
} finally {
    if ($null -ne $key) { $key.Dispose() }
    if ($null -ne $publicKey) { $publicKey.Dispose() }
}

# Only explicit setup establishes local trust, using public certificate bytes.
$publicCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificate.RawData)
try {
    $stores = @('TrustedPublisher')
    if ($certificate.Subject -eq $certificate.Issuer) { $stores += 'Root' }
    foreach ($name in $stores) {
        $store = [Security.Cryptography.X509Certificates.X509Store]::new($name, $CertificateStore)
        try {
            $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
            if ($store.Certificates.Find('FindByThumbprint', $certificate.Thumbprint, $false).Count -eq 0) { $store.Add($publicCertificate) }
        } finally { $store.Close() }
    }
} finally { $publicCertificate.Dispose() }
$values = @{}
$values["${prefix}SIGN_CERT_THUMBPRINT"] = $certificate.Thumbprint
$values["${prefix}UPDATE_SIGNER_SHA256"] = if ($configuredPins) { $configuredPins.ToUpperInvariant() } else { $fingerprint }
$values["${prefix}SIGN_CERT_STORE"] = $CertificateStore
if ($TimestampUrl) { $values["${prefix}SIGN_TIMESTAMP_URL"] = $TimestampUrl }
foreach ($entry in $values.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    if ($SetUserEnvironment) { [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'User') }
}
Write-Host "$Profile signer configured. Other signing profile unchanged. No release was built or published."
Write-Host "Certificate thumbprint: $($certificate.Thumbprint)"
Write-Host "Signer SHA256: $fingerprint"
Write-Host "Store: $CertificateStore; expires: $($certificate.NotAfter.ToString('o'))"
if ($certificate.Subject -eq $certificate.Issuer) { Write-Warning 'Self-signed certificate: only this selected local scope now trusts it. Target machines require independently verified public-certificate trust deployment; this is not publicly trusted CA signing.' }
Write-Host 'Private keys remain in the Windows certificate store. No repository or env file was written.'
Write-Host 'Existing terminals retain their old environment. Use this PowerShell session or open a new terminal. Installed update lifecycle qualification remains separate.'
