Set-StrictMode -Version Latest

$SentinelGridDevelopmentSubject = 'CN=SentinelGrid DEVELOPMENT ONLY Code Signing'
$SentinelGridProductionSubject = 'CN=SentinelGrid Code Signing'

function Get-SignerSHA256(
    [Security.Cryptography.X509Certificates.X509Certificate2]$Certificate
) {
    $sha = [Security.Cryptography.SHA256]::Create()

    try {
        return (
            [BitConverter]::ToString(
                $sha.ComputeHash(
                    $Certificate.RawData
                )
            )
        ).Replace('-', '')
    }
    finally {
        $sha.Dispose()
    }
}

function Assert-CodeSigningIdentity(
    [Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
    [bool]$Development
) {
    $usage = @(
        $Certificate.Extensions |
        Where-Object {
            $_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]
        } |
        ForEach-Object {
            $_.EnhancedKeyUsages
        } |
        Where-Object {
            $_.Value -eq '1.3.6.1.5.5.7.3.3'
        }
    )

    if ($usage.Count -eq 0) {
        throw 'Selected certificate does not have the Code Signing EKU.'
    }

    if ($Development) {
        if (
            $Certificate.Subject -ne $SentinelGridDevelopmentSubject -or
            $Certificate.Issuer -ne $Certificate.Subject
        ) {
            throw 'Development signing requires the explicit SentinelGrid DEVELOPMENT ONLY self-signed certificate.'
        }
    }
    elseif (
        $Certificate.Subject -match 'SentinelGrid.*DEVELOPMENT ONLY'
    ) {
        throw 'A SentinelGrid DEVELOPMENT ONLY certificate cannot sign a production build.'
    }
}

