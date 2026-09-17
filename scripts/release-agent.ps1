[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('dev', 'beta', 'stable')][string]$Channel,
    [string]$Version,
    [string]$OrganizationId,
    [string]$WebsiteURL
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')
$root = Split-Path -Parent $PSScriptRoot

function Get-ReleaseSetting([string[]]$Names, [string[]]$Lines) {
    foreach ($name in $Names) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
        $matches = @($Lines | Where-Object { $_ -match ('^\s*' + [regex]::Escape($name) + '\s*=') })
        if ($matches.Count -gt 1) { throw "Duplicate release setting: $name. Resolve it explicitly." }
        if ($matches.Count -eq 1) {
            $value = ($matches[0] -split '=', 2)[1].Trim()
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) { $value = $value.Substring(1, $value.Length - 2) }
            if (-not [string]::IsNullOrWhiteSpace($value)) { return $value.Trim() }
        }
    }
    return $null
}

function Assert-ReleaseOrigin([string]$Value, [string]$Name) {
    $url = $null
    if (-not [uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$url) -or $url.Scheme -ne 'https' -or -not $url.Host -or $url.UserInfo -or $url.Query -or $url.Fragment -or $url.AbsolutePath -ne '/') {
        throw "$Name must be an explicit HTTPS origin, without a path, credentials, query or fragment."
    }
    return $url.GetLeftPart([UriPartial]::Authority)
}

# Preserve the original release-beta.ps1 candidate normalization, including path stripping.
function Convert-ToHttpsOrigin([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
    try { $uri = [System.Uri]$Value }
    catch { return $null }
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or -not $uri.Host -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        return $null
    }
    return $uri.GetLeftPart([System.UriPartial]::Authority)
}

function Get-ReleaseWebsiteURL {
    [CmdletBinding()]
    param([string]$ExplicitURL, [string[]]$Lines)

    if ($ExplicitURL) { return Assert-ReleaseOrigin $ExplicitURL 'Website URL' }
    foreach ($name in @('NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_SITE_URL', 'APP_URL')) {
        $origin = Convert-ToHttpsOrigin (Get-ReleaseSetting @($name) $Lines)
        if ($origin) { return $origin }
    }
    $agentConfigPath = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'SentinelGrid\agent.json'
    if (Test-Path -LiteralPath $agentConfigPath -ErrorAction SilentlyContinue) {
        try {
            $agentConfig = Get-Content -LiteralPath $agentConfigPath -Raw | ConvertFrom-Json
            $agentServer = $null
            foreach ($name in @('Server', 'server', 'ServerURL', 'server_url', 'serverUrl')) {
                if ($null -eq $agentConfig) { break }
                $property = $agentConfig.PSObject.Properties[$name]
                if ($null -ne $property) { $agentServer = $property.Value; break }
            }
            $origin = Convert-ToHttpsOrigin ([string]$agentServer)
            if ($origin) { return $origin }
        } catch {
            Write-Warning 'Could not read website URL from installed Agent config.'
        }
    }
    return Convert-ToHttpsOrigin 'https://sentinelgrid-one.vercel.app'
}

function ConvertTo-ReleaseVersion([string]$Value) {
    if ($Value -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z' -or $Value.Length -gt 13) { throw 'Version must be major.minor.patch without prerelease/build suffixes or leading zeros.' }
    $parsed = [version]$Value
    if ($parsed.Major -gt 255 -or $parsed.Minor -gt 255 -or $parsed.Build -gt 65535) { throw 'Version exceeds MSI limits (255.255.65535).' }
    return $parsed
}

function Get-ReleaseVersion([string]$Channel, [string]$ExplicitVersion, [string]$LocalVersion, [object[]]$Published) {
    if ($Channel -eq 'stable' -and -not $ExplicitVersion) { throw 'Stable releases require an explicit -Version major.minor.patch.' }
    $highest = ConvertTo-ReleaseVersion $LocalVersion
    $latestPublished = $null
    foreach ($release in $Published) {
        $parsed = ConvertTo-ReleaseVersion ([string]$release.version)
        if ($parsed -gt $highest) { $highest = $parsed }
        if ($null -eq $latestPublished -or $parsed -gt $latestPublished) { $latestPublished = $parsed }
    }
    if ($ExplicitVersion) {
        $selected = ConvertTo-ReleaseVersion $ExplicitVersion
        if ($null -ne $latestPublished -and $selected -le $latestPublished) { throw 'Version must be newer than every published release in this channel. Published releases are immutable.' }
        return $selected.ToString()
    }
    if ($highest.Build -eq 65535) { throw 'Next patch exceeds MSI limits. Supply an explicit newer minor/major version.' }
    return '{0}.{1}.{2}' -f $highest.Major, $highest.Minor, ($highest.Build + 1)
}

function Get-OrganizationChannel([object[]]$Settings) {
    if ($Settings.Count -gt 1) { throw 'Organization has duplicate update settings.' }
    # The website uses stable only when the organization has no settings row.
    if ($Settings.Count -eq 0) { return 'stable' }
    $value = $Settings[0].channel
    if ($value -cnotin @('dev', 'beta', 'stable')) { throw 'Organization has an invalid effective channel.' }
    return $value
}

function Invoke-ReleaseRest([string]$Method, [string]$Path, [object]$Body = $null) {
    $arguments = @{ Method = $Method; Uri = "$backend/rest/v1/$Path"; Headers = $adminHeaders; UserAgent = 'SentinelGrid-Release-Tool/2.0'; MaximumRedirection = 0; TimeoutSec = 60; ErrorAction = 'Stop' }
    if ($null -ne $Body) { $arguments.ContentType = 'application/json'; $arguments.Body = $Body | ConvertTo-Json -Depth 6 -Compress }
    try {
        # Enumerate JSON arrays explicitly; Invoke-RestMethod emits them as one pipeline object.
        $response = Invoke-RestMethod @arguments
        return $response
    } catch { throw "Release backend $Method request failed. No credentials, request bodies or server error details were logged." }
}

function Get-ReleaseRows([string]$Path) {
    $offset = 0
    do {
        $page = @(Invoke-ReleaseRest 'GET' "$Path&limit=100&offset=$offset")
        foreach ($row in $page) { $row }
        $offset += $page.Count
    } while ($page.Count -eq 100)
}

function Get-ReleaseOrganization([string]$RequestedId, [string]$Channel) {
    if ($RequestedId) {
        $id = [guid]::Empty
        if (-not [guid]::TryParse($RequestedId, [ref]$id) -or $id -eq [guid]::Empty) { throw 'OrganizationId must be a nonempty UUID.' }
        $candidates = @([pscustomobject]@{ organization_id = $id.ToString() })
    } elseif ($Channel -eq 'stable') {
        $candidates = @(Get-ReleaseRows 'organizations?select=id&order=id.asc' | ForEach-Object { [pscustomobject]@{ organization_id = $_.id } })
    } else {
        $candidates = @(Get-ReleaseRows "organization_agent_update_settings?channel=eq.$Channel&select=organization_id&order=organization_id.asc")
    }
    foreach ($candidate in $candidates) {
        $id = ([guid]$candidate.organization_id).ToString()
        $settings = @(Invoke-ReleaseRest 'GET' "organization_agent_update_settings?organization_id=eq.$id&select=channel")
        if ((Get-OrganizationChannel $settings) -cne $Channel) {
            if ($RequestedId) { throw 'Requested organization effective channel does not match the release. No fallback organization or channel is allowed.' }
            continue
        }
        $organizations = @(Invoke-ReleaseRest 'GET' "organizations?id=eq.$id&select=id,owner_id")
        $clients = @(Invoke-ReleaseRest 'GET' "clients?organization_id=eq.$id&select=id,organization_id&order=id.asc&limit=1")
        if ($organizations.Count -ne 1 -or -not $organizations[0].owner_id -or $clients.Count -ne 1) {
            if ($RequestedId) { throw 'Requested organization requires a valid owner and an existing real client.' }
            Write-Warning "Skipping organization ${id}: no usable owner/client context."
            continue
        }
        if ($clients[0].organization_id -ne $id) { throw 'Client organization mismatch.' }
        return [pscustomobject]@{ OrganizationId = $id; ClientId = ([guid]$clients[0].id).ToString(); OwnerId = ([guid]$organizations[0].owner_id).ToString() }
    }
    throw "No organization with effective channel $Channel, owner and real client was found. Configure SENTINELGRID_RELEASE_$($Channel.ToUpperInvariant())_ORGANIZATION_ID or use -OrganizationId."
}

function Invoke-ReleaseTool([string]$Executable, [string[]]$Arguments, [string]$Label) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE). VERSION was not changed; artifacts were retained." }
}

$lock = $null
$tokenHash = $null
$tokenAttempted = $false
$savedEnvironment = @{}
$versionFile = Join-Path $root 'agent\VERSION'
$versionTemporary = $null
try {
    try {
        if ($env:OS -ne 'Windows_NT') { throw 'Agent releases require Windows.' }
        $Channel = $Channel.ToLowerInvariant()
        if ($Channel -eq 'stable' -and -not $Version) { throw 'Stable releases require an explicit -Version major.minor.patch.' }
        if ($Version) { $null = ConvertTo-ReleaseVersion $Version }
        $signing = if ($Channel -ne 'beta') { Resolve-ReleaseSigning $Channel } else { $null }
        $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        $powershell = Join-Path $PSHOME 'powershell.exe'
        if (-not (Test-Path -LiteralPath $powershell)) { $powershell = (Get-Process -Id $PID).Path }
        $null = Find-SignTool
        $lines = @()
        $envFile = Join-Path $root '.env.local'
        if (Test-Path -LiteralPath $envFile) { $lines = @(Get-Content -LiteralPath $envFile) }
        $backend = Assert-ReleaseOrigin (Get-ReleaseSetting @('SENTINELGRID_PUBLISH_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') $lines) 'Supabase URL'
        $website = Assert-ReleaseOrigin (Get-ReleaseWebsiteURL $WebsiteURL $lines) 'Website URL'
        $key = Get-ReleaseSetting @('SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY') $lines
        if (-not $key) { throw 'Configure a Supabase backend administration key; no anonymous/publishable key is accepted.' }
        $adminHeaders = @{ apikey = $key; Accept = 'application/json'; Prefer = 'return=representation' }
        if (-not $key.StartsWith('sb_secret_', [StringComparison]::Ordinal)) { $adminHeaders.Authorization = "Bearer $key" }
        if (-not $OrganizationId) { $OrganizationId = Get-ReleaseSetting @("SENTINELGRID_RELEASE_$($Channel.ToUpperInvariant())_ORGANIZATION_ID") $lines }
        $context = Get-ReleaseOrganization $OrganizationId $Channel
        $dist = Join-Path $root 'dist\agent'
        New-Item -ItemType Directory -Force -Path $dist | Out-Null
        $lock = [IO.File]::Open((Join-Path $dist '.release.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
        $published = @(Get-ReleaseRows "agent_releases?channel=eq.$Channel&platform=eq.windows&architecture=eq.amd64&select=id,version&order=id.asc")
        $publishedSigner = $null
        if ($published.Count -gt 0) {
            $latest = $published | Sort-Object { ConvertTo-ReleaseVersion ([string]$_.version) } -Descending | Select-Object -First 1
            $latestId = ([guid]$latest.id).ToString()
            $bundles = @(Invoke-ReleaseRest 'GET' "agent_release_bundles?release_id=eq.$latestId&select=signer_sha256,development_build")
            if ($bundles.Count -ne 1 -or $bundles[0].signer_sha256 -notmatch '^[A-Fa-f0-9]{64}$' -or $bundles[0].development_build -ne ($Channel -ne 'stable')) {
                throw 'Latest published channel bundle has invalid signer/profile metadata. Restore the existing channel metadata; automatic signer rotation is forbidden.'
            }
            $publishedSigner = $bundles[0].signer_sha256
        }
        if ($Channel -eq 'beta') { $signing = Resolve-ReleaseSigning $Channel -PublishedSigner $publishedSigner }
        if ($publishedSigner -and $publishedSigner -ine $signing.Fingerprint) {
            throw 'Configured signer/profile differs from the latest published channel bundle. Restore the existing signing configuration; automatic signer rotation is forbidden.'
        }
        $localVersion = (Get-Content -LiteralPath $versionFile -Raw).Trim()
        $selectedVersion = Get-ReleaseVersion $Channel $Version $localVersion $published
        $output = Join-Path $dist "$Channel\$selectedVersion"
        $legacyOutput = Join-Path $dist $selectedVersion
        if (-not (Test-Path -LiteralPath $output) -and (Test-Path -LiteralPath (Join-Path $legacyOutput 'manifest.json'))) {
            $legacy = Get-Content -LiteralPath (Join-Path $legacyOutput 'manifest.json') -Raw | ConvertFrom-Json
            if ($legacy.channel -ceq $Channel) { $output = $legacyOutput }
        }
        Write-Host "Release: $Channel $selectedVersion; verification organization: $($context.OrganizationId)"
        Write-Host "Signer SHA256: $($signing.Fingerprint)"
        if (Test-Path -LiteralPath $output) {
            $manifest = Get-Content -LiteralPath (Join-Path $output 'manifest.json') -Raw | ConvertFrom-Json
            if ($manifest.server_url -cne $website -or $manifest.development_update_build -ne $signing.Development -or ($manifest.trusted_signer_sha256 -join ',') -cne $signing.Pins) { throw 'Existing build does not match this origin/signing profile. Archive it explicitly; no artifacts were overwritten.' }
            Invoke-ReleaseTool $powershell @('-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'validate-agent-release.ps1'), '-ArtifactDirectory', $output, '-ExpectedVersion', $selectedVersion, '-ExpectedChannel', $Channel, '-ExpectedSignerSHA256', $signing.Fingerprint) 'Existing build validation'
        } else {
            $arguments = @('-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot 'build-agent.ps1'), '-Version', $selectedVersion, '-Channel', $Channel, '-ServerURL', $website)
            if ($signing.Development) { $arguments += @('-DevSign', '-DevCertificateThumbprint', $signing.Thumbprint, '-DevSignerSHA256', $signing.Pins, '-DevCertificateStore', $signing.Store) }
            else { $arguments += @('-Sign', '-CertificateThumbprint', $signing.Thumbprint, '-TrustedSignerSHA256', $signing.Pins, '-CertificateStore', $signing.Store) }
            if ($signing.TimestampUrl) { $arguments += @('-TimestampUrl', $signing.TimestampUrl) }
            Invoke-ReleaseTool $powershell $arguments 'Build, sign and local validation'
        }

        # Keep the token's short lifetime independent of the expensive build duration.
        $context = Get-ReleaseOrganization $context.OrganizationId $Channel
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $token = 'SG-ENROLL-' + ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $tokenHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($token)))).Replace('-', '').ToLowerInvariant() }
        finally { $sha.Dispose() }
        $tokenAttempted = $true
        $created = @(Invoke-ReleaseRest 'POST' 'agent_enrollment_tokens' @{
            organization_id = $context.OrganizationId; client_id = $context.ClientId; site_id = $null
            token_hash = $tokenHash; created_by = $context.OwnerId; expires_at = [DateTime]::UtcNow.AddMinutes(30).ToString('o')
        })
        if ($created.Count -ne 1 -or $created[0].token_hash -cne $tokenHash) { throw 'Temporary token creation was not acknowledged. Publication aborted.' }
        $publishEnvironment = @{
            SENTINELGRID_PUBLISH_SUPABASE_URL = $backend; SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY = $key
            SENTINELGRID_PUBLISH_WEBSITE_URL = $website; SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN = $token
            SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT = $signing.Development.ToString().ToLowerInvariant()
        }
        foreach ($entry in $publishEnvironment.GetEnumerator()) {
            $savedEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
        }
        Invoke-ReleaseTool $node @((Join-Path $PSScriptRoot 'publish-agent.mjs'), $output, $selectedVersion, $Channel, $signing.Fingerprint) 'Publication, Storage, DB and website validation'
    } finally {
        try {
            if ($tokenAttempted) {
                $revoked = @(Invoke-ReleaseRest 'PATCH' "agent_enrollment_tokens?token_hash=eq.$tokenHash" @{ revoked_at = [DateTime]::UtcNow.ToString('o') })
                if ($revoked.Count -ne 1 -or $revoked[0].token_hash -cne $tokenHash -or -not $revoked[0].revoked_at) { throw 'Temporary token revocation was not confirmed. Check agent_enrollment_tokens; VERSION was not changed.' }
                Write-Host 'Temporary publication token revoked and confirmed.'
            }
        } finally {
            foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
            $token = $null
        }
    }
    if ((Get-Content -LiteralPath $versionFile -Raw).Trim() -cne $localVersion) { throw 'agent\VERSION changed during this release. Publication completed, but the concurrent VERSION edit was preserved.' }
    $versionTemporary = Join-Path (Split-Path -Parent $versionFile) ('.VERSION-release-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($versionTemporary, "$selectedVersion`n", [Text.UTF8Encoding]::new($false))
    # Windows PowerShell converts $null to an empty string for this string parameter.
    [IO.File]::Replace($versionTemporary, $versionFile, [NullString]::Value)
    Write-Host "RELEASE COMPLETE: $Channel $selectedVersion. Storage, DB and website verified; temporary token revoked; agent\VERSION updated. Artifacts: $output"
} finally {
    if ($versionTemporary -and (Test-Path -LiteralPath $versionTemporary)) { Remove-Item -LiteralPath $versionTemporary -Force }
    if ($null -ne $lock) { $lock.Dispose() }
}
