[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][ValidateSet('dev', 'beta', 'stable')][string]$ExpectedChannel,
    [string]$ExpectedSignerSHA256 = 'A69D0BD1B538550D53F16FCB727F81893B0781ED75C58FC77A50AC214FB3996F',
    [string]$WebsiteMSI
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')

function Assert-Signature([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate) { throw "Authenticode is not Valid: $([IO.Path]::GetFileName($Path)) ($($signature.Status))" }
    if ((Get-SignerSHA256 $signature.SignerCertificate) -cne $ExpectedSignerSHA256.ToUpperInvariant()) { throw 'Signer SHA256 differs from the independently supplied pin.' }
}
function Assert-MSI([string]$Path, [string]$Version, [string]$Channel) {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $db = $null; $view = $null; $summary = $null
    try {
        $db = $installer.OpenDatabase($Path, 0)
        $view = $db.OpenView('SELECT `Property`, `Value` FROM `Property`')
        $view.Execute()
        $properties = @{}
        while ($null -ne ($row = $view.Fetch())) {
            try { $properties[$row.StringData(1)] = $row.StringData(2) }
            finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($row) }
        }
        if ($properties['ProductVersion'] -cne $Version -or $properties['SENTINELGRID_CHANNEL'] -cne $Channel) { throw 'MSI version/channel mismatch.' }
        if ($properties['ProductName'] -cne 'SentinelGrid Agent' -or $properties['UpgradeCode'] -ine '{B632A689-8C9E-4E77-BF7C-5E9C4A012901}' -or
            $properties['SENTINELGRID_UPDATE_PROTOCOL'] -cne '2' -or
            $properties['SENTINELGRID_UPDATE_DEVELOPMENT'] -cne $manifest.development_update_build.ToString().ToLowerInvariant() -or
            $properties['SENTINELGRID_UPDATE_SIGNERS'] -cne ($manifest.trusted_signer_sha256 -join ',')) { throw 'MSI product/trust protocol mismatch.' }
        if ($properties['SENTINELGRID_SERVER'] -cne $manifest.server_url) { throw 'MSI enrollment origin differs from manifest.' }
        $view.Close()
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
        $view = $db.OpenView('SELECT `File`, `Version` FROM `File`')
        $view.Execute()
        $files = @{}
        while ($null -ne ($row = $view.Fetch())) {
            try { $files[$row.StringData(1)] = $row.StringData(2) }
            finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($row) }
        }
        if ($files.Count -ne 3) { throw 'MSI must contain Agent, Updater and RDP.' }
        foreach ($name in @('SentinelGridAgentExe','SentinelGridUpdaterExe','SentinelGridRDPExe')) {
            if (-not $files.ContainsKey($name) -or [version]$files[$name] -ne [version]($Version + '.0')) { throw 'MSI payload file versions differ from ProductVersion.' }
        }
        $summary = $db.SummaryInformation(0)
        if ($summary.Property(7) -notmatch '^x64;') { throw 'MSI is not x64.' }
    } finally {
        if ($view) { $view.Close() }
        foreach ($item in @($summary, $view, $db, $installer)) { if ($item) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item) } }
    }
}
function Assert-PE([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5A4D) { throw 'Missing DOS header.' }
        $stream.Position = 0x3C
        $offset = $reader.ReadInt32()
        if ($offset -lt 64 -or $offset -gt $stream.Length - 6) { throw 'Invalid PE header offset.' }
        $stream.Position = $offset
        if ($reader.ReadUInt32() -ne 0x4550 -or $reader.ReadUInt16() -ne 0x8664) { throw 'Executable is not Windows amd64.' }
    } finally { $reader.Dispose(); $stream.Dispose() }
}
if ($ExpectedSignerSHA256 -notmatch '^[A-Fa-f0-9]{64}$') { throw 'An independent single SHA256 signer pin is required.' }
$directory = (Resolve-Path -LiteralPath $ArtifactDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $directory 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.installation_artifact -cne 'msi' -or $manifest.update_protocol -ne 2) { throw 'Full-product MSI publication is required.' }
if ($manifest.schema_version -ne 1 -or $manifest.product -cne 'SentinelGridAgent' -or $manifest.version -cne $ExpectedVersion -or $manifest.channel -cne $ExpectedChannel -or $manifest.platform -cne 'windows' -or $manifest.architecture -cne 'amd64' -or $manifest.signed -ne $true) { throw 'Invalid release manifest identity or signing state.' }
if ($manifest.development_update_build -and $ExpectedChannel -eq 'stable') { throw 'Development artifacts cannot be stable.' }
if (@($manifest.trusted_signer_sha256) -cnotcontains $ExpectedSignerSHA256.ToUpperInvariant()) { throw 'Manifest signer does not match the expected pin.' }
$server = [uri]$manifest.server_url
if (-not $server.IsAbsoluteUri -or $server.Scheme -ne 'https' -or -not $server.Host -or $server.UserInfo -or $server.Query -or $server.Fragment -or $server.AbsolutePath -ne '/') { throw 'Invalid manifest enrollment origin.' }
$names = @{ agent='SentinelGridAgent.exe'; updater='SentinelGridUpdater.exe'; rdp_client='SentinelGridRDP.exe'; msi='SentinelGridAgent.msi' }
foreach ($key in $names.Keys) {
    $artifact = $manifest.$key
    if ($artifact.filename -cne $names[$key] -or $artifact.version -cne $ExpectedVersion) { throw 'Invalid artifact filename/version.' }
    $path = Join-Path $directory $artifact.filename
    $item = Get-Item -LiteralPath $path
    if ($item.Length -ne $artifact.size -or $item.Length -le 0 -or $item.Length -gt 268435456 -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $artifact.sha256) { throw "Artifact size/SHA256 mismatch: $key" }
    Assert-Signature $path
    if ($key -eq 'msi') { Assert-MSI $path $ExpectedVersion $ExpectedChannel; continue }
    Assert-PE $path
    if ($item.VersionInfo.FileVersion -cne $ExpectedVersion -or $item.VersionInfo.ProductVersion -cne $ExpectedVersion) { throw 'PE version does not match manifest.' }
    if ($key -eq 'rdp_client') {
        if ($item.VersionInfo.ProductName -cne 'SentinelGrid Remote' -or $item.VersionInfo.FileDescription -cne 'SentinelGrid Remote' -or $item.VersionInfo.OriginalFilename -cne 'SentinelGridRDP.exe') {
            throw 'SentinelGrid Remote PE identity mismatch.'
        }
        continue
    }
    $product = @{ agent='Agent'; updater='Updater' }[$key]
    $reportedVersion = & $path -version
    if ($LASTEXITCODE -ne 0 -or $reportedVersion -cne ('SentinelGrid {0} {1}' -f $product, $ExpectedVersion)) { throw 'Component embedded version mismatch.' }
    $reportedChannel = & $path -release-channel
    if ($LASTEXITCODE -ne 0 -or $reportedChannel -cne $ExpectedChannel) { throw 'Component embedded channel mismatch.' }
    if ($key -in @('agent', 'updater')) {
        $trustOutput = & $path -update-build-info
        if ($LASTEXITCODE -ne 0) { throw 'Embedded trust probe failed.' }
        $trust = $trustOutput | ConvertFrom-Json
        if ($trust.development -ne $manifest.development_update_build -or $trust.signer_sha256 -cne ($manifest.trusted_signer_sha256 -join ',')) { throw 'Embedded trust differs from manifest.' }
    }
}
$expectedChecksums = @{}
foreach ($key in $names.Keys) { $expectedChecksums[$names[$key]] = $manifest.$key.sha256 }
$expectedChecksums['manifest.json'] = (Get-FileHash -LiteralPath (Join-Path $directory 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$lines = @(Get-Content -LiteralPath (Join-Path $directory 'checksums.txt'))
if ($lines.Count -ne $expectedChecksums.Count) { throw 'Checksum list is incomplete.' }
foreach ($line in $lines) {
    if ($line -cnotmatch '^([a-f0-9]{64})  ([A-Za-z0-9.]+)$') { throw 'Invalid checksum line.' }
    $name = $Matches[2]; $hash = $Matches[1]
    if (-not $expectedChecksums.ContainsKey($name) -or $expectedChecksums[$name] -cne $hash) { throw 'Checksum file differs from validated artifacts.' }
    $expectedChecksums.Remove($name)
}
if ($WebsiteMSI) {
    $websitePath = (Resolve-Path -LiteralPath $WebsiteMSI).Path
    if ((Get-Item -LiteralPath $websitePath).Length -ne $manifest.msi.size -or (Get-FileHash -LiteralPath $websitePath -Algorithm SHA256).Hash -ine $manifest.msi.sha256) { throw 'Website MSI differs from the validated release.' }
    Assert-Signature $websitePath
    Assert-MSI $websitePath $ExpectedVersion $ExpectedChannel
}
Write-Host "VALIDATED: $ExpectedVersion $ExpectedChannel windows/amd64; all signatures, signer pins, sizes, SHA256 and version metadata agree."
