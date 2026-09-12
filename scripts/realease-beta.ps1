Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ============================================================
# SENTINELGRID - AUTOMATIC BETA RELEASE
# File:
# scripts\release-beta.ps1
# ============================================================

$ScriptsDir = $PSScriptRoot
$Root = Split-Path -Parent $ScriptsDir

$EnvFile = Join-Path $Root ".env.local"
$VersionFile = Join-Path $Root "agent\VERSION"
$BuildScript = Join-Path $ScriptsDir "build-agent.ps1"

$AgentConfigPath = "C:\ProgramData\SentinelGrid\agent.json"
$InstalledAgent = "C:\Program Files\SentinelGrid\SentinelGridAgent.exe"

$Channel = "beta"

# ============================================================
# HELPERS
# ============================================================

function Get-DotEnvValue {
    param(
        [Parameter(Mandatory)]
        [string[]]$Lines,

        [Parameter(Mandatory)]
        [string]$Name
    )

    $escapedName = [regex]::Escape($Name)

    $line = $Lines |
        Where-Object {
            $_ -match "^\s*$escapedName\s*="
        } |
        Select-Object -First 1

    if (-not $line) {
        return $null
    }

    $value = ($line -split "=", 2)[1].Trim()

    if (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
        $value = $value.Substring(
            1,
            $value.Length - 2
        )
    }

    return $value.Trim()
}

function Get-CertificateSHA256 {
    param(
        [Parameter(Mandatory)]
        $Certificate
    )

    $sha = [System.Security.Cryptography.SHA256]::Create()

    try {
        return (
            $sha.ComputeHash($Certificate.RawData) |
            ForEach-Object {
                $_.ToString("X2")
            }
        ) -join ""
    }
    finally {
        $sha.Dispose()
    }
}