function Assert-CodeSigningCertificate(
    [Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
    [bool]$Development
) {
    if (
        -not $Certificate.HasPrivateKey -or
        $Certificate.NotBefore -gt (Get-Date) -or
        $Certificate.NotAfter -le (Get-Date)
    ) {
        throw 'Selected certificate must have an accessible private key and be currently valid.'
    }

    Assert-CodeSigningIdentity `
        $Certificate `
        $Development
}

function Resolve-ReleaseSigning {
    param(
        [Parameter(Mandatory)]
        [ValidateSet('dev', 'beta', 'stable')]
        [string]$Channel,

        [string]$PublishedSigner
    )

    $development =
        $Channel -ne 'stable'

    $prefix =
        if ($development) {
            'SENTINELGRID_DEV_'
        }
        else {
            'SENTINELGRID_'
        }

    $thumbprint =
        [Environment]::GetEnvironmentVariable(
            "${prefix}SIGN_CERT_THUMBPRINT",
            'Process'
        )

    $pins =
        [Environment]::GetEnvironmentVariable(
            "${prefix}UPDATE_SIGNER_SHA256",
            'Process'
        )

    $store =
        [Environment]::GetEnvironmentVariable(
            "${prefix}SIGN_CERT_STORE",
            'Process'
        )

    $timestamp =
        [Environment]::GetEnvironmentVariable(
            "${prefix}SIGN_TIMESTAMP_URL",
            'Process'
        )

    $profile =
        if ($development) {
            'Beta'
        }
        else {
            'Production'
        }

    $notConfigured =
        "$profile signer not configured.`nRun:`n.\scripts\setup-signing.ps1 -Profile $profile"

    $certificate = $null

    # =========================================================
    # BETA SIGNER DISCOVERY
    # =========================================================

    if ($Channel -eq 'beta') {

        # Preserve the published beta pin and discover its
        # private certificate, as release-beta did.
        if ($PublishedSigner) {

            if (
                $PublishedSigner -notmatch
                '^[A-Fa-f0-9]{64}$'
            ) {
                throw 'Invalid published beta signer SHA256.'
            }

            if (
                $pins -and
                $pins -ine $PublishedSigner
            ) {
                Write-Warning `
                    'Ignoring stale SENTINELGRID_DEV_UPDATE_SIGNER_SHA256. The existing published beta signer is authoritative.'
            }

            $pins = $PublishedSigner
        }

        if (
            $pins -notmatch
            '^[A-Fa-f0-9]{64}$'
        ) {
            throw 'Could not determine the trusted beta signer. Restore the published beta signer metadata or SENTINELGRID_DEV_UPDATE_SIGNER_SHA256; no certificate was created.'
        }

        foreach (
            $candidateStore in @(
                'CurrentUser',
                'LocalMachine'
            )
        ) {

            foreach (
                $candidate in @(
                    Get-ChildItem `
                        -LiteralPath "Cert:\$candidateStore\My" `
                        -ErrorAction Stop
                )
            ) {

                if (
                    $candidate.HasPrivateKey -and
                    (
                        Get-SignerSHA256 $candidate
                    ) -ieq $pins
                ) {
                    $certificate =
                        $candidate

                    $store =
                        $candidateStore

                    break
                }
            }

            if ($certificate) {
                break
            }
        }

        if (-not $certificate) {
            throw 'Trusted beta signing certificate was not found with a private key in Cert:\CurrentUser\My or Cert:\LocalMachine\My. Restore the existing certificate; do not rotate the beta signer.'
        }

        if (
            $thumbprint -and
            $thumbprint -ine
                $certificate.Thumbprint
        ) {
            Write-Warning `
                'Ignoring stale SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT. Using the existing certificate matching the trusted beta SHA256 pin.'
        }

        $thumbprint =
            $certificate.Thumbprint
    }

    # =========================================================
    # BASIC PROFILE VALIDATION
    # =========================================================

    if (
        $thumbprint -notmatch
            '^[A-Fa-f0-9]{40}$' -or
        $pins -notmatch
            '^[A-Fa-f0-9]{64}(,[A-Fa-f0-9]{64})*$'
    ) {
        throw $notConfigured
    }

    if (
        $development -and
        $pins -notmatch
            '^[A-Fa-f0-9]{64}$'
    ) {
        throw 'Development signing requires a single explicit signer pin.'
    }

    if (-not $store) {
        $store =
            if ($development) {
                'LocalMachine'
            }
            else {
                'CurrentUser'
            }
    }

    if (
        $store -notin @(
            'CurrentUser',
            'LocalMachine'
        )
    ) {
        throw 'Invalid signing certificate store.'
    }

    # =========================================================
    # CERTIFICATE
    # =========================================================

    if (-not $certificate) {

        $path =
            "Cert:\$store\My\$thumbprint"

        if (
            -not (
                Test-Path `
                    -LiteralPath $path
            )
        ) {
            throw $notConfigured
        }

        $certificate =
            Get-Item `
                -LiteralPath $path
    }

    Assert-CodeSigningCertificate `
        $certificate `
        $development

    $fingerprint =
        Get-SignerSHA256 `
            $certificate

    if (
        $pins.
            ToUpperInvariant().
            Split(',') -notcontains
        $fingerprint
    ) {
        throw 'Selected certificate does not match the explicit embedded signer pin. No signer rotation is performed automatically.'
    }

    # =========================================================
    # PROD / DEV SEPARATION
    # =========================================================

    if (-not $development) {

        $devThumbprint =
            $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT

        $devPin =
            $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256

        if (
            $thumbprint -ieq
                $devThumbprint -or
            (
                $devPin -and
                $pins.
                    ToUpperInvariant().
                    Split(',') -contains
                $devPin.ToUpperInvariant()
            )
        ) {
            throw 'Production signer and pin allowlist must be separate from the development signer.'
        }
    }

    # =========================================================
    # RFC3161 TIMESTAMP
    # =========================================================

    if (
        -not $development -and
        -not $timestamp
    ) {
        throw 'Configure SENTINELGRID_SIGN_TIMESTAMP_URL with an HTTP or HTTPS RFC3161 timestamp URL.'
    }

    if ($timestamp) {

        $url = [uri]$timestamp

        if (
            -not $url.IsAbsoluteUri -or
            $url.Scheme -notin @(
                'http',
                'https'
            ) -or
            $url.UserInfo -or
            $url.Fragment
        ) {
            throw 'Signing timestamp URL must use HTTP or HTTPS without credentials or fragments.'
        }
    }

    # =========================================================
    # RESULT
    # =========================================================

    return [pscustomobject]@{
        Development  = $development
        Certificate  = $certificate
        Thumbprint   = $thumbprint
        Store        = $store
        Pins         = $pins.ToUpperInvariant()
        Fingerprint  = $fingerprint
        TimestampUrl = $timestamp
    }
}

function Find-SignTool {

    $tool =
        Get-Command `
            signtool.exe `
            -CommandType Application `
            -ErrorAction SilentlyContinue |
        Select-Object -First 1

    $path = $null

    if ($tool) {
        $path = $tool.Source
    }
    else {

        $searchBases = @(
            (
                Join-Path `
                    (
                        Split-Path `
                            -Parent $PSScriptRoot
                    ) `
                    'dist\tools\signing\Windows Kits\10\bin'
            ),
            (
                Join-Path `
                    (
                        [Environment]::GetFolderPath(
                            'ProgramFilesX86'
                        )
                    ) `
                    'Windows Kits\10\bin'
            ),
            (
                Join-Path `
                    (
                        [Environment]::GetFolderPath(
                            'ProgramFiles'
                        )
                    ) `
                    'Windows Kits\10\bin'
            ),
            (
                Join-Path `
                    (
                        [Environment]::GetFolderPath(
                            'ProgramFilesX86'
                        )
                    ) `
                    'Windows Kits\8.1\bin'
            ),
            (
                Join-Path `
                    (
                        [Environment]::GetFolderPath(
                            'ProgramFiles'
                        )
                    ) `
                    'Windows Kits\8.1\bin'
            ),
            (
                Join-Path `
                    (
                        [Environment]::GetFolderPath(
                            'ProgramFilesX86'
                        )
                    ) `
                    'Microsoft SDKs\Windows'
            ),
            (
                Join-Path `
                    (
                        [Environment]::GetFolderPath(
                            'ProgramFiles'
                        )
                    ) `
                    'Microsoft SDKs\Windows'
            )
        )

        foreach (
            $base in $searchBases
        ) {

            if (
                Test-Path `
                    -LiteralPath $base
            ) {

                $versions = @(
                    Get-ChildItem `
                        -LiteralPath $base `
                        -Directory `
                        -ErrorAction SilentlyContinue |
                    Where-Object {
                        $_.Name -match
                            '^\d+(\.\d+)*$' -and
                        -not (
                            $_.Attributes -band
                            [IO.FileAttributes]::ReparsePoint
                        )
                    } |
                    Sort-Object {
                        [version]$_.Name
                    } `
                        -Descending
                )

                foreach (
                    $version in $versions
                ) {

                    $candidates = @(
                        (
                            Join-Path `
                                $version.FullName `
                                'x64\signtool.exe'
                        ),
                        (
                            Join-Path `
                                $version.FullName `
                                'x86\signtool.exe'
                        ),
                        (
                            Join-Path `
                                $version.FullName `
                                'arm64\signtool.exe'
                        )
                    )

                    foreach (
                        $c in $candidates
                    ) {

                        if (
                            Test-Path `
                                -LiteralPath $c `
                                -PathType Leaf
                        ) {
                            $path = $c
                            break
                        }
                    }

                    if ($path) {
                        break
                    }
                }

                if ($path) {
                    break
                }

                $candidates = @(
                    (
                        Join-Path `
                            $base `
                            'x64\signtool.exe'
                    ),
                    (
                        Join-Path `
                            $base `
                            'x86\signtool.exe'
                    ),
                    (
                        Join-Path `
                            $base `
                            'signtool.exe'
                    )
                )

                foreach (
                    $c in $candidates
                ) {

                    if (
                        Test-Path `
                            -LiteralPath $c `
                            -PathType Leaf
                    ) {
                        $path = $c
                        break
                    }
                }

                if ($path) {
                    break
                }
            }
        }
    }

    if (-not $path) {
        throw 'SignTool is missing. Install the Windows SDK Signing Tools or add the installed SDK tool to PATH. No tools are downloaded.'
    }

    $signature =
        Get-AuthenticodeSignature `
            -LiteralPath $path

    if (
        $signature.Status -ne 'Valid' -or
        $null -eq
            $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch
            '(^|,\s*)CN=Microsoft Corporation(,|$)'
    ) {
        throw 'Refusing to execute SignTool without a valid Microsoft Authenticode signature.'
    }

    return $path
}