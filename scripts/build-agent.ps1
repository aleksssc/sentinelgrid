[CmdletBinding()]
param(
    [string]$Version,
    [string]$ServerURL = 'https://sentinelgrid-one.vercel.app',
    [ValidateSet('stable', 'beta', 'dev')][string]$Channel = 'stable',
    [switch]$Sign,
    [switch]$Publish,
    [switch]$DevSign,
    [guid]$DevRepairProductCode = [guid]::Empty,
    [string]$DevCertificateThumbprint = $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT,
    [string]$DevSignerSHA256 = $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256,
    [ValidateSet('CurrentUser', 'LocalMachine')][string]$DevCertificateStore = $(if ($env:SENTINELGRID_DEV_SIGN_CERT_STORE) { $env:SENTINELGRID_DEV_SIGN_CERT_STORE } else { 'LocalMachine' }),
    [switch]$Dev,
    [switch]$SkipMSI,
    [string]$CertificateThumbprint = $env:SENTINELGRID_SIGN_CERT_THUMBPRINT,
    [ValidateSet('CurrentUser', 'LocalMachine')][string]$CertificateStore = 'CurrentUser',
    [string]$TrustedSignerSHA256 = $env:SENTINELGRID_UPDATE_SIGNER_SHA256,
    [string]$TimestampUrl = $env:SENTINELGRID_SIGN_TIMESTAMP_URL
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')
$root = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $root 'agent'
$report = [ordered]@{}
$originalLocation = Get-Location
$oldGOOS = $env:GOOS
$oldGOARCH = $env:GOARCH
$oldCGO = $env:CGO_ENABLED
$lock = $null
$resourceFiles = @()

function Require-Tool([string]$Name) {
    $tool = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $tool) { throw "Missing prerequisite: $Name. Install it and add it to PATH; no tools are installed automatically." }
    return $tool.Source
}

function Invoke-Checked([string]$Tool, [string[]]$Arguments, [string]$Label) {
    & $Tool @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)." }
    if ($Label) { $report[$Label] = 'OK' }
}

function Sign-Artifact([string]$Path, [string]$Label) {
    if (-not $signEnabled) { $report[$Label] = 'SKIPPED (explicit -Dev)'; return }
    $arguments = @('sign', '/sha1', $CertificateThumbprint, '/s', 'My', '/fd', 'SHA256')
    if ($TimestampUrl) { $arguments += @('/tr', $TimestampUrl, '/td', 'SHA256') }
    if ($CertificateStore -eq 'LocalMachine') { $arguments += '/sm' }
    Invoke-Checked $script:signTool ($arguments + $Path) ''
    Invoke-Checked $script:signTool @('verify', '/pa', '/all', '/v', $Path) ''
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { throw "$Label signature is not valid." }
    $fingerprint = Get-SignerSHA256 $signature.SignerCertificate
    if ($pins -notcontains $fingerprint) { throw "$Label signer is not in the embedded SHA256 allowlist." }
    $report[$Label] = 'OK'
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'Build on Windows (native Windows tests, Authenticode and WiX are required).' }
    $server = [uri]$ServerURL
    if (-not $server.IsAbsoluteUri -or $server.Scheme -ne 'https' -or -not $server.Host -or $server.UserInfo -or $server.Query -or $server.Fragment -or $server.AbsolutePath -ne '/') { throw 'ServerURL must be an HTTPS enrollment origin.' }
    $ServerURL = $server.GetLeftPart([UriPartial]::Authority)
    if (-not $Version) { $Version = (Get-Content -LiteralPath (Join-Path $agent 'VERSION') -Raw).Trim() }
    if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        throw 'Version must be major.minor.patch without prerelease/build suffixes, so MSI and Agent versions match exactly. Use -Channel for release rings.'
    }
    $parts = $Version.Split('.')
    if ([decimal]$parts[0] -gt 255 -or [decimal]$parts[1] -gt 255 -or [decimal]$parts[2] -gt 65535) { throw 'Version exceeds MSI limits (255.255.65535).' }
    if ($PSBoundParameters.ContainsKey('DevRepairProductCode')) {
        if (-not $DevSign -or $Publish -or $DevRepairProductCode -eq [guid]::Empty) {
            throw '-DevRepairProductCode requires a nonempty installed product GUID, -DevSign and build-only mode.'
        }
    }
    if ($DevSign) {
        if ($Dev -or $Sign -or $SkipMSI) { throw '-DevSign cannot be combined with -Dev, -Sign or -SkipMSI.' }
        foreach ($name in @('CertificateThumbprint', 'CertificateStore', 'TrustedSignerSHA256')) {
            if ($PSBoundParameters.ContainsKey($name)) { throw "-DevSign uses separate development certificate/pin parameters, not $name." }
        }
        if ($Channel -eq 'stable') { throw '-DevSign requires explicit -Channel beta or dev; development artifacts are never stable releases.' }
        $CertificateThumbprint = $DevCertificateThumbprint
        $CertificateStore = $DevCertificateStore
        $TrustedSignerSHA256 = $DevSignerSHA256
        if (-not $PSBoundParameters.ContainsKey('TimestampUrl')) { $TimestampUrl = $env:SENTINELGRID_DEV_SIGN_TIMESTAMP_URL }
        if ($DevSignerSHA256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Set SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 to the explicit development certificate SHA256 fingerprint.' }
    } elseif ($PSBoundParameters.ContainsKey('DevCertificateThumbprint') -or $PSBoundParameters.ContainsKey('DevSignerSHA256') -or $PSBoundParameters.ContainsKey('DevCertificateStore')) {
        throw 'Development certificate/pin parameters require -DevSign.'
    }
    if ($Dev) {
        if ($PSBoundParameters.ContainsKey('Channel') -and $Channel -ne 'dev') { throw '-Dev requires the dev channel.' }
        $Channel = 'dev'
    }
    if ($Publish -and ($Dev -or $SkipMSI)) { throw '-Publish requires a complete signed release, not -Dev or -SkipMSI.' }
    if ($Publish) { $node = Require-Tool 'node.exe' }
    if ($SkipMSI -and -not $Dev) { throw '-SkipMSI is allowed only with explicit -Dev.' }
    $signEnabled = -not $Dev -or $Sign.IsPresent
    $go = Require-Tool 'go.exe'
    $gofmt = Require-Tool 'gofmt.exe'
    Invoke-Checked $go @('tool', 'vet', '-V') ''
    if (-not $SkipMSI) { $wix = Require-Tool 'wix.exe' }
    $pins = @()
    if ($signEnabled) {
        $script:signTool = Find-SignTool
        if ($CertificateThumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Set SENTINELGRID_SIGN_CERT_THUMBPRINT to the certificate-store SHA1 thumbprint.' }
        if (-not $TrustedSignerSHA256 -or $TrustedSignerSHA256 -notmatch '^[a-fA-F0-9]{64}(,[a-fA-F0-9]{64})*$') { throw 'Set SENTINELGRID_UPDATE_SIGNER_SHA256 to comma-separated SHA256 leaf certificate fingerprints.' }
        $pins = $TrustedSignerSHA256.ToUpperInvariant().Split(',')
        if ((-not $DevSign -and -not $TimestampUrl) -or ($TimestampUrl -and (-not ([uri]$TimestampUrl).IsAbsoluteUri -or ([uri]$TimestampUrl).Scheme -ne 'https'))) { throw 'Configure an HTTPS RFC3161 timestamp URL (required for production; optional for development).' }
        $certificate = Get-Item -LiteralPath "Cert:\$CertificateStore\My\$CertificateThumbprint"
        Assert-CodeSigningCertificate $certificate $DevSign.IsPresent
        $selectedFingerprint = Get-SignerSHA256 $certificate
        if ($pins -notcontains $selectedFingerprint) { throw 'Selected certificate does not match the explicit embedded signer pin.' }
        Write-Host "Signer SHA256: $selectedFingerprint"
        if ($DevSign -and -not $TimestampUrl) { Write-Host 'DEVELOPMENT ONLY: no timestamp; artifacts stop validating when the development certificate expires.' }
        $TrustedSignerSHA256 = $TrustedSignerSHA256.ToUpperInvariant()
    } else {
        $TrustedSignerSHA256 = ''
    }
    $distRoot = Join-Path $root 'dist\agent'
    New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
    $lock = [IO.File]::Open((Join-Path $distRoot '.build.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $output = Join-Path $distRoot $Version
    if (Test-Path -LiteralPath $output) { throw "Artifact directory already exists: $output. Use a new version or deliberately archive the previous build; releases are never overwritten." }
    New-Item -ItemType Directory -Path $output | Out-Null
    Set-Location -LiteralPath $agent
    $env:GOOS = 'windows'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
    $sources = @(Get-ChildItem -LiteralPath $agent -Recurse -Filter '*.go' -File | ForEach-Object { $_.FullName })
    Invoke-Checked $gofmt (@('-w') + $sources) 'Go format'
    Invoke-Checked $go @('test', './...') 'Go tests'
    Invoke-Checked $go @('vet', './...') 'Go vet'
    $buildTags = @()
    if ($DevSign) {
        $buildTags = @('-tags', 'sentinelgrid_dev_update')
        Invoke-Checked $go @('test', '-tags', 'sentinelgrid_dev_update', './...') 'Dev Go tests'
        Invoke-Checked $go @('vet', '-tags', 'sentinelgrid_dev_update', './...') 'Dev Go vet'
    }
    $ldflags = "-s -w -X sentinelgrid/agent.Override=$Version -X sentinelgrid/agent.Channel=$Channel"
    if ($DevSign) { $ldflags += " -X sentinelgrid/agent/internal/update.DevelopmentSignerSHA256=$TrustedSignerSHA256" }
    elseif ($TrustedSignerSHA256) { $ldflags += " -X sentinelgrid/agent/internal/update.TrustedSignerSHA256=$TrustedSignerSHA256" }
    $agentExe = Join-Path $output 'SentinelGridAgent.exe'
    $resourceFiles = @('sentinelgrid-agent', 'sentinelgrid-updater', 'sentinelgrid-rdp') | ForEach-Object { Join-Path $agent "cmd\$_\version_windows_amd64.syso" }
    foreach ($path in $resourceFiles) { if (Test-Path -LiteralPath $path) { $resourceFiles = @(); throw 'Existing version resource must be cleaned up explicitly.' } }
    & (Join-Path $PSScriptRoot 'prepare-agent-resources.ps1') -Version $Version
    $updaterExe = Join-Path $output 'SentinelGridUpdater.exe'
    $rdpExe = Join-Path $output 'SentinelGridRDP.exe'
    Invoke-Checked $go @('build', '-trimpath', '-ldflags', ('-H=windowsgui ' + $ldflags), '-o', $rdpExe, '.\cmd\sentinelgrid-rdp') 'RDP client build'
    Invoke-Checked $go (@('build') + $buildTags + @('-trimpath', '-ldflags', $ldflags, '-o', $agentExe, '.\cmd\sentinelgrid-agent')) 'Agent build'
    Invoke-Checked $go (@('build') + $buildTags + @('-trimpath', '-ldflags', $ldflags, '-o', $updaterExe, '.\cmd\sentinelgrid-updater')) 'Updater build'
    $reportedVersion = & $agentExe -version
    if ($LASTEXITCODE -ne 0 -or $reportedVersion -ne "SentinelGrid Agent $Version") { throw 'Built Agent reported the wrong version.' }
    $reportedVersion = & $updaterExe -version
    if ($LASTEXITCODE -ne 0 -or $reportedVersion -ne "SentinelGrid Updater $Version") { throw 'Built updater reported the wrong version.' }
    Sign-Artifact $agentExe 'Agent signing'
    foreach ($executable in @($agentExe, $updaterExe, $rdpExe)) {
        $info = (Get-Item -LiteralPath $executable).VersionInfo
        if ($info.FileVersion -ne $Version -or $info.ProductVersion -ne $Version) { throw 'PE version resources do not match the package version.' }
    }
    $rdpInfo = (Get-Item -LiteralPath $rdpExe).VersionInfo
    if ($rdpInfo.ProductName -ne 'SentinelGrid Remote' -or $rdpInfo.FileDescription -ne 'SentinelGrid Remote' -or $rdpInfo.OriginalFilename -ne 'SentinelGridRDP.exe') {
        throw 'Built SentinelGrid Remote PE identity is invalid.'
    }
    Sign-Artifact $updaterExe 'Updater signing'
    Sign-Artifact $rdpExe 'RDP client signing'
    foreach ($executable in @($agentExe, $updaterExe)) {
        $trustOutput = & $executable -update-build-info
        if ($LASTEXITCODE -ne 0) { throw 'Built executable failed its update trust probe.' }
        $trust = $trustOutput | ConvertFrom-Json
        if ($trust.development -ne $DevSign.IsPresent -or $trust.source_eligible -ne $DevSign.IsPresent -or $trust.signer_sha256 -cne $TrustedSignerSHA256) {
            throw 'Built executable does not match the requested qualification mode and signer pin.'
        }
    }
    $msi = Join-Path $output 'SentinelGridAgent.msi'
    if (-not $SkipMSI) {
        # MSI database creation can materialize only the 8.3 alias on some hosts.
        $wixOutput = Join-Path $output 'package.msi'
        $msiArguments = @('build', (Join-Path $root 'installer\windows\Package.wxs'), '-arch', 'x64', '-d', "AgentVersion=$Version", '-d', "AgentChannel=$Channel", '-d', "AgentServer=$ServerURL", '-d', "AgentSource=$agentExe", '-d', "UpdaterSource=$updaterExe", '-d', "RDPSource=$rdpExe", '-d', "UpdateDevelopment=$($DevSign.IsPresent.ToString().ToLowerInvariant())", '-d', "UpdateSigners=$(if ($TrustedSignerSHA256) { $TrustedSignerSHA256 } else { 'UNQUALIFIED' })", '-o', $wixOutput)
        if ($DevRepairProductCode -ne [guid]::Empty) {
            $installer = New-Object -ComObject WindowsInstaller.Installer
            try {
                $code = $DevRepairProductCode.ToString('B').ToUpperInvariant()
                if ($installer.ProductInfo($code, 'ProductName') -cne 'SentinelGrid Agent' -or $installer.ProductInfo($code, 'VersionString') -cne $Version) {
                    throw 'Development repair must retain the installed SentinelGrid Agent product and version.'
                }
                $msiArguments += @('-d', "AgentProductCode=$code")
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) }
        }
        Invoke-Checked $wix $msiArguments 'MSI build'
        Move-Item -LiteralPath $wixOutput -Destination $msi -ErrorAction Stop
        Sign-Artifact $msi 'MSI signing'
    } else {
        $report['MSI build'] = 'SKIPPED (explicit -SkipMSI)'
        $report['MSI signing'] = 'SKIPPED (explicit -SkipMSI)'
    }
    $manifest = [ordered]@{
        schema_version = 1; server_url = $ServerURL; product = 'SentinelGridAgent'; version = $Version; channel = $Channel
        installation_artifact = 'msi'; update_protocol = 2
        platform = 'windows'; architecture = 'amd64'; built_at = [DateTime]::UtcNow.ToString('o')
        signed = $signEnabled; updater_qualified = $false; trusted_signer_sha256 = $pins
        development_update_build = $DevSign.IsPresent; qualification_requires_installed_windows_checks = $true
        development_repair_package = ($DevRepairProductCode -ne [guid]::Empty)
    }
    $checksums = [Collections.Generic.List[string]]::new()
    $artifacts = [ordered]@{ agent = $agentExe; updater = $updaterExe; rdp_client = $rdpExe }
    if (-not $SkipMSI) { $artifacts['msi'] = $msi }
    foreach ($entry in $artifacts.GetEnumerator()) {
        $file = Get-Item -LiteralPath $entry.Value
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $manifest[$entry.Key] = [ordered]@{ filename = $file.Name; version = $Version; sha256 = $hash; size = $file.Length }
        $checksums.Add("$hash  $($file.Name)")
    }
    $utf8 = [Text.UTF8Encoding]::new($false)
    $manifestPath = Join-Path $output 'manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6) + "`n", $utf8)
    Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json | Out-Null
    $report['Manifest'] = 'OK'
    $checksums.Add("$((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant())  manifest.json")
    [IO.File]::WriteAllLines((Join-Path $output 'checksums.txt'), $checksums, $utf8)
    $report['SHA256'] = 'OK'
    if ($signEnabled -and -not $SkipMSI) {
        & (Join-Path $PSScriptRoot 'validate-agent-release.ps1') -ArtifactDirectory $output -ExpectedVersion $Version -ExpectedChannel $Channel -ExpectedSignerSHA256 $selectedFingerprint
        $report['Release validation'] = 'OK'
    }
    if ($Publish) {
        Invoke-Checked $node @((Join-Path $PSScriptRoot 'publish-agent.mjs'), $output, $Version, $Channel, $selectedFingerprint) 'Publication and website verification'
    }
    Write-Host "`nSentinelGrid Agent $Version`n"
    foreach ($entry in $report.GetEnumerator()) { Write-Host ('{0,-16} {1}' -f $entry.Key, $entry.Value) }
    Write-Host "`nArtifacts:`ndist\agent\$Version\"
    if ($Publish) { Write-Host 'Explicit publication completed. Installed lifecycle qualification is separate.' }
    elseif ($DevSign) { Write-Host 'DEVELOPMENT ONLY update eligibility embedded. Installed Windows readiness is UNVERIFIED; no machine was qualified. Nothing was published.' }
    else { Write-Host 'Auto-update execution: DISABLED (production Windows qualification pending). Nothing was published.' }
} catch {
    Write-Error "Agent build failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
} finally {
    foreach ($path in $resourceFiles) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
    if ($null -ne $lock) { $lock.Dispose() }
    Set-Location -LiteralPath $originalLocation.Path
    $env:GOOS = $oldGOOS; $env:GOARCH = $oldGOARCH; $env:CGO_ENABLED = $oldCGO
}
