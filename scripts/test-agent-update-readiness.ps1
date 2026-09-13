[CmdletBinding()]
param([string]$ExpectedSignerSHA256 = $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')
$failed = [Collections.Generic.List[string]]::new()
$pinnedFiles = [Collections.Generic.List[IO.FileStream]]::new()
$install = Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'SentinelGrid'
$state = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'SentinelGrid\updates'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator privileges required; run 64-bit Windows PowerShell as Administrator.' }
    } finally { $identity.Dispose() }
    if (-not [Environment]::Is64BitProcess -or -not [Environment]::Is64BitOperatingSystem) { throw 'Use elevated 64-bit Windows PowerShell on Windows amd64.' }
    if ($ExpectedSignerSHA256 -notmatch '^[a-fA-F0-9]{64}(,[a-fA-F0-9]{64})*$') { throw 'Supply -ExpectedSignerSHA256 from the trusted build manifest/certificate, not from the installed executable.' }
    $expected = $ExpectedSignerSHA256.ToUpperInvariant()
    Write-Host "Expected pinned signer SHA256: $expected"
    $componentVersions = @()
    foreach ($product in @('Agent', 'Updater', 'RDP')) {
        $path = Join-Path $install "SentinelGrid$product.exe"
        Write-Host "${product} path: $path"
        try {
            $item = Get-Item -LiteralPath $path -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Executable is a reparse point.' }
            $pinnedFiles.Add([IO.File]::Open($path, 'Open', 'Read', 'Read'))
            $signature = Get-AuthenticodeSignature -LiteralPath $path
            Write-Host "${product} signature: $($signature.Status)"
            if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { throw 'Authenticode signature is not Valid.' }
            $pin = Get-SignerSHA256 $signature.SignerCertificate
            Write-Host "${product} signer SHA256: $pin"
            if ($expected.Split(',') -notcontains $pin) { throw 'Signer differs from the explicit expected pin.' }
            $version = & $path -version
            if ($LASTEXITCODE -ne 0 -or $version -notmatch "^SentinelGrid $product \d+\.\d+\.\d+$") { throw 'Signed product/version probe failed.' }
            Write-Host $version
            $componentVersions += ($version -split ' ')[-1]
            if ($product -eq 'RDP') { continue }
            $trustOutput = & $path -update-build-info
            if ($LASTEXITCODE -ne 0) { throw 'Installed binary lacks build trust diagnostics; install the signed development baseline first.' }
            $trust = $trustOutput | ConvertFrom-Json
            Write-Host "${product} embedded pin: $($trust.signer_sha256); development: $($trust.development); source eligible: $($trust.source_eligible)"
            if ($trust.signer_sha256 -cne $expected) { throw 'Embedded pin differs from expected build trust.' }
            if ($trust.source_eligible -ne $true) { throw 'Build qualification gate is disabled.' }
        } catch { $failed.Add("${product}: $($_.Exception.Message)") }
    }
    if (@($componentVersions | Select-Object -Unique).Count -ne 1 -or $componentVersions.Count -ne 3) { $failed.Add('Agent, Updater and RDP versions must agree.') }
    $protocol = & (Join-Path $install 'SentinelGridUpdater.exe') -protocol
    if ($LASTEXITCODE -ne 0 -or $protocol -cne '2') { $failed.Add('Full-product MSI protocol 2 is required; bootstrap with a signed MSI.') }
    foreach ($name in @('SentinelGridAgent', 'SentinelGridUpdater')) {
        try {
            $service = Get-Service -Name $name
            Write-Host "${name} service: $($service.Status)"
            if ($service.Status -ne 'Running') { $failed.Add("${name}: service is not Running") }
        } catch { $failed.Add("${name}: $($_.Exception.Message)") }
    }
    Write-Host "ProgramData update state: $state"
    if (Test-Path -LiteralPath $state) {
        Get-ChildItem -LiteralPath $state -Force | Select-Object Name, Length, Attributes, LastWriteTimeUtc | Format-Table | Out-Host
        Write-Host 'Lock-file presence is not lock ownership. The native probe validates the journal; it does not delete locks or backups.'
    } else { Write-Host 'Update state directory absent; the native probe will test secure creation.' }
    if ($failed.Count -eq 0) {
        $result = & (Join-Path $install 'SentinelGridAgent.exe') -update-readiness
        $exitCode = $LASTEXITCODE
        Write-Host ($result | Out-String)
        if ($exitCode -ne 0 -or @($result) -notcontains 'AUTO-UPDATE READY') { $failed.Add('Operational probe failed; see the named native check above.') }
    }
} catch { $failed.Add($_.Exception.Message) }
finally { foreach ($file in $pinnedFiles) { $file.Dispose() } }
if ($failed.Count -ne 0) {
    foreach ($failure in $failed) { Write-Host "FAIL: $failure" }
    Write-Host 'AUTO-UPDATE NOT READY'
    exit 1
}
Write-Host 'AUTO-UPDATE READY'
Write-Host 'Local readiness only. No update was requested; server release/policy gates remain independent.'