function Clear-PublishEnvironment {
    Remove-Item Env:SENTINELGRID_PUBLISH_SUPABASE_URL `
        -ErrorAction SilentlyContinue

    Remove-Item Env:SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY `
        -ErrorAction SilentlyContinue

    Remove-Item Env:SENTINELGRID_PUBLISH_WEBSITE_URL `
        -ErrorAction SilentlyContinue

    Remove-Item Env:SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN `
        -ErrorAction SilentlyContinue

    Remove-Item Env:SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT `
        -ErrorAction SilentlyContinue
}

# ============================================================
# PROJECT CHECKS
# ============================================================

if (-not (Test-Path $EnvFile)) {
    throw ".env.local not found: $EnvFile"
}

if (-not (Test-Path $VersionFile)) {
    throw "agent\VERSION not found: $VersionFile"
}

if (-not (Test-Path $BuildScript)) {
    throw "build-agent.ps1 not found: $BuildScript"
}

if (-not (Test-Path $AgentConfigPath)) {
    throw "Installed Agent config not found: $AgentConfigPath"
}

if (-not (Test-Path $InstalledAgent)) {
    throw "Installed SentinelGrid Agent not found: $InstalledAgent"
}

# ============================================================
# READ EXISTING .env.local
# DO NOT MODIFY IT
# ============================================================

$EnvLines = Get-Content -LiteralPath $EnvFile

$SupabaseURL =
    Get-DotEnvValue `
        -Lines $EnvLines `
        -Name "NEXT_PUBLIC_SUPABASE_URL"

$ServiceRoleKey =
    Get-DotEnvValue `
        -Lines $EnvLines `
        -Name "SUPABASE_SERVICE_ROLE_KEY"

if (-not $SupabaseURL) {
    throw "NEXT_PUBLIC_SUPABASE_URL not found in .env.local"
}

if (-not $ServiceRoleKey) {
    throw "SUPABASE_SERVICE_ROLE_KEY not found in .env.local"
}

# ============================================================
# FIND EXISTING SG-ENROLL TOKEN
#
# Supports:
#
# SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN="SG-ENROLL-..."
#
# OR:
#
# SG-ENROLL-xxxxxxxx...
#
# ============================================================

$EnrollmentToken =
    Get-DotEnvValue `
        -Lines $EnvLines `
        -Name "SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN"

if (-not $EnrollmentToken) {

    $EnrollmentToken =
        $EnvLines |
        ForEach-Object {
            $_.Trim().Trim('"').Trim("'")
        } |
        Where-Object {
            $_ -match '^SG-ENROLL-[a-fA-F0-9]{64}$'
        } |
        Select-Object -First 1
}

if (-not $EnrollmentToken) {
    throw "No SG-ENROLL token found in .env.local"
}

# ============================================================
# READ INSTALLED AGENT CONFIG
# ============================================================

$AgentConfig =
    Get-Content `
        -LiteralPath $AgentConfigPath `
        -Raw |
    ConvertFrom-Json

$WebsiteURL =
    ([string]$AgentConfig.server).TrimEnd("/")

if (-not $WebsiteURL) {
    throw "Server URL missing from agent.json"
}

if (-not $WebsiteURL.StartsWith("https://")) {
    throw "Invalid HTTPS server URL in agent.json: $WebsiteURL"
}

# ============================================================
# GET TRUSTED SIGNER FROM CURRENT INSTALLED AGENT
# ============================================================

$TrustRaw =
    & $InstalledAgent -update-build-info

if ($LASTEXITCODE -ne 0) {
    throw "Installed Agent trust probe failed."
}

$Trust =
    $TrustRaw |
    ConvertFrom-Json

$SignerSHA256 =
    ([string]$Trust.signer_sha256).ToUpperInvariant()

if (
    -not $SignerSHA256 -or
    $SignerSHA256 -notmatch '^[A-F0-9]{64}$'
) {
    throw "Installed Agent returned an invalid signer SHA256."
}

if ($Trust.development -ne $true) {
    throw "Installed Agent is not a development update build."
}

if ($Trust.source_eligible -ne $true) {
    throw "Installed Agent is not eligible as a development update source."
}

# ============================================================
# FIND MATCHING SIGNING CERTIFICATE + PRIVATE KEY
# ============================================================

$Certificate = $null
$CertificateStore = $null

foreach ($Store in @(
    "CurrentUser",
    "LocalMachine"
)) {

    $StorePath =
        "Cert:\$Store\My"

    $Certificates =
        Get-ChildItem `
            -LiteralPath $StorePath `
            -ErrorAction SilentlyContinue

    foreach ($Candidate in $Certificates) {

        if (-not $Candidate.HasPrivateKey) {
            continue
        }

        $Fingerprint =
            Get-CertificateSHA256 `
                -Certificate $Candidate

        if (
            $Fingerprint.ToUpperInvariant() -eq
            $SignerSHA256
        ) {

            $Certificate =
                $Candidate

            $CertificateStore =
                $Store

            break
        }
    }

    if ($Certificate) {
        break
    }
}

if (-not $Certificate) {
    throw @"
Could not find the signing certificate trusted by the installed Agent.

Required SHA256:
$SignerSHA256

The certificate must also contain its private key.
"@
}

$CertificateThumbprint =
    $Certificate.Thumbprint

# ============================================================
# CURRENT VERSION
# ============================================================

$CurrentVersion =
    (
        Get-Content `
            -LiteralPath $VersionFile `
            -Raw
    ).Trim()

if (
    $CurrentVersion -notmatch
    '^(\d+)\.(\d+)\.(\d+)$'
) {
    throw "Invalid agent\VERSION: $CurrentVersion"
}

$Major = [int]$Matches[1]
$Minor = [int]$Matches[2]
$Patch = [int]$Matches[3]

# ============================================================
# NEXT PATCH VERSION
# ============================================================

$NextVersion =
    "$Major.$Minor.$($Patch + 1)"

$OutputDirectory =
    Join-Path `
        $Root `
        "dist\agent\$NextVersion"

# ============================================================
# IF PREVIOUS FAILED BUILD EXISTS, ARCHIVE IT
# ============================================================

