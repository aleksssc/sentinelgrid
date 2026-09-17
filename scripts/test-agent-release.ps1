[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$tests = 0
function Assert-Equal($Actual, $Expected) {
    if ($Actual -cne $Expected) { throw "Expected '$Expected', got '$Actual'." }
    $script:tests++
}
function Assert-Rejected([scriptblock]$Action, [string]$Reason) {
    try { & $Action; throw 'TEST_UNEXPECTED_SUCCESS' }
    catch {
        if ($_.Exception.Message -notmatch $Reason -or $_.Exception.Message -eq 'TEST_UNEXPECTED_SUCCESS') { throw }
        $script:tests++
    }
}
$releaseAst = $null
$validatorAst = $null
foreach ($name in @('release-agent.ps1', 'release-beta.ps1', 'setup-signing.ps1', 'setup-dev-code-signing.ps1', 'agent-signing-common.ps1', 'build-agent.ps1', 'validate-agent-release.ps1')) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw "$name parse errors: $($errors.Message -join '; ')" }
    $tests++
    if ($name -eq 'release-agent.ps1') { $releaseAst = $ast }
    if ($name -eq 'validate-agent-release.ps1') { $validatorAst = $ast }
}
# Load functions without executing the release, reading credentials or provisioning certificates.
foreach ($function in $releaseAst.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($function.Extent.Text))
}
. (Join-Path $PSScriptRoot 'agent-signing-common.ps1')
foreach ($channel in @('dev', 'beta')) {
    Assert-Equal (Get-ReleaseVersion $channel '' '0.1.8' @()) '0.1.9'
    Assert-Equal (Get-ReleaseVersion $channel '' '0.1.8' @([pscustomobject]@{ version = '0.1.10' }, [pscustomobject]@{ version = '0.1.9' })) '0.1.11'
}
Assert-Equal (Get-ReleaseVersion 'stable' '1.0.0' '1.1.0' @([pscustomobject]@{ version = '0.9.0' })) '1.0.0'
Assert-Rejected { Get-ReleaseVersion 'stable' '' '0.1.0' @() } 'explicit -Version'
foreach ($value in @('1.0.0', '0.9.0')) { Assert-Rejected { Get-ReleaseVersion 'stable' $value '0.1.0' @([pscustomobject]@{ version = '1.0.0' }) } 'newer than every published' }
foreach ($value in @('01.0.0', '256.0.0', '1.256.0', '1.0.65536', '1.0.0-beta', '1.0.0+build', "1.0.0`n", '999999999999999999.0.0')) { Assert-Rejected { ConvertTo-ReleaseVersion $value } 'Version' }
Assert-Equal (ConvertTo-ReleaseVersion '255.255.65535').ToString() '255.255.65535'
Assert-Rejected { Get-ReleaseVersion 'beta' '' '1.0.65535' @() } 'exceeds MSI'
Assert-Equal (Get-OrganizationChannel @()) 'stable'
foreach ($channel in @('dev', 'beta', 'stable')) { Assert-Equal (Get-OrganizationChannel @([pscustomobject]@{ channel = $channel })) $channel }
Assert-Rejected { Get-OrganizationChannel @([pscustomobject]@{ channel = 'canary' }) } 'invalid effective channel'
Assert-Rejected { Get-OrganizationChannel @([pscustomobject]@{ channel = 'stable' }, [pscustomobject]@{ channel = 'beta' }) } 'duplicate'
Assert-Equal (Assert-ReleaseOrigin 'https://example.com/' 'Test URL') 'https://example.com'
foreach ($value in @('', 'http://example.com', 'https://user@example.com', 'https://example.com/path', 'https://example.com/?a=1', 'https://example.com/#fragment')) { Assert-Rejected { Assert-ReleaseOrigin $value 'Test URL' } 'explicit HTTPS origin' }
Assert-Equal (Get-ReleaseSetting @('SENTINELGRID_TEST_SETTING') @('SENTINELGRID_TEST_SETTING="quoted-value"')) 'quoted-value'
Assert-Rejected { Get-ReleaseSetting @('SENTINELGRID_TEST_SETTING') @('SENTINELGRID_TEST_SETTING=a', 'SENTINELGRID_TEST_SETTING=b') } 'Duplicate release setting'
& {
    $websiteNames = @('NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'NEXT_PUBLIC_SITE_URL', 'APP_URL')
    $savedWebsiteEnvironment = @{}
    $configPath = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'SentinelGrid\agent.json'
    $configExists = $false
    $configJSON = '{}'
    $configReadFails = $false
    function Test-Path {
        param($LiteralPath)
        Assert-Equal $LiteralPath $configPath
        return $configExists
    }
    function Get-Content {
        param($LiteralPath, [switch]$Raw)
        Assert-Equal $LiteralPath $configPath
        if ($configReadFails) { throw 'simulated config read failure' }
        return $configJSON
    }
    try {
        foreach ($name in $websiteNames) {
            $savedWebsiteEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        Assert-Equal @($releaseAst.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'WebsiteURL' -and $_.StaticType -eq [string] }).Count 1
        Assert-Equal (Get-ReleaseWebsiteURL '' @()) 'https://sentinelgrid-one.vercel.app'
        Assert-Equal (Get-ReleaseWebsiteURL '' @('NEXT_PUBLIC_SITE_URL=http://localhost:3000')) 'https://sentinelgrid-one.vercel.app'
        $ordered = @('NEXT_PUBLIC_APP_URL=https://app.example', 'NEXT_PUBLIC_BASE_URL=https://base.example', 'NEXT_PUBLIC_SITE_URL=https://site.example', 'APP_URL=https://last.example')
        foreach ($index in 0..3) {
            $lines = @($ordered)
            for ($i = 0; $i -lt $index; $i++) { $lines[$i] = $websiteNames[$i] + '=http://localhost:3000' }
            Assert-Equal (Get-ReleaseWebsiteURL '' $lines) ($ordered[$index] -split '=', 2)[1]
        }
        foreach ($value in @('', 'not a URL', '/relative', 'https://', 'http://localhost:3000', 'ftp://example.com', 'https://user:password@example.com', 'https://example.com/?a=1', 'https://example.com/#fragment')) {
            Assert-Equal (Convert-ToHttpsOrigin $value) $null
            Assert-Equal (Get-ReleaseWebsiteURL '' @("NEXT_PUBLIC_APP_URL=$value", 'APP_URL=https://last.example')) 'https://last.example'
        }
        Assert-Equal (Get-ReleaseWebsiteURL '' @('NEXT_PUBLIC_APP_URL="https://app.example/path"')) 'https://app.example'
        Assert-Equal (Get-ReleaseWebsiteURL '' @('APP_URL=https://app.example:8443/path')) 'https://app.example:8443'
        $env:NEXT_PUBLIC_APP_URL = 'https://process.example'
        Assert-Equal (Get-ReleaseWebsiteURL '' $ordered) 'https://process.example'
        $env:NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
        Assert-Equal (Get-ReleaseWebsiteURL '' $ordered) 'https://base.example'
        $env:NEXT_PUBLIC_APP_URL = $null
        $configExists = $true
        $configReadFails = $true
        Assert-Equal (Get-ReleaseWebsiteURL '' $ordered) 'https://app.example'
        Assert-Equal (Get-ReleaseWebsiteURL 'https://override.example/' $ordered) 'https://override.example'
        foreach ($value in @(' ', 'http://localhost:3000', 'https://user@example.com', 'https://example.com/path', 'https://example.com/?a=1', 'https://example.com/#fragment')) {
            Assert-Rejected { Get-ReleaseWebsiteURL $value $ordered } 'explicit HTTPS origin'
        }
        Assert-Equal (Get-ReleaseWebsiteURL '' @() -WarningVariable warnings) 'https://sentinelgrid-one.vercel.app'
        Assert-Equal @($warnings).Count 1
        $configReadFails = $false
        foreach ($name in @('Server', 'server', 'ServerURL', 'server_url', 'serverUrl')) {
            $configJSON = @{ $name = 'https://installed.example/path' } | ConvertTo-Json
            Assert-Equal (Get-ReleaseWebsiteURL '' @('NEXT_PUBLIC_SITE_URL=http://localhost:3000')) 'https://installed.example'
        }
        $configJSON = '{"Server":"https://first.example","ServerURL":"https://second.example"}'
        Assert-Equal (Get-ReleaseWebsiteURL '' @()) 'https://first.example'
        foreach ($configJSON in @('{}', 'null', '{"Server":"http://localhost:3000"}', '{"Server":"https://user@example.com"}', '{"Server":"https://example.com/?q=1"}', '{"Server":"https://example.com/#fragment"}')) {
            Assert-Equal (Get-ReleaseWebsiteURL '' @()) 'https://sentinelgrid-one.vercel.app'
        }
        $configJSON = '{malformed'
        Assert-Equal (Get-ReleaseWebsiteURL '' @() -WarningVariable warnings) 'https://sentinelgrid-one.vercel.app'
        Assert-Equal @($warnings).Count 1
    } finally {
        foreach ($name in $savedWebsiteEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedWebsiteEnvironment[$name], 'Process') }
    }
}
& {
    $backend = 'https://isolated.example'
    $adminHeaders = @{}
    function Invoke-RestMethod { Write-Output -NoEnumerate $mockRestRows }
    foreach ($count in @(0, 1, 100)) {
        $mockRestRows = @(for ($i = 0; $i -lt $count; $i++) { [pscustomobject]@{ id = $i } })
        Assert-Equal @(Invoke-ReleaseRest 'GET' 'test?select=id').Count $count
    }
    function Invoke-RestMethod {
        param($Uri)
        $rows = if ($Uri.EndsWith('offset=0')) { @(0..99 | ForEach-Object { [pscustomobject]@{ id = $_ } }) } else { @([pscustomobject]@{ id = 100 }) }
        Write-Output -NoEnumerate $rows
    }
    $all = @(Get-ReleaseRows 'test?select=id')
    Assert-Equal $all.Count 101
    Assert-Equal $all[100].id 100
}

$orgId = '20000000-0000-4000-8000-000000000001'
$ownerId = '10000000-0000-4000-8000-000000000001'
$clientId = '30000000-0000-4000-8000-000000000001'
function Invoke-ReleaseRest([string]$Method, [string]$Path, [object]$Body = $null) {
    if ($Method -ne 'GET') { throw 'Unexpected backend mutation in unit test.' }
    if ($Path.StartsWith('organization_agent_update_settings?organization_id=')) { return $script:settings }
    if ($Path.StartsWith('organizations?id=')) { return [pscustomobject]@{ id = $orgId; owner_id = $ownerId } }
    if ($Path.StartsWith('clients?organization_id=')) { return [pscustomobject]@{ id = $clientId; organization_id = $orgId } }
    throw "Unexpected query: $Path"
}
foreach ($channel in @('dev', 'beta', 'stable')) {
    $script:settings = @([pscustomobject]@{ channel = $channel })
    Assert-Equal (Get-ReleaseOrganization $orgId $channel).OrganizationId $orgId
    foreach ($other in @('dev', 'beta', 'stable') | Where-Object { $_ -ne $channel }) { Assert-Rejected { Get-ReleaseOrganization $orgId $other } 'No fallback' }
}
$script:settings = @()
Assert-Equal (Get-ReleaseOrganization $orgId 'stable').OrganizationId $orgId
Assert-Rejected { Get-ReleaseOrganization $orgId 'beta' } 'No fallback'
Assert-Rejected { Get-ReleaseOrganization 'not-a-uuid' 'stable' } 'UUID'

$names = @('SENTINELGRID_SIGN_CERT_THUMBPRINT', 'SENTINELGRID_UPDATE_SIGNER_SHA256', 'SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT', 'SENTINELGRID_DEV_UPDATE_SIGNER_SHA256', 'SENTINELGRID_SIGN_CERT_STORE', 'SENTINELGRID_DEV_SIGN_CERT_STORE', 'SENTINELGRID_SIGN_TIMESTAMP_URL', 'SENTINELGRID_DEV_SIGN_TIMESTAMP_URL')
$saved = @{}
$certificates = [Collections.Generic.List[Security.Cryptography.X509Certificates.X509Certificate2]]::new()
$rsa = [Security.Cryptography.RSACng]::new(2048)
function New-TestCertificate([string]$Subject, [bool]$CodeSigning, [DateTimeOffset]$Before, [DateTimeOffset]$After) {
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new($Subject, $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    if ($CodeSigning) {
        $oids = [Security.Cryptography.OidCollection]::new()
        [void]$oids.Add([Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
        $request.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $false))
    }
    $certificate = $request.CreateSelfSigned($Before, $After)
    $certificates.Add($certificate)
    return $certificate
}
try {
    foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
    Assert-Rejected { Resolve-ReleaseSigning 'stable' } 'Production signer not configured.[\s\S]*setup-signing.ps1 -Profile Production'
    Assert-Rejected { Resolve-ReleaseSigning 'beta' } 'Could not determine the trusted beta signer'
    Assert-Rejected { Resolve-ReleaseSigning 'dev' } 'Beta signer not configured'
    $now = [DateTimeOffset]::UtcNow
    $prodCertificate = New-TestCertificate $SentinelGridProductionSubject $true $now.AddDays(-1) $now.AddDays(1)
    $devCertificate = New-TestCertificate $SentinelGridDevelopmentSubject $true $now.AddDays(-1) $now.AddDays(1)
    Assert-CodeSigningCertificate $prodCertificate $false
    Assert-CodeSigningCertificate $devCertificate $true
    Assert-Rejected { Assert-CodeSigningCertificate $devCertificate $false } 'cannot sign a production'
    Assert-Rejected { Assert-CodeSigningCertificate $prodCertificate $true } 'explicit SentinelGrid DEVELOPMENT ONLY'
    $publicOnly = [Security.Cryptography.X509Certificates.X509Certificate2]::new($prodCertificate.RawData)
    try { Assert-Rejected { Assert-CodeSigningCertificate $publicOnly $false } 'private key' } finally { $publicOnly.Dispose() }
    $noEKU = New-TestCertificate $SentinelGridProductionSubject $false $now.AddDays(-1) $now.AddDays(1)
    Assert-Rejected { Assert-CodeSigningCertificate $noEKU $false } 'Code Signing EKU'
    $expired = New-TestCertificate $SentinelGridProductionSubject $true $now.AddDays(-2) $now.AddDays(-1)
    Assert-Rejected { Assert-CodeSigningCertificate $expired $false } 'currently valid'
    $future = New-TestCertificate $SentinelGridProductionSubject $true $now.AddDays(1) $now.AddDays(2)
    Assert-Rejected { Assert-CodeSigningCertificate $future $false } 'currently valid'
    & {
        function Test-Path { param($LiteralPath); return $true }
        function Get-Item { param($LiteralPath); if ($LiteralPath.EndsWith($prodCertificate.Thumbprint)) { return $prodCertificate }; return $devCertificate }
        function Get-ChildItem { param($LiteralPath); return $devCertificate }
        $env:SENTINELGRID_SIGN_CERT_THUMBPRINT = $prodCertificate.Thumbprint
        $env:SENTINELGRID_UPDATE_SIGNER_SHA256 = Get-SignerSHA256 $prodCertificate
        $env:SENTINELGRID_SIGN_TIMESTAMP_URL = 'https://timestamp.example.com'
        $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT = $devCertificate.Thumbprint
        $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 = Get-SignerSHA256 $devCertificate
        Assert-Equal (Resolve-ReleaseSigning 'stable').Fingerprint (Get-SignerSHA256 $prodCertificate)
        Assert-Equal (Resolve-ReleaseSigning 'beta').Fingerprint (Get-SignerSHA256 $devCertificate)
        Assert-Equal (Resolve-ReleaseSigning 'dev').Development $true
        $env:SENTINELGRID_UPDATE_SIGNER_SHA256 = 'A' * 64
        Assert-Rejected { Resolve-ReleaseSigning 'stable' } 'explicit embedded signer pin'
        $env:SENTINELGRID_SIGN_CERT_THUMBPRINT = $devCertificate.Thumbprint
        $env:SENTINELGRID_UPDATE_SIGNER_SHA256 = Get-SignerSHA256 $devCertificate
        Assert-Rejected { Resolve-ReleaseSigning 'stable' } 'cannot sign a production'
    }
    & {
        $pin = Get-SignerSHA256 $devCertificate
        $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT = $null
        $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 = $null
        $visited = [Collections.Generic.List[string]]::new()
        $available = $devCertificate
        function Get-ChildItem {
            param($LiteralPath)
            $visited.Add($LiteralPath)
            if ($LiteralPath -eq "Cert:\$availableStore\My") { return $available }
            return $prodCertificate
        }
        foreach ($availableStore in @('CurrentUser', 'LocalMachine')) {
            $visited.Clear()
            $resolved = Resolve-ReleaseSigning 'beta' -PublishedSigner $pin.ToLowerInvariant()
            Assert-Equal $resolved.Store $availableStore
            Assert-Equal $resolved.Thumbprint $devCertificate.Thumbprint
            Assert-Equal $resolved.Pins $pin
            Assert-Equal $resolved.Development $true
            $expectedStores = if ($availableStore -eq 'CurrentUser') { 'Cert:\CurrentUser\My' } else { 'Cert:\CurrentUser\My,Cert:\LocalMachine\My' }
            Assert-Equal ($visited -join ',') $expectedStores
            Assert-Equal $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT $null
            Assert-Equal $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 $null
        }
        $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT = $prodCertificate.Thumbprint
        $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 = 'A' * 64
        $resolved = Resolve-ReleaseSigning 'beta' -PublishedSigner $pin -WarningVariable warnings
        Assert-Equal @($warnings).Count 2
        Assert-Equal $resolved.Pins $pin
        Assert-Equal $resolved.Thumbprint $devCertificate.Thumbprint
        Assert-Equal $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT $prodCertificate.Thumbprint
        Assert-Equal $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 ('A' * 64)
        $env:SENTINELGRID_DEV_SIGN_CERT_THUMBPRINT = $null
        $env:SENTINELGRID_DEV_UPDATE_SIGNER_SHA256 = $pin
        Assert-Equal (Resolve-ReleaseSigning 'beta').Pins $pin
        Assert-Rejected { Resolve-ReleaseSigning 'beta' -PublishedSigner 'invalid' } 'Invalid published beta signer'
        Assert-Rejected { Resolve-ReleaseSigning 'beta' -PublishedSigner ('B' * 64) } 'not found with a private key'
        $available = [Security.Cryptography.X509Certificates.X509Certificate2]::new($devCertificate.RawData)
        try { Assert-Rejected { Resolve-ReleaseSigning 'beta' -PublishedSigner $pin } 'not found with a private key' } finally { $available.Dispose() }
        foreach ($invalid in @($noEKU, $expired, $future, $prodCertificate)) {
            $available = $invalid
            Assert-Rejected { Resolve-ReleaseSigning 'beta' -PublishedSigner (Get-SignerSHA256 $invalid) } 'Code Signing EKU|currently valid|explicit SentinelGrid DEVELOPMENT ONLY'
        }
        function Get-ChildItem { throw 'simulated certificate store access denied' }
        Assert-Rejected { Resolve-ReleaseSigning 'beta' -PublishedSigner $pin } 'certificate store access denied'
    }
    & {
        $function = $validatorAst.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-Signature' }, $false)
        . ([scriptblock]::Create($function.Extent.Text))
        $testSigner = $prodCertificate
        $signatureStatus = 'Valid'
        function Get-AuthenticodeSignature { [pscustomobject]@{ Status = $signatureStatus; SignerCertificate = $testSigner } }
        $ExpectedChannel = 'stable'
        $ExpectedSignerSHA256 = Get-SignerSHA256 $prodCertificate
        $ExpectedCertificateThumbprint = $prodCertificate.Thumbprint
        $manifest = [pscustomobject]@{ development_update_build = $false; trusted_signer_sha256 = @($ExpectedSignerSHA256) }
        foreach ($artifact in @('SentinelGridAgent.exe', 'SentinelGridUpdater.exe', 'SentinelGridRDP.exe', 'SentinelGridVideo.dll', 'SentinelGridAgent.msi')) {
            Assert-Signature $artifact
            foreach ($signatureStatus in @('NotSigned', 'HashMismatch', 'NotTrusted')) {
                Assert-Rejected { Assert-Signature $artifact } 'Authenticode is not Valid'
            }
            $signatureStatus = 'Valid'
            $ExpectedSignerSHA256 = 'A' * 64
            Assert-Rejected { Assert-Signature $artifact } 'Signer SHA256 differs'
            $ExpectedSignerSHA256 = Get-SignerSHA256 $prodCertificate
        }
        $ExpectedCertificateThumbprint = $devCertificate.Thumbprint
        Assert-Rejected { Assert-Signature 'mock.msi' } 'configured certificate thumbprint'
        $ExpectedCertificateThumbprint = ''
        $testSigner = $devCertificate
        $ExpectedSignerSHA256 = Get-SignerSHA256 $devCertificate
        Assert-Rejected { Assert-Signature 'mock.msi' } 'cannot sign a production'
    }
    & {
        $checks = ($validatorAst.EndBlock.Statements | Where-Object {
            $_.Extent.StartOffset -ge $validatorAst.Extent.Text.IndexOf('if ($ExpectedSignerSHA256 -notmatch') -and
            $_.Extent.StartOffset -lt $validatorAst.Extent.Text.IndexOf('$server = [uri]$manifest.server_url')
        } | ForEach-Object { $_.Extent.Text }) -join "`n"
        $ExpectedSignerSHA256 = Get-SignerSHA256 $prodCertificate
        $ExpectedCertificateThumbprint = $prodCertificate.Thumbprint
        $ExpectedChannel = 'stable'; $ExpectedVersion = '1.0.0'; $ArtifactDirectory = 'mock-bundle'
        $fixture = @{ installation_artifact = 'msi'; update_protocol = 2; schema_version = 1; product = 'SentinelGridAgent'; version = $ExpectedVersion; channel = $ExpectedChannel; platform = 'windows'; architecture = 'amd64'; signed = $true; development_update_build = $false; trusted_signer_sha256 = @($ExpectedSignerSHA256) }
        function Resolve-Path { [pscustomobject]@{ Path = '.' } }
        function Get-Content { $fixture | ConvertTo-Json }
        . ([scriptblock]::Create($checks))
        Assert-Equal $manifest.development_update_build $false
        $fixture.development_update_build = $true
        Assert-Rejected { . ([scriptblock]::Create($checks)) } 'Development artifacts cannot be stable'
        $fixture.development_update_build = 'false'
        Assert-Rejected { . ([scriptblock]::Create($checks)) } 'must be a boolean'
    }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
    foreach ($certificate in $certificates) { $certificate.Dispose() }
    $rsa.Dispose()
}

# Exercise the actual orchestration statements with isolated files and mocked external boundaries.
$main = ($releaseAst.EndBlock.Statements | Where-Object { $_.Extent.StartOffset -ge $releaseAst.Extent.Text.IndexOf('$lock = $null') } | ForEach-Object { $_.Extent.Text }) -join "`n"
$main = $main.Replace('$PSScriptRoot', ("'" + $PSScriptRoot.Replace("'", "''") + "'"))
$testRoot = Join-Path (Split-Path -Parent $PSScriptRoot) ('dist\validation\release-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$successScenarios = @('dev', 'beta', 'stable', 'beta-website-override', 'stable-website-override')
try {
    foreach ($scenario in ($successScenarios + @('bundle-failure', 'signer-mismatch', 'build-failure', 'token-failure', 'publish-failure', 'revoke-failure', 'revoke-unacknowledged', 'version-conflict'))) {
        & {
            $root = Join-Path $testRoot $scenario
            New-Item -ItemType Directory -Path (Join-Path $root 'agent') -Force | Out-Null
            [IO.File]::WriteAllText((Join-Path $root 'agent\VERSION'), "0.1.0`n")
            $Channel = if ($scenario -in $successScenarios) { ($scenario -split '-')[0] } else { 'beta' }
            $Version = if ($Channel -eq 'stable') { '1.0.0' } else { '' }
            $OrganizationId = $orgId
            $WebsiteURL = if ($scenario -like '*-website-override') { 'https://override.example/' } else { '' }
            $expectedWebsite = if ($WebsiteURL) { 'https://override.example' } else { 'https://sentinelgrid-one.vercel.app' }
            $events = [Collections.Generic.List[string]]::new()
            $beforeEnvironment = @{}
            foreach ($name in @('SENTINELGRID_PUBLISH_SUPABASE_URL', 'SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY', 'SENTINELGRID_PUBLISH_WEBSITE_URL', 'SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN', 'SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT')) { $beforeEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
            function Resolve-ReleaseSigning($Channel, $PublishedSigner) {
                if ($Channel -eq 'beta') { Assert-Equal $PublishedSigner ('A' * 64) } else { Assert-Equal $PublishedSigner $null }
                $fingerprint = if ($scenario -eq 'signer-mismatch') { 'C' * 64 } else { 'A' * 64 }
                return [pscustomobject]@{ Development = ($Channel -ne 'stable'); Thumbprint = ('B' * 40); Fingerprint = $fingerprint; Pins = $fingerprint; Store = 'CurrentUser'; TimestampUrl = 'https://timestamp.example.com' }
            }
            function Find-SignTool { return 'mock-signtool' }
            function Get-ReleaseSetting($Names, $Lines) {
                if ($Names[0] -eq 'SENTINELGRID_PUBLISH_SERVICE_ROLE_KEY') { return 'sb_secret_test_only_not_a_real_key' }
                if ($Names[0] -eq 'NEXT_PUBLIC_SITE_URL') { return 'http://localhost:3000' }
                if ($Names[0] -in @('NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_BASE_URL', 'APP_URL')) { return $null }
                return 'https://isolated.example'
            }
            function Get-ReleaseOrganization($RequestedId, $Channel) { return [pscustomobject]@{ OrganizationId = $orgId; ClientId = $clientId; OwnerId = $ownerId } }
            function Get-ReleaseRows($Path) {
                Assert-Equal $Path "agent_releases?channel=eq.$Channel&platform=eq.windows&architecture=eq.amd64&select=id,version&order=id.asc"
                return [pscustomobject]@{ id = '40000000-0000-4000-8000-000000000001'; version = '0.1.0' }
            }
            function Test-Path {
                param([string]$LiteralPath)
                if ($LiteralPath -like '*SentinelGrid\SentinelGridAgent.exe') { throw 'Publication must not inspect the installed Agent, even when it is unsigned or belongs to another channel.' }
                if ($LiteralPath -like '*SentinelGrid\agent.json') { return $false }
                return Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath
            }
            function Get-AuthenticodeSignature { throw 'No installed-Agent Authenticode preflight is allowed in orchestration.' }
            function Invoke-ReleaseRest($Method, $Path, $Body) {
                if ($Method -eq 'GET') {
                    Assert-Equal $Path 'agent_release_bundles?release_id=eq.40000000-0000-4000-8000-000000000001&select=signer_sha256,development_build'
                    if ($scenario -eq 'bundle-failure') { return @() }
                    return [pscustomobject]@{ signer_sha256 = ('A' * 64); development_build = ($Channel -ne 'stable') }
                }
                if ($Method -eq 'POST') {
                    $events.Add('token')
                    if ($scenario -eq 'token-failure') { throw 'simulated token failure after server commit' }
                    return [pscustomobject]@{ token_hash = $Body.token_hash }
                }
                if ($Method -eq 'PATCH') {
                    $events.Add('revoke')
                    if ($scenario -eq 'revoke-failure') { throw 'simulated revoke failure' }
                    if ($scenario -eq 'revoke-unacknowledged') { return @() }
                    return [pscustomobject]@{ token_hash = $tokenHash; revoked_at = $Body.revoked_at }
                }
                throw 'Unexpected backend request.'
            }
            function Invoke-ReleaseTool($Executable, $Arguments, $Label) {
                if ($Label -like 'Build,*') {
                    $events.Add('build')
                    Assert-Equal ($Arguments -contains '-DevSign') ($Channel -ne 'stable')
                    Assert-Equal ($Arguments -contains '-Sign') ($Channel -eq 'stable')
                    Assert-Equal $Arguments[($Arguments.IndexOf('-Channel') + 1)] $Channel
                    Assert-Equal $Arguments[($Arguments.IndexOf('-ServerURL') + 1)] $expectedWebsite
                    $pinArgument = if ($Channel -eq 'stable') { '-TrustedSignerSHA256' } else { '-DevSignerSHA256' }
                    $thumbprintArgument = if ($Channel -eq 'stable') { '-CertificateThumbprint' } else { '-DevCertificateThumbprint' }
                    Assert-Equal $Arguments[($Arguments.IndexOf($pinArgument) + 1)] ('A' * 64)
                    Assert-Equal $Arguments[($Arguments.IndexOf($thumbprintArgument) + 1)] ('B' * 40)
                    if ($scenario -eq 'build-failure') { throw 'simulated build failure' }
                } elseif ($Label -like 'Publication,*') {
                    $events.Add('publish')
                    Assert-Equal $env:SENTINELGRID_PUBLISH_WEBSITE_URL $expectedWebsite
                    Assert-Equal $env:SENTINELGRID_PUBLISH_ALLOW_DEVELOPMENT ($Channel -ne 'stable').ToString().ToLowerInvariant()
                    Assert-Equal $Arguments[3] $Channel
                    Assert-Equal $Arguments[4] ('A' * 64)
                    if ($env:SENTINELGRID_PUBLISH_ENROLLMENT_TOKEN -notmatch '^SG-ENROLL-[a-f0-9]{64}$') { throw 'Invalid temporary token.' }
                    if ($scenario -eq 'publish-failure') { throw 'simulated publish failure' }
                    if ($scenario -eq 'version-conflict') { [IO.File]::WriteAllText((Join-Path $root 'agent\VERSION'), "2.0.0`n") }
                } else { throw 'Unexpected external command.' }
            }
            $failed = $false
            try { . ([scriptblock]::Create($main)) } catch { $failed = $true; if ($scenario -in $successScenarios) { throw }; Write-Host "Expected $scenario rejection: $($_.Exception.Message)" }
            $success = $scenario -in $successScenarios
            Assert-Equal $failed (-not $success)
            $expectedVersion = if ($scenario -eq 'version-conflict') { '2.0.0' } elseif ($success) { if ($Channel -eq 'stable') { '1.0.0' } else { '0.1.1' } } else { '0.1.0' }
            Assert-Equal (Get-Content -LiteralPath (Join-Path $root 'agent\VERSION') -Raw).Trim() $expectedVersion
            $expectedEvents = if ($scenario -in @('bundle-failure', 'signer-mismatch')) { '' } elseif ($scenario -eq 'build-failure') { 'build' } elseif ($scenario -eq 'token-failure') { 'build,token,revoke' } else { 'build,token,publish,revoke' }
            Assert-Equal ($events -join ',') $expectedEvents
            foreach ($name in $beforeEnvironment.Keys) { Assert-Equal ([Environment]::GetEnvironmentVariable($name, 'Process')) $beforeEnvironment[$name] }
            $handle = [IO.File]::Open((Join-Path $root 'dist\agent\.release.lock'), 'Open', 'ReadWrite', 'None')
            $handle.Dispose()
        }
    }
} finally { Remove-Item -LiteralPath $testRoot -Recurse -Force }
Write-Host "$tests release checks passed. No live backend, installed Agent, certificate store or real VERSION was changed."
