[CmdletBinding()]
param(
    [string]$OrganizationId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ============================================================
# SENTINELGRID - AUTOMATIC BETA RELEASE
# File: scripts\release-beta.ps1
#
# FLOW
# ------------------------------------------------------------
# .env.local
#      ↓
# Supabase backend authentication
#      ↓
# beta organization + real client
#      ↓
# trusted signer + private certificate
#      ↓
# next semantic version
#      ↓
# existing valid build OR new build
#      ↓
# temporary enrollment token
#      ↓
# publish-agent.mjs
#      ↓
# Supabase Storage / DB / website validation
#      ↓
# revoke temporary token
#      ↓
# update agent\VERSION
#
# IMPORTANT:
# - NEVER modifies .env.local
# - NEVER prints secrets
# - NEVER creates fake clients
# - NEVER changes organization/device relationships
# - VERSION only changes after successful publication
# ============================================================


# ============================================================
# CONFIGURATION
# ============================================================

$ScriptsDir =
    $PSScriptRoot

$Root =
    Split-Path -Parent $ScriptsDir

$EnvFile =
    Join-Path $Root ".env.local"

$VersionFile =
    Join-Path $Root "agent\VERSION"

$BuildScript =
    Join-Path $ScriptsDir "build-agent.ps1"

$PublishScript =
    Join-Path $ScriptsDir "publish-agent.mjs"

$ValidateScript =
    Join-Path $ScriptsDir "validate-agent-release.ps1"


$AgentConfigPath =
    "C:\ProgramData\SentinelGrid\agent.json"

$InstalledAgent =
    "C:\Program Files\SentinelGrid\SentinelGridAgent.exe"


$Channel =
    "beta"

$Platform =
    "windows"

$Architecture =
    "amd64"


$DefaultWebsiteURL =
    "https://sentinelgrid-one.vercel.app"


# Preferred development/release organization.
#
# If -OrganizationId is supplied, that takes priority.
# Otherwise AlexCorp is attempted first.
# If it cannot be used, the script searches other beta orgs.
$PreferredOrganizationId =
    "129de976-9573-4f04-907b-7f9ce367bb8b"


# PowerShell 5.1 otherwise sends a browser-like User-Agent.
# Supabase sb_secret_* keys reject browser environments.
$ReleaseUserAgent =
    "SentinelGrid-Release-Tool/1.0"


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

    $escapedName =
        [regex]::Escape($Name)

    $line =
        $Lines |
        Where-Object {
            $_ -match "^\s*$escapedName\s*="
        } |
        Select-Object -First 1


    if (-not $line) {
        return $null
    }


    $value =
        ($line -split "=", 2)[1].Trim()


    if (
        $value.Length -ge 2 -and
        (
            (
                $value.StartsWith('"') -and
                $value.EndsWith('"')
            ) -or
            (
                $value.StartsWith("'") -and
                $value.EndsWith("'")
            )
        )
    ) {

        $value =
            $value.Substring(
                1,
                $value.Length - 2
            )
    }


    $value =
        $value.Trim()


    if (
        [string]::IsNullOrWhiteSpace(
            $value
        )
    ) {
        return $null
    }


    return $value
}


function Get-ObjectValue {

    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        $Object,

        [Parameter(Mandatory)]
        [string[]]$Names
    )


    if ($null -eq $Object) {
        return $null
    }


    # --------------------------------------------------------
    # UNWRAP SINGLE-ELEMENT ARRAYS
    # --------------------------------------------------------

    if (
        $Object -is
        [System.Array]
    ) {

        if ($Object.Count -eq 0) {
            return $null
        }


        if ($Object.Count -eq 1) {

            $Object =
                $Object[0]
        }
    }


    # --------------------------------------------------------
    # HANDLE JSON STRINGS
    # --------------------------------------------------------

    if (
        $Object -is
        [string]
    ) {

        $text =
            $Object.Trim()


        $looksLikeJson =
            (
                $text.StartsWith("{") -and
                $text.EndsWith("}")
            ) -or
            (
                $text.StartsWith("[") -and
                $text.EndsWith("]")
            )


        if ($looksLikeJson) {

            try {

                $parsed =
                    $text |
                    ConvertFrom-Json `
                        -ErrorAction Stop


                if (
                    $parsed -is
                    [System.Array] -and
                    $parsed.Count -eq 1
                ) {

                    $parsed =
                        $parsed[0]
                }


                $Object =
                    $parsed
            }
            catch {

                # Not valid JSON.
                # Continue using original object.
            }
        }
    }


    # --------------------------------------------------------
    # FIND PROPERTY
    # --------------------------------------------------------

    foreach ($name in $Names) {

        # ----------------------------------------------------
        # HASHTABLE / DICTIONARY
        # ----------------------------------------------------

        if (
            $Object -is
            [System.Collections.IDictionary]
        ) {

            foreach ($key in $Object.Keys) {

                if (
                    [string]::Equals(
                        [string]$key,
                        $name,
                        [System.StringComparison]::OrdinalIgnoreCase
                    )
                ) {

                    # Do not discard:
                    # false
                    # 0
                    # ""
                    return $Object[$key]
                }
            }
        }


        # ----------------------------------------------------
        # PSCUSTOMOBJECT / NORMAL .NET OBJECT
        # ----------------------------------------------------

        if (
            $null -ne
            $Object.PSObject
        ) {

            foreach (
                $property in
                @($Object.PSObject.Properties)
            ) {

                if (
                    [string]::Equals(
                        $property.Name,
                        $name,
                        [System.StringComparison]::OrdinalIgnoreCase
                    )
                ) {

                    return $property.Value
                }
            }
        }
    }


    return $null
}


function Convert-ToHttpsOrigin {

    param(
        [string]$Value
    )


    if (
        [string]::IsNullOrWhiteSpace(
            $Value
        )
    ) {
        return $null
    }


    try {

        $uri =
            [System.Uri]$Value
    }
    catch {

        return $null
    }


    if (
        -not $uri.IsAbsoluteUri -or
        $uri.Scheme -ne "https" -or
        -not $uri.Host -or
        $uri.UserInfo -or
        $uri.Query -or
        $uri.Fragment
    ) {

        return $null
    }


    return $uri.GetLeftPart(
        [System.UriPartial]::Authority
    )
}


function Convert-ToSemanticVersion {

    param(
        [string]$Value
    )


    if (
        $Value -notmatch
        '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
    ) {

        return $null
    }


    try {

        return [version]$Value
    }
    catch {

        return $null
    }
}


function Get-SHA256String {

    param(
        [Parameter(Mandatory)]
        [string]$Value
    )


    $sha =
        [System.Security.Cryptography.SHA256]::Create()


    try {

        $bytes =
            [System.Text.Encoding]::UTF8.GetBytes(
                $Value
            )


        return (
            $sha.ComputeHash(
                $bytes
            ) |
            ForEach-Object {
                $_.ToString("x2")
            }
        ) -join ""
    }
    finally {

        $sha.Dispose()
    }
}


function Get-CertificateSHA256 {

    param(
        [Parameter(Mandatory)]
        $Certificate
    )


    $sha =
        [System.Security.Cryptography.SHA256]::Create()


    try {

        return (
            $sha.ComputeHash(
                $Certificate.RawData
            ) |
            ForEach-Object {
                $_.ToString("X2")
            }
        ) -join ""
    }
    finally {

        $sha.Dispose()
    }
}


function New-SecureRandomHex {

    param(
        [int]$ByteCount = 32
    )


    $bytes =
        New-Object byte[] $ByteCount


    $rng =
        [System.Security.Cryptography.RandomNumberGenerator]::Create()


    try {

        $rng.GetBytes(
            $bytes
        )
    }
    finally {

        $rng.Dispose()
    }


    return (
        $bytes |
        ForEach-Object {
            $_.ToString("x2")
        }
    ) -join ""
}


function Test-CommandExists {

    param(
        [Parameter(Mandatory)]
        [string]$Name
    )


    return $null -ne (
        Get-Command `
            $Name `
            -ErrorAction SilentlyContinue |
        Select-Object -First 1
    )
}


function Invoke-SupabaseRest {

    param(
        [Parameter(Mandatory)]
        [ValidateSet(
            "GET",
            "POST",
            "PATCH",
            "DELETE"
        )]
        [string]$Method,

        [Parameter(Mandatory)]
        [string]$Uri,

        [Parameter(Mandatory)]
        [hashtable]$Headers,

        [AllowNull()]
        [object]$Body = $null
    )


    try {

        switch ($Method) {

            "GET" {

                return Invoke-RestMethod `
                    -Method Get `
                    -Uri $Uri `
                    -Headers $Headers `
                    -UserAgent $ReleaseUserAgent `
                    -ErrorAction Stop
            }


            "POST" {

                if ($null -eq $Body) {

                    throw `
                        "POST request requires a body."
                }


                return Invoke-RestMethod `
                    -Method Post `
                    -Uri $Uri `
                    -Headers $Headers `
                    -UserAgent $ReleaseUserAgent `
                    -ContentType "application/json" `
                    -Body ([string]$Body) `
                    -ErrorAction Stop
            }


            "PATCH" {

                if ($null -eq $Body) {

                    throw `
                        "PATCH request requires a body."
                }


                return Invoke-RestMethod `
                    -Method Patch `
                    -Uri $Uri `
                    -Headers $Headers `
                    -UserAgent $ReleaseUserAgent `
                    -ContentType "application/json" `
                    -Body ([string]$Body) `
                    -ErrorAction Stop
            }


            "DELETE" {

                return Invoke-RestMethod `
                    -Method Delete `
                    -Uri $Uri `
                    -Headers $Headers `
                    -UserAgent $ReleaseUserAgent `
                    -ErrorAction Stop
            }
        }
    }
    catch {

        $message =
            $_.Exception.Message


        $details =
            $null


        if (
            $_.ErrorDetails -and
            $_.ErrorDetails.Message
        ) {

            $details =
                $_.ErrorDetails.Message
        }


        if ($details) {

            throw @"
Supabase REST request failed.

Method:
$Method

URI:
$Uri

Error:
$message

Details:
$details
"@
        }


        throw @"
Supabase REST request failed.

Method:
$Method

URI:
$Uri

Error:
$message
"@
    }
}


function New-AdminHeaders {

    param(
        [Parameter(Mandatory)]
        [string]$Key,

        [Parameter(Mandatory)]
        [ValidateSet(
            "legacy-service-role",
            "secret"
        )]
        [string]$Type
    )


    $headers = @{
        "apikey" = $Key
        "Accept" = "application/json"
    }


    # Legacy JWT service_role keys are valid Bearer tokens.
    #
    # New sb_secret_* keys are NOT JWTs and must not be sent
    # as Bearer tokens.
    if (
        $Type -eq
        "legacy-service-role"
    ) {

        $headers["Authorization"] =
            "Bearer $Key"
    }


    return $headers
}


function Test-SupabaseAdminKey {

    param(
        [Parameter(Mandatory)]
        [string]$Key,

        [Parameter(Mandatory)]
        [string]$Type,

        [Parameter(Mandatory)]
        [string]$SupabaseURL
    )


    $headers =
        New-AdminHeaders `
            -Key $Key `
            -Type $Type


    $url =
        "$SupabaseURL/rest/v1/organizations?select=id&limit=1"


    try {

        $null =
            Invoke-SupabaseRest `
                -Method GET `
                -Uri $url `
                -Headers $headers


        return $true
    }
    catch {

        return $false
    }
}


function Save-EnvironmentVariable {

    param(
        [Parameter(Mandatory)]
        [string]$Name
    )


    $value =
        [System.Environment]::GetEnvironmentVariable(
            $Name,
            "Process"
        )


    return [PSCustomObject]@{
        Name     = $Name
        HadValue = ($null -ne $value)
        Value    = $value
    }
}


function Restore-EnvironmentVariable {

    param(
        [Parameter(Mandatory)]
        $State
    )


    if ($State.HadValue) {

        [System.Environment]::SetEnvironmentVariable(
            $State.Name,
            $State.Value,
            "Process"
        )
    }
    else {

        [System.Environment]::SetEnvironmentVariable(
            $State.Name,
            $null,
            "Process"
        )
    }
}


function Invoke-ExternalChecked {

    param(
        [Parameter(Mandatory)]
        [string]$Executable,

        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [Parameter(Mandatory)]
        [string]$Label
    )


    Write-Host ""
    Write-Host "--------------------------------------------"
    Write-Host $Label
    Write-Host "--------------------------------------------"
    Write-Host ""


    & $Executable @Arguments


    $exitCode =
        $LASTEXITCODE


    if ($exitCode -ne 0) {

        throw `
            "$Label failed with exit code $exitCode."
    }
}


# ============================================================
# REQUIRED FILES
# ============================================================

$RequiredFiles = @(
    $EnvFile,
    $VersionFile,
    $BuildScript,
    $PublishScript,
    $ValidateScript
)


foreach ($file in $RequiredFiles) {

    if (
        -not (
            Test-Path `
                -LiteralPath $file
        )
    ) {

        throw `
            "Required file not found: $file"
    }
}


# ============================================================
# WINDOWS + REQUIRED TOOLS
# ============================================================

if (
    -not $env:OS -or
    $env:OS -ne "Windows_NT"
) {

    throw `
        "SentinelGrid Agent releases must be built on Windows."
}


foreach ($tool in @(
    "node.exe",
    "go.exe",
    "gofmt.exe",
    "wix.exe"
)) {

    if (
        -not (
            Test-CommandExists `
                -Name $tool
        )
    ) {

        throw `
            "$tool was not found in PATH."
    }
}


$NodeExe =
    (
        Get-Command `
            node.exe `
            -ErrorAction Stop |
        Select-Object -First 1
    ).Source


$PowerShellExe =
    (Get-Process -Id $PID).Path


if (
    -not (
        Test-Path `
            -LiteralPath $PowerShellExe
    )
) {

    throw `
        "Could not resolve the current PowerShell executable."
}


# ============================================================
# READ .env.local
#
# NEVER WRITES TO IT
# ============================================================

$EnvLines =
    @(
        Get-Content `
            -LiteralPath $EnvFile |
        Where-Object {
            -not [string]::IsNullOrWhiteSpace($_)
        }
    )

$SupabaseURL =
    Get-DotEnvValue `
        -Lines $EnvLines `
        -Name "NEXT_PUBLIC_SUPABASE_URL"


$LegacyServiceRoleKey =
    Get-DotEnvValue `
        -Lines $EnvLines `
        -Name "SUPABASE_SERVICE_ROLE_KEY"


$SecretKey =
    Get-DotEnvValue `
        -Lines $EnvLines `
        -Name "SUPABASE_SECRET_KEY"


if (-not $SupabaseURL) {

    throw `
        "NEXT_PUBLIC_SUPABASE_URL not found in .env.local"
}


$SupabaseURL =
    Convert-ToHttpsOrigin `
        -Value $SupabaseURL


if (-not $SupabaseURL) {

    throw `
        "NEXT_PUBLIC_SUPABASE_URL is not a valid HTTPS origin."
}


# ============================================================
# SUPABASE ADMIN KEY
#
# Try legacy service_role first.
#
# It works cleanly with PostgREST and PowerShell.
#
# If unavailable/revoked:
# fallback to modern sb_secret_* key.
# ============================================================

Write-Host ""
Write-Host "Checking Supabase admin access..."


$AdminCandidates = @()


if ($LegacyServiceRoleKey) {

    $AdminCandidates +=
        [PSCustomObject]@{
            Type = "legacy-service-role"
            Key  = $LegacyServiceRoleKey
        }
}


if (
    $SecretKey -and
    $SecretKey.StartsWith(
        "sb_secret_",
        [System.StringComparison]::Ordinal
    )
) {

    $AdminCandidates +=
        [PSCustomObject]@{
            Type = "secret"
            Key  = $SecretKey
        }
}


if (
    $AdminCandidates.Count -eq 0
) {

    throw @"
No Supabase backend administration key was found.

Expected one of:

SUPABASE_SERVICE_ROLE_KEY=...

or

SUPABASE_SECRET_KEY=sb_secret_...
"@
}


$AdminKey =
    $null

$AdminKeyType =
    $null

$AdminHeaders =
    $null


foreach ($candidate in $AdminCandidates) {

    Write-Host "  Trying $($candidate.Type)..."


    $works =
        Test-SupabaseAdminKey `
            -Key $candidate.Key `
            -Type $candidate.Type `
            -SupabaseURL $SupabaseURL


    if ($works) {

        $AdminKey =
            $candidate.Key

        $AdminKeyType =
            $candidate.Type

        $AdminHeaders =
            New-AdminHeaders `
                -Key $AdminKey `
                -Type $AdminKeyType


        break
    }


    Write-Host "  Failed."
}


if (-not $AdminKey) {

    throw @"
No Supabase backend administration key could authenticate.

No keys were printed or modified.
"@
}


Write-Host "Supabase admin access OK."


# ============================================================
# WEBSITE URL
# ============================================================

$WebsiteURL =
    $null


foreach ($name in @(
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_BASE_URL",
    "NEXT_PUBLIC_SITE_URL",
    "APP_URL"
)) {

    $candidate =
        Get-DotEnvValue `
            -Lines $EnvLines `
            -Name $name


    $origin =
        Convert-ToHttpsOrigin `
            -Value $candidate


    if ($origin) {

        $WebsiteURL =
            $origin

        break
    }
}


# ------------------------------------------------------------
# FALLBACK TO INSTALLED AGENT CONFIG
# ------------------------------------------------------------

if (
    -not $WebsiteURL -and
    (
        Test-Path `
            -LiteralPath $AgentConfigPath `
            -ErrorAction SilentlyContinue
    )
) {

    try {

        $AgentConfig =
            Get-Content `
                -LiteralPath $AgentConfigPath `
                -Raw |
            ConvertFrom-Json


        $AgentServer =
            Get-ObjectValue `
                -Object $AgentConfig `
                -Names @(
                    "Server",
                    "server",
                    "ServerURL",
                    "server_url",
                    "serverUrl"
                )


        $WebsiteURL =
            Convert-ToHttpsOrigin `
                -Value ([string]$AgentServer)
    }
    catch {

        Write-Warning `
            "Could not read website URL from installed Agent config."
    }
}


# ------------------------------------------------------------
# FINAL FALLBACK
# ------------------------------------------------------------

if (-not $WebsiteURL) {

    $WebsiteURL =
        Convert-ToHttpsOrigin `
            -Value $DefaultWebsiteURL
}


if (-not $WebsiteURL) {

    throw `
        "Could not resolve SentinelGrid website URL."
}


# ============================================================
# READ EXISTING BETA RELEASES
# ============================================================

Write-Host ""
Write-Host "Reading existing beta releases..."


$PublishedReleaseRows =
    @()


$ReleaseURL =
    "$SupabaseURL/rest/v1/agent_releases?channel=eq.$Channel&platform=eq.$Platform&architecture=eq.$Architecture&select=version,signer_sha256,published_at&limit=500"


try {

    $PublishedReleaseRows =
        @(
            Invoke-SupabaseRest `
                -Method GET `
                -Uri $ReleaseURL `
                -Headers $AdminHeaders
        )
}
catch {

    # Older schema fallback.

    $FallbackReleaseURL =
        "$SupabaseURL/rest/v1/agent_releases?channel=eq.$Channel&platform=eq.$Platform&architecture=eq.$Architecture&select=version,published_at&limit=500"


    $PublishedReleaseRows =
        @(
            Invoke-SupabaseRest `
                -Method GET `
                -Uri $FallbackReleaseURL `
                -Headers $AdminHeaders
        )
}


$ReleaseCandidates =
    @()


foreach ($release in $PublishedReleaseRows) {

    $VersionText =
        [string](
            Get-ObjectValue `
                -Object $release `
                -Names @(
                    "version"
                )
        )


    $ParsedVersion =
        Convert-ToSemanticVersion `
            -Value $VersionText


    if (-not $ParsedVersion) {
        continue
    }


    $ReleaseCandidates +=
        [PSCustomObject]@{
            Version = $ParsedVersion
            Row     = $release
        }
}


# ============================================================
# BUILD ORGANIZATION CANDIDATE LIST
#
# Priority:
#
# 1. -OrganizationId parameter
# 2. AlexCorp preferred org
# 3. beta + automatic_updates=true orgs
# 4. any beta org
# ============================================================

Write-Host ""
Write-Host "Resolving release verification organization..."


$CandidateOrganizationIds =
    New-Object `
        "System.Collections.Generic.List[string]"


function Add-OrganizationCandidate {

    param(
        [string]$Value
    )


    if (
        [string]::IsNullOrWhiteSpace(
            $Value
        )
    ) {
        return
    }


    if (
        -not $CandidateOrganizationIds.Contains(
            $Value
        )
    ) {

        $CandidateOrganizationIds.Add(
            $Value
        )
    }
}


if ($OrganizationId) {

    Add-OrganizationCandidate `
        -Value $OrganizationId
}
else {

    Add-OrganizationCandidate `
        -Value $PreferredOrganizationId
}


# ------------------------------------------------------------
# AUTO-UPDATE BETA ORGS
# ------------------------------------------------------------

$AutomaticSettingsURL =
    "$SupabaseURL/rest/v1/organization_agent_update_settings?channel=eq.$Channel&automatic_updates=eq.true&select=organization_id&limit=100"


$AutomaticSettingsRows =
    @(
        Invoke-SupabaseRest `
            -Method GET `
            -Uri $AutomaticSettingsURL `
            -Headers $AdminHeaders
    )


foreach ($row in $AutomaticSettingsRows) {

    $id =
        [string](
            Get-ObjectValue `
                -Object $row `
                -Names @(
                    "organization_id"
                )
        )


    Add-OrganizationCandidate `
        -Value $id
}


# ------------------------------------------------------------
# ALL BETA ORGS
# ------------------------------------------------------------

$BetaSettingsURL =
    "$SupabaseURL/rest/v1/organization_agent_update_settings?channel=eq.$Channel&select=organization_id&limit=100"


$BetaSettingsRows =
    @(
        Invoke-SupabaseRest `
            -Method GET `
            -Uri $BetaSettingsURL `
            -Headers $AdminHeaders
    )


foreach ($row in $BetaSettingsRows) {

    $id =
        [string](
            Get-ObjectValue `
                -Object $row `
                -Names @(
                    "organization_id"
                )
        )


    Add-OrganizationCandidate `
        -Value $id
}


if (
    $CandidateOrganizationIds.Count -eq 0
) {

    throw `
        "No candidate organizations were found for beta releases."
}


# ============================================================
# RESOLVE A VALID ORGANIZATION + CLIENT
# ============================================================

$ResolvedOrganizationID =
    $null

$ResolvedClientID =
    $null

$ResolvedClientName =
    $null

$OrganizationName =
    $null

$OwnerID =
    $null

$AutomaticUpdates =
    $false

$UpdateDelayHours =
    $null


foreach (
    $CandidateOrganizationID in
    $CandidateOrganizationIds
) {

    Write-Host ""
    Write-Host "Checking organization:"
    Write-Host "  $CandidateOrganizationID"


    $EncodedOrganizationID =
        [System.Uri]::EscapeDataString(
            $CandidateOrganizationID
        )


    $EncodedChannel =
        [System.Uri]::EscapeDataString(
            $Channel
        )


    # --------------------------------------------------------
    # VERIFY CHANNEL DIRECTLY THROUGH POSTGREST FILTER
    # --------------------------------------------------------

    $SettingsURL =
        "$SupabaseURL/rest/v1/organization_agent_update_settings?organization_id=eq.$EncodedOrganizationID&channel=eq.$EncodedChannel&select=organization_id,automatic_updates,update_delay_hours"


    $SettingsRows =
        @(
            Invoke-SupabaseRest `
                -Method GET `
                -Uri $SettingsURL `
                -Headers $AdminHeaders
        )


    if (
        $SettingsRows.Count -eq 0
    ) {

        Write-Host `
            "  Not configured for beta."

        continue
    }


    if (
        $SettingsRows.Count -gt 1
    ) {

        throw @"
More than one update settings row exists for:

Organization:
$CandidateOrganizationID

Channel:
$Channel
"@
    }


    $SettingsRow =
        $SettingsRows[0]


    $AutomaticUpdatesValue =
        Get-ObjectValue `
            -Object $SettingsRow `
            -Names @(
                "automatic_updates"
            )


    $UpdateDelayValue =
        Get-ObjectValue `
            -Object $SettingsRow `
            -Names @(
                "update_delay_hours"
            )


    Write-Host "  Channel:           $Channel"
    Write-Host "  Automatic updates: $AutomaticUpdatesValue"
    Write-Host "  Update delay:      $UpdateDelayValue"


    # --------------------------------------------------------
    # FIND REAL CLIENT
    # --------------------------------------------------------

    $ClientURL =
        "$SupabaseURL/rest/v1/clients?organization_id=eq.$EncodedOrganizationID&select=id,name,organization_id&order=name.asc&limit=1"


    $ClientRows =
        @(
            Invoke-SupabaseRest `
                -Method GET `
                -Uri $ClientURL `
                -Headers $AdminHeaders
        )


    Write-Host "  Clients returned:  $($ClientRows.Count)"


    if (
        $ClientRows.Count -eq 0
    ) {

        continue
    }


    $ClientRow =
        $ClientRows[0]


    # Helpful diagnostic.
    Write-Host "  Client REST row:"

    Write-Host (
        $ClientRow |
        ConvertTo-Json `
            -Depth 10 `
            -Compress
    )


    $CandidateClientID =
        [string](
            Get-ObjectValue `
                -Object $ClientRow `
                -Names @(
                    "id"
                )
        )


    $CandidateClientName =
        [string](
            Get-ObjectValue `
                -Object $ClientRow `
                -Names @(
                    "name"
                )
        )


    $CandidateClientOrg =
        [string](
            Get-ObjectValue `
                -Object $ClientRow `
                -Names @(
                    "organization_id"
                )
        )


    if (
        [string]::IsNullOrWhiteSpace(
            $CandidateClientID
        )
    ) {

        Write-Host `
            "  Client row has no usable id."

        continue
    }


    if (
        $CandidateClientOrg -and
        $CandidateClientOrg -ne
        $CandidateOrganizationID
    ) {

        throw @"
Client organization mismatch.

Client:
$CandidateClientID

Expected organization:
$CandidateOrganizationID

Actual organization:
$CandidateClientOrg
"@
    }


    # --------------------------------------------------------
    # GET ORGANIZATION OWNER
    # --------------------------------------------------------

    $OrganizationURL =
        "$SupabaseURL/rest/v1/organizations?id=eq.$EncodedOrganizationID&select=id,name,owner_id"


    $OrganizationRows =
        @(
            Invoke-SupabaseRest `
                -Method GET `
                -Uri $OrganizationURL `
                -Headers $AdminHeaders
        )


    if (
        $OrganizationRows.Count -ne 1
    ) {

        Write-Host `
            "  Organization owner could not be resolved."

        continue
    }


    $OrganizationRow =
        $OrganizationRows[0]


    $CandidateOwnerID =
        [string](
            Get-ObjectValue `
                -Object $OrganizationRow `
                -Names @(
                    "owner_id"
                )
        )


    $CandidateOrganizationName =
        [string](
            Get-ObjectValue `
                -Object $OrganizationRow `
                -Names @(
                    "name"
                )
        )


    if (
        [string]::IsNullOrWhiteSpace(
            $CandidateOwnerID
        )
    ) {

        Write-Host `
            "  Organization has no owner_id."

        continue
    }


    # --------------------------------------------------------
    # VALID CONTEXT FOUND
    # --------------------------------------------------------

    $ResolvedOrganizationID =
        $CandidateOrganizationID

    $ResolvedClientID =
        $CandidateClientID

    $ResolvedClientName =
        $CandidateClientName

    $OrganizationName =
        $CandidateOrganizationName

    $OwnerID =
        $CandidateOwnerID


    $AutomaticUpdates =
        (
            $AutomaticUpdatesValue -eq
            $true
        )


    $UpdateDelayHours =
        $UpdateDelayValue


    break
}


if (
    -not $ResolvedOrganizationID -or
    -not $ResolvedClientID -or
    -not $OwnerID
) {

    # --------------------------------------------------------
    # DIAGNOSTICS
    # --------------------------------------------------------

    Write-Host ""
    Write-Host "No usable release context was found."
    Write-Host ""
    Write-Host "Candidate organizations:"


    foreach ($id in $CandidateOrganizationIds) {

        Write-Host "  $id"
    }


    throw @"
Could not resolve a beta organization with:

- valid organization settings
- at least one real client
- valid owner_id

No database data was modified.
"@
}


Write-Host ""
Write-Host "Release verification context:"
Write-Host "  Organization:      $OrganizationName"
Write-Host "  Organization ID:   $ResolvedOrganizationID"
Write-Host "  Client:            $ResolvedClientName"
Write-Host "  Client ID:         $ResolvedClientID"
Write-Host "  Channel:           $Channel"
Write-Host "  Automatic updates: $AutomaticUpdates"
Write-Host "  Update delay:      $UpdateDelayHours hour(s)"


# ============================================================
# DETERMINE TRUSTED SIGNER
# ============================================================

Write-Host ""
Write-Host "Resolving trusted development signer..."


$InstalledSigner =
    $null

$PublishedSigner =
    $null

$EnvironmentSigner =
    $null


# ------------------------------------------------------------
# OPTIONAL ENV SIGNER
# ------------------------------------------------------------

$EnvironmentSignerRaw =
    [System.Environment]::GetEnvironmentVariable(
        "SENTINELGRID_DEV_UPDATE_SIGNER_SHA256",
        "Process"
    )


if (
    $EnvironmentSignerRaw -and
    $EnvironmentSignerRaw -match
    '^[A-Fa-f0-9]{64}$'
) {

    $EnvironmentSigner =
        $EnvironmentSignerRaw.ToUpperInvariant()
}


# ------------------------------------------------------------
# INSTALLED AGENT SIGNER
# ------------------------------------------------------------

if (
    Test-Path `
        -LiteralPath $InstalledAgent
) {

    try {

        $TrustRaw =
            & $InstalledAgent `
                -update-build-info


        if (
            $LASTEXITCODE -ne 0
        ) {

            throw `
                "Installed Agent trust probe returned exit code $LASTEXITCODE."
        }


        $Trust =
            $TrustRaw |
            ConvertFrom-Json


        $SignerValue =
            [string](
                Get-ObjectValue `
                    -Object $Trust `
                    -Names @(
                        "signer_sha256"
                    )
            )


        if (
            $SignerValue -and
            $SignerValue.ToUpperInvariant() -match
            '^[A-F0-9]{64}$'
        ) {

            $InstalledSigner =
                $SignerValue.ToUpperInvariant()
        }


        $DevelopmentValue =
            Get-ObjectValue `
                -Object $Trust `
                -Names @(
                    "development"
                )


        $SourceEligibleValue =
            Get-ObjectValue `
                -Object $Trust `
                -Names @(
                    "source_eligible"
                )


        if (
            $DevelopmentValue -ne $true -or
            $SourceEligibleValue -ne $true
        ) {

            throw `
                "Installed Agent is not an eligible development update source."
        }
    }
    catch {

        Write-Warning `
            "Installed Agent trust probe unavailable: $($_.Exception.Message)"


        $InstalledSigner =
            $null
    }
}


# ------------------------------------------------------------
# LATEST PUBLISHED SIGNER
# ------------------------------------------------------------

if (
    $ReleaseCandidates.Count -gt 0
) {

    $NewestPublished =
        $ReleaseCandidates |
        Sort-Object `
            Version `
            -Descending |
        Select-Object -First 1


    $RemoteSigner =
        [string](
            Get-ObjectValue `
                -Object $NewestPublished.Row `
                -Names @(
                    "signer_sha256"
                )
        )


    if (
        $RemoteSigner -and
        $RemoteSigner.ToUpperInvariant() -match
        '^[A-F0-9]{64}$'
    ) {

        $PublishedSigner =
            $RemoteSigner.ToUpperInvariant()
    }
}


# ============================================================
# SIGNER TRUST RESOLUTION
#
# Priority:
#
# 1. Installed eligible Agent
# 2. Latest published beta release
# 3. Environment variable ONLY as final fallback
#
# A stale environment variable must NEVER override a signer
# already trusted by an installed SentinelGrid Agent.
# ============================================================

$SignerSHA256 =
    $null


# ------------------------------------------------------------
# INSTALLED AGENT + PUBLISHED RELEASE MUST AGREE
# ------------------------------------------------------------

if (
    $InstalledSigner -and
    $PublishedSigner -and
    $InstalledSigner -ne $PublishedSigner
) {

    throw @"
SIGNER TRUST CHAIN MISMATCH.

Installed Agent trusts:
$InstalledSigner

Latest published beta release uses:
$PublishedSigner

This is a real trust-chain conflict.

Release aborted.
"@
}


# ------------------------------------------------------------
# TRUST INSTALLED AGENT FIRST
# ------------------------------------------------------------

if ($InstalledSigner) {

    $SignerSHA256 =
        $InstalledSigner


    if (
        $EnvironmentSigner -and
        $EnvironmentSigner -ne $InstalledSigner
    ) {

        Write-Warning @"
Ignoring stale SENTINELGRID_DEV_UPDATE_SIGNER_SHA256.

Environment:
$EnvironmentSigner

Installed Agent:
$InstalledSigner

The installed eligible Agent is authoritative.
"@
    }
}


# ------------------------------------------------------------
# OTHERWISE TRUST EXISTING PUBLISHED RELEASE
# ------------------------------------------------------------

elseif ($PublishedSigner) {

    $SignerSHA256 =
        $PublishedSigner


    if (
        $EnvironmentSigner -and
        $EnvironmentSigner -ne $PublishedSigner
    ) {

        Write-Warning @"
Ignoring stale SENTINELGRID_DEV_UPDATE_SIGNER_SHA256.

Environment:
$EnvironmentSigner

Published beta signer:
$PublishedSigner

The existing beta trust chain is authoritative.
"@
    }
}


# ------------------------------------------------------------
# ENVIRONMENT IS ONLY A BOOTSTRAP FALLBACK
# ------------------------------------------------------------

elseif ($EnvironmentSigner) {

    Write-Warning @"
No installed/published signer could be resolved.

Using SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 as bootstrap fallback.
"@

    $SignerSHA256 =
        $EnvironmentSigner
}


if (-not $SignerSHA256) {

    throw @"
Could not determine the trusted development signer.

Checked:

- installed SentinelGrid Agent
- published beta release metadata
- SENTINELGRID_DEV_UPDATE_SIGNER_SHA256

Release aborted.
"@
}


Write-Host "Trusted signer:"
Write-Host "  $SignerSHA256"

# ============================================================
# FIND SIGNING CERTIFICATE + PRIVATE KEY
# ============================================================

Write-Host ""
Write-Host "Searching signing certificate..."


$Certificate =
    $null

$CertificateStore =
    $null


foreach ($store in @(
    "CurrentUser",
    "LocalMachine"
)) {

    $StorePath =
        "Cert:\$store\My"


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
                $store

            break
        }
    }


    if ($Certificate) {
        break
    }
}


if (-not $Certificate) {

    throw @"
Trusted signing certificate was not found with a private key.

Required SHA256:
$SignerSHA256

Searched:
Cert:\CurrentUser\My
Cert:\LocalMachine\My
"@
}


$CertificateThumbprint =
    $Certificate.Thumbprint


if (
    $CertificateThumbprint -notmatch
    '^[A-Fa-f0-9]{40}$'
) {

    throw `
        "Resolved certificate has an invalid SHA1 thumbprint."
}


Write-Host "Signing certificate found."
Write-Host "  Store:      $CertificateStore"
Write-Host "  Thumbprint: $CertificateThumbprint"


# ============================================================
# VERSION CALCULATION
# ============================================================

$LocalVersionText =
    (
        Get-Content `
            -LiteralPath $VersionFile `
            -Raw
    ).Trim()


$LocalVersion =
    Convert-ToSemanticVersion `
        -Value $LocalVersionText


if (-not $LocalVersion) {

    throw `
        "Invalid agent\VERSION: $LocalVersionText"
}


$HighestVersion =
    $LocalVersion


foreach ($candidate in $ReleaseCandidates) {

    if (
        $candidate.Version -gt
        $HighestVersion
    ) {

        $HighestVersion =
            $candidate.Version
    }
}


$CurrentVersion =
    $HighestVersion.ToString()


$NextPatch =
    $HighestVersion.Build + 1


if (
    $HighestVersion.Major -gt 255 -or
    $HighestVersion.Minor -gt 255 -or
    $NextPatch -gt 65535
) {

    throw `
        "Next version exceeds MSI version limits."
}


$NextVersion =
    "$($HighestVersion.Major).$($HighestVersion.Minor).$NextPatch"


$OutputDirectory =
    Join-Path `
        $Root `
        "dist\agent\$NextVersion"


# ============================================================
# EXISTING BUILD REUSE
#
# Scenario:
#
# build succeeded
# publication failed
#
# We do NOT need to rebuild the same immutable artifacts.
# ============================================================

$ReuseExistingBuild =
    $false


if (
    Test-Path `
        -LiteralPath $OutputDirectory
) {

    Write-Host ""
    Write-Host "Existing build found:"
    Write-Host "  $OutputDirectory"


    $RequiredArtifacts = @(
        "SentinelGridAgent.exe",
        "SentinelGridUpdater.exe",
        "SentinelGridRDP.exe",
        "SentinelGridAgent.msi",
        "manifest.json",
        "checksums.txt"
    )


    $BuildComplete =
        $true


    foreach ($name in $RequiredArtifacts) {

        $ArtifactPath =
            Join-Path `
                $OutputDirectory `
                $name


        if (
            -not (
                Test-Path `
                    -LiteralPath $ArtifactPath
            )
        ) {

            $BuildComplete =
                $false

            break
        }
    }


    if ($BuildComplete) {

        try {

            $ManifestPath =
                Join-Path `
                    $OutputDirectory `
                    "manifest.json"


            $Manifest =
                Get-Content `
                    -LiteralPath $ManifestPath `
                    -Raw |
                ConvertFrom-Json


            if (
                [string]$Manifest.version -ne
                $NextVersion
            ) {

                throw `
                    "Manifest version mismatch."
            }


            if (
                [string]$Manifest.channel -ne
                $Channel
            ) {

                throw `
                    "Manifest channel mismatch."
            }


            if (
                [string]$Manifest.server_url -ne
                $WebsiteURL
            ) {

                throw `
                    "Manifest server URL mismatch."
            }


            $ValidationArguments = @(
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                $ValidateScript,
                "-ArtifactDirectory",
                $OutputDirectory,
                "-ExpectedVersion",
                $NextVersion,
                "-ExpectedChannel",
                $Channel,
                "-ExpectedSignerSHA256",
                $SignerSHA256
            )


            Invoke-ExternalChecked `
                -Executable $PowerShellExe `
                -Arguments $ValidationArguments `
                -Label "Validate existing $NextVersion build"


            $ReuseExistingBuild =
                $true


            Write-Host ""
            Write-Host "Existing build is valid."
            Write-Host "It will be reused."
        }
        catch {

            Write-Warning `
                "Existing build cannot be reused: $($_.Exception.Message)"
        }
    }


    # --------------------------------------------------------
    # ARCHIVE INVALID / PARTIAL BUILD
    # --------------------------------------------------------

    if (-not $ReuseExistingBuild) {

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
            Get-Date `
                -Format "yyyyMMdd-HHmmss"


        $ArchivePath =
            Join-Path `
                $ArchiveRoot `
                "$NextVersion-invalid-$Timestamp"


        Write-Host ""
        Write-Host "Archiving incomplete/invalid build:"
        Write-Host "  $ArchivePath"


        Move-Item `
            -LiteralPath $OutputDirectory `
            -Destination $ArchivePath
    }
}


# ============================================================
# CLEAN STALE GENERATED VERSION RESOURCES
#
# Only required if we need a new build.
# ============================================================

if (-not $ReuseExistingBuild) {

    $GeneratedResourceFiles = @(
        (
            Join-Path `
                $Root `
                "agent\cmd\sentinelgrid-agent\version_windows_amd64.syso"
        ),
        (
            Join-Path `
                $Root `
                "agent\cmd\sentinelgrid-updater\version_windows_amd64.syso"
        ),
        (
            Join-Path `
                $Root `
                "agent\cmd\sentinelgrid-rdp\version_windows_amd64.syso"
        )
    )


    foreach (
        $ResourceFile in
        $GeneratedResourceFiles
    ) {

        if (
            Test-Path `
                -LiteralPath $ResourceFile
        ) {

            Write-Host ""
            Write-Host "Removing stale generated resource:"
            Write-Host "  $ResourceFile"


            Remove-Item `
                -LiteralPath $ResourceFile `
                -Force
        }
    }
}


# ============================================================
# RELEASE SUMMARY
# ============================================================

Write-Host ""
Write-Host "============================================"
Write-Host " SentinelGrid Beta Release"
Write-Host "============================================"

Write-Host ""
Write-Host "Website:"
Write-Host "  $WebsiteURL"

Write-Host ""
Write-Host "Organization:"
Write-Host "  $OrganizationName"

Write-Host ""
Write-Host "Client:"
Write-Host "  $ResolvedClientName"

Write-Host ""
Write-Host "Channel:"
Write-Host "  $Channel"

Write-Host ""
Write-Host "Version:"
Write-Host "  $CurrentVersion -> $NextVersion"

Write-Host ""
Write-Host "Automatic updates:"
Write-Host "  $AutomaticUpdates"

Write-Host ""
Write-Host "Update delay:"
Write-Host "  $UpdateDelayHours hour(s)"

Write-Host ""
Write-Host "Reuse existing build:"
Write-Host "  $ReuseExistingBuild"

Write-Host ""
Write-Host "Signer:"
Write-Host "  $SignerSHA256"

Write-Host ""


# ============================================================
# BUILD + SIGN + VALIDATE
#
# IMPORTANT:
#
# We intentionally do NOT use -Publish here.
#
# The expensive build happens BEFORE creation of the
# short-lived enrollment token.
# ============================================================

if (-not $ReuseExistingBuild) {

    $BuildArguments = @(
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        $BuildScript,
        "-Version",
        $NextVersion,
        "-ServerURL",
        $WebsiteURL,
        "-Channel",
        $Channel,
        "-DevSign",
        "-DevCertificateThumbprint",
        $CertificateThumbprint,
        "-DevSignerSHA256",
        $SignerSHA256,
        "-DevCertificateStore",
        $CertificateStore
    )


    Invoke-ExternalChecked `
        -Executable $PowerShellExe `
        -Arguments $BuildArguments `
        -Label "Build, sign and validate $NextVersion"
}


# ============================================================
# VERIFY REQUIRED BUILD OUTPUT
# ============================================================

foreach ($name in @(
    "SentinelGridAgent.exe",
    "SentinelGridUpdater.exe",
    "SentinelGridRDP.exe",
    "SentinelGridAgent.msi",
    "manifest.json",
    "checksums.txt"
)) {

    $path =
        Join-Path `
            $OutputDirectory `
            $name


    if (
        -not (
            Test-Path `
                -LiteralPath $path
        )
    ) {

        throw `
            "Required artifact missing after build: $path"
    }
}


# ============================================================
# SAVE CURRENT PROCESS ENVIRONMENT
# ============================================================

$PublishEnvironmentNames = @(
    "SENTINELGRID_PUBLISH_SUPABASE_URL",
    "SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY",
    "SENTINELGRID_PUBLISH_WEBSITE_URL",
    "SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN",
    "SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT"
)


$SavedEnvironment =
    @()


foreach (
    $name in
    $PublishEnvironmentNames
) {

    $SavedEnvironment +=
        Save-EnvironmentVariable `
            -Name $name
}


# ============================================================
# TEMPORARY ENROLLMENT TOKEN + PUBLICATION
# ============================================================

$TokenCreated =
    $false

$TokenHash =
    $null

$EnrollmentToken =
    $null

$PublicationSucceeded =
    $false


try {

    # ========================================================
    # CREATE SHORT-LIVED VERIFICATION TOKEN
    # ========================================================

    Write-Host ""
    Write-Host "Creating temporary publication token..."


    $EnrollmentToken =
        "SG-ENROLL-" +
        (
            New-SecureRandomHex `
                -ByteCount 32
        )


    $TokenHash =
        Get-SHA256String `
            -Value $EnrollmentToken


    $ExpiresAt =
        (Get-Date).
            ToUniversalTime().
            AddMinutes(30).
            ToString("o")


    $TokenData = @{
        organization_id = $ResolvedOrganizationID
        client_id       = $ResolvedClientID
        site_id         = $null
        token_hash      = $TokenHash
        created_by      = $OwnerID
        expires_at      = $ExpiresAt
    }


    $TokenBody =
        $TokenData |
        ConvertTo-Json `
            -Compress


    $TokenURL =
        "$SupabaseURL/rest/v1/agent_enrollment_tokens"


    $TokenHeaders =
        $AdminHeaders.Clone()


    $TokenHeaders["Prefer"] =
        "return=minimal"


    $null =
        Invoke-SupabaseRest `
            -Method POST `
            -Uri $TokenURL `
            -Headers $TokenHeaders `
            -Body $TokenBody


    $TokenCreated =
        $true


    Write-Host "Temporary publication token created."
    Write-Host "  Expires: $ExpiresAt"


    # ========================================================
    # TEMPORARY PUBLISH ENVIRONMENT
    # ========================================================

    $env:SENTINELGRID_PUBLISH_SUPABASE_URL =
        $SupabaseURL


    # Historical variable name.
    # Can contain legacy service_role or modern sb_secret key.
    $env:SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY =
        $AdminKey


    $env:SENTINELGRID_PUBLISH_WEBSITE_URL =
        $WebsiteURL


    $env:SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN =
        $EnrollmentToken


    $env:SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT =
        "true"


    # ========================================================
    # PUBLISH
    # ========================================================

    $PublishArguments = @(
        $PublishScript,
        $OutputDirectory,
        $NextVersion,
        $Channel,
        $SignerSHA256
    )


    Invoke-ExternalChecked `
        -Executable $NodeExe `
        -Arguments $PublishArguments `
        -Label "Publish and verify $NextVersion"


    $PublicationSucceeded =
        $true
}
finally {

    # ========================================================
    # ALWAYS TRY TO REVOKE TEMP TOKEN
    # ========================================================

    if (
        $TokenCreated -and
        $TokenHash
    ) {

        try {

            Write-Host ""
            Write-Host "Revoking temporary publication token..."


            $EncodedTokenHash =
                [System.Uri]::EscapeDataString(
                    $TokenHash
                )


            $RevokeURL =
                "$SupabaseURL/rest/v1/agent_enrollment_tokens?token_hash=eq.$EncodedTokenHash"


            $RevokeBody =
                @{
                    revoked_at =
                        (Get-Date).
                            ToUniversalTime().
                            ToString("o")
                } |
                ConvertTo-Json `
                    -Compress


            $RevokeHeaders =
                $AdminHeaders.Clone()


            $RevokeHeaders["Prefer"] =
                "return=minimal"


            $null =
                Invoke-SupabaseRest `
                    -Method PATCH `
                    -Uri $RevokeURL `
                    -Headers $RevokeHeaders `
                    -Body $RevokeBody


            Write-Host `
                "Temporary publication token revoked."
        }
        catch {

            Write-Warning @"
Could not automatically revoke the temporary publication token.

Token hash:
$TokenHash

The plaintext token was NOT printed.

Check public.agent_enrollment_tokens manually.

Error:
$($_.Exception.Message)
"@
        }
    }


    # ========================================================
    # ALWAYS RESTORE PREVIOUS PROCESS ENVIRONMENT
    # ========================================================

    foreach (
        $state in
        $SavedEnvironment
    ) {

        Restore-EnvironmentVariable `
            -State $state
    }
}


# ============================================================
# PUBLICATION MUST HAVE COMPLETED
# ============================================================

if (-not $PublicationSucceeded) {

    throw @"
Release publication did not complete successfully.

agent\VERSION was NOT changed.

Artifacts were kept at:

$OutputDirectory

If they are valid, the next execution can reuse them instead
of rebuilding the same version.
"@
}


# ============================================================
# UPDATE VERSION ONLY AFTER SUCCESS
# ============================================================

[System.IO.File]::WriteAllText(
    $VersionFile,
    "$NextVersion`n",
    [System.Text.UTF8Encoding]::new(
        $false
    )
)


# ============================================================
# SUCCESS
# ============================================================

Write-Host ""
Write-Host "============================================"
Write-Host " RELEASE COMPLETE"
Write-Host "============================================"

Write-Host ""
Write-Host "Version:"
Write-Host "  $CurrentVersion -> $NextVersion"

Write-Host ""
Write-Host "Channel:"
Write-Host "  $Channel"

Write-Host ""
Write-Host "Organization:"
Write-Host "  $OrganizationName"

Write-Host ""
Write-Host "Client:"
Write-Host "  $ResolvedClientName"

Write-Host ""
Write-Host "Artifacts:"
Write-Host "  $OutputDirectory"

Write-Host ""
Write-Host "Publication:"
Write-Host "  succeeded"

Write-Host ""
Write-Host "Website verification:"
Write-Host "  succeeded"

Write-Host ""
Write-Host "Temporary token:"
Write-Host "  revoked"

Write-Host ""
Write-Host "agent\VERSION:"
Write-Host "  $NextVersion"

Write-Host ""
Write-Host "============================================"
Write-Host ""