if (Test-Path $OutputDirectory) {

    $ArchiveRoot =
        Join-Path `
            $Root `
            "dist\archive"

    New-Item `
        -ItemType Directory `
        -Force `
        -Path $ArchiveRoot |
    Out-Null

    $Timestamp =
        Get-Date -Format "yyyyMMdd-HHmmss"

    $ArchivePath =
        Join-Path `
            $ArchiveRoot `
            "$NextVersion-$Timestamp"

    Write-Host ""
    Write-Host "Existing build found:"
    Write-Host $OutputDirectory
    Write-Host ""
    Write-Host "Archiving to:"
    Write-Host $ArchivePath
    Write-Host ""

    Move-Item `
        -LiteralPath $OutputDirectory `
        -Destination $ArchivePath
}

# ============================================================
# TEMPORARY PUBLISH ENVIRONMENT
#
# Values come from .env.local.
# .env.local IS NEVER MODIFIED.
# ============================================================

$env:SENTINELGRID_PUBLISH_SUPABASE_URL =
    $SupabaseURL

$env:SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY =
    $ServiceRoleKey

$env:SENTINELGRID_PUBLISH_WEBSITE_URL =
    $WebsiteURL

$env:SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN =
    $EnrollmentToken

$env:SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT =
    "true"

# ============================================================
# DISPLAY RELEASE INFO
# ============================================================

Write-Host ""
Write-Host "============================================"
Write-Host " SentinelGrid Automatic Beta Release"
Write-Host "============================================"
Write-Host ""
Write-Host "Project:"
Write-Host "  $Root"
Write-Host ""
Write-Host "Version:"
Write-Host "  $CurrentVersion -> $NextVersion"
Write-Host ""
Write-Host "Channel:"
Write-Host "  $Channel"
Write-Host ""
Write-Host "Website:"
Write-Host "  $WebsiteURL"
Write-Host ""
Write-Host "Signer SHA256:"
Write-Host "  $SignerSHA256"
Write-Host ""
Write-Host "Certificate:"
Write-Host "  Store:      $CertificateStore"
Write-Host "  Thumbprint: $CertificateThumbprint"
Write-Host ""
Write-Host "Starting:"
Write-Host "  Build"
Write-Host "  Tests"
Write-Host "  Signing"
Write-Host "  MSI"
Write-Host "  SHA256"
Write-Host "  Manifest"
Write-Host "  Validation"
Write-Host "  Publication"
Write-Host "  Website verification"
Write-Host ""

# ============================================================
# RELEASE
# ============================================================

$ReleaseSucceeded = $false

try {

    & $BuildScript `
        -Version $NextVersion `
        -Channel $Channel `
        -DevSign `
        -Publish `
        -DevCertificateThumbprint $CertificateThumbprint `
        -DevSignerSHA256 $SignerSHA256 `
        -DevCertificateStore $CertificateStore

    if ($LASTEXITCODE -ne 0) {
        throw "SentinelGrid release pipeline failed."
    }

    # ========================================================
    # UPDATE VERSION ONLY AFTER SUCCESSFUL PUBLICATION
    # ========================================================

    [System.IO.File]::WriteAllText(
        $VersionFile,
        "$NextVersion`n",
        [System.Text.UTF8Encoding]::new($false)
    )

    $ReleaseSucceeded = $true
}
finally {

    # ========================================================
    # REMOVE TEMP ENVIRONMENT FROM CURRENT POWERSHELL
    # ========================================================

    Clear-PublishEnvironment
}

# ============================================================
# FINAL RESULT
# ============================================================

if (-not $ReleaseSucceeded) {
    throw "Release failed. agent\VERSION was not changed."
}

Write-Host ""
Write-Host "============================================"
Write-Host " RELEASE COMPLETE"
Write-Host "============================================"
Write-Host ""
Write-Host "Previous version:"
Write-Host "  $CurrentVersion"
Write-Host ""
Write-Host "Published version:"
Write-Host "  $NextVersion"
Write-Host ""
Write-Host "Channel:"
Write-Host "  $Channel"
Write-Host ""
Write-Host "agent\VERSION:"
Write-Host "  $NextVersion"
Write-Host ""
Write-Host "Published and website verified successfully."
Write-Host ""