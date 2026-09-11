Set-StrictMode -Version Latest

$SentinelGridDevelopmentSubject = 'CN=SentinelGrid DEVELOPMENT ONLY Code Signing'

function Get-SignerSHA256([Security.Cryptography.X509Certificates.X509Certificate2]$Certificate) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Certificate.RawData))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Assert-CodeSigningCertificate([Security.Cryptography.X509Certificates.X509Certificate2]$Certificate, [bool]$Development) {
    if (-not $Certificate.HasPrivateKey -or $Certificate.NotBefore -gt (Get-Date) -or $Certificate.NotAfter -le (Get-Date)) {
        throw 'Selected certificate must have an accessible private key and be currently valid.'
    }
    $usage = @($Certificate.Extensions | Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension] } | ForEach-Object { $_.EnhancedKeyUsages } | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' })
    if ($usage.Count -eq 0) {
        throw 'Selected certificate does not have the Code Signing EKU.'
    }
    if ($Development) {
        if ($Certificate.Subject -ne $SentinelGridDevelopmentSubject -or $Certificate.Issuer -ne $Certificate.Subject) {
            throw 'Development signing requires the explicit SentinelGrid DEVELOPMENT ONLY self-signed certificate.'
        }
    } elseif ($Certificate.Subject -match 'SentinelGrid.*DEVELOPMENT ONLY') {
        throw 'A SentinelGrid DEVELOPMENT ONLY certificate cannot sign a production build.'
    }
}

function Find-SignTool {
    $tool = Get-Command signtool.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $path = $null
    if ($tool) { $path = $tool.Source }
    else {
        $base = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits\10\bin'
        if (Test-Path -LiteralPath $base) {
            $versions = @(Get-ChildItem -LiteralPath $base -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | Sort-Object { [version]$_.Name } -Descending)
            foreach ($version in $versions) {
                $candidate = Join-Path $version.FullName 'x64\signtool.exe'
                if (Test-Path -LiteralPath $candidate -PathType Leaf) { $path = $candidate; break }
            }
        }
    }
    if (-not $path) { throw 'SignTool is missing. Install the Windows SDK Signing Tools or add the installed SDK tool to PATH. No tools are downloaded.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') {
        throw 'Refusing to execute SignTool without a valid Microsoft Authenticode signature.'
    }
    return $path
}
