[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Version)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Expected major.minor.patch version.' }
$root = Join-Path (Split-Path -Parent $PSScriptRoot) 'agent'
$location = Get-Location
try {
    Set-Location -LiteralPath $root
    foreach ($entry in @(
        @{ Name = 'Agent'; Directory = 'sentinelgrid-agent'; File = 'SentinelGridAgent.exe' },
        @{ Name = 'Updater'; Directory = 'sentinelgrid-updater'; File = 'SentinelGridUpdater.exe' },
        @{ Name = 'Remote'; Directory = 'sentinelgrid-rdp'; File = 'SentinelGridRDP.exe' }
    )) {
        $output = Join-Path $root "cmd\$($entry.Directory)\version"
        if (Test-Path -LiteralPath ($output + '_windows_amd64.syso')) { throw 'Version resource already exists; finish or clean up the previous build first.' }
        $icon = if ($entry.Directory -eq 'sentinelgrid-rdp') { '--icon=' + (Join-Path $root 'cmd\sentinelgrid-rdp\sentinelgrid-mark.ico') } else { '--icon=' }
        & go tool go-winres simply --arch amd64 --out $output --manifest none --product-version $Version --file-version $Version `
            --product-name "SentinelGrid $($entry.Name)" --file-description "SentinelGrid $($entry.Name)" --original-filename $entry.File $icon
        if ($LASTEXITCODE -ne 0) { throw "Version resource generation failed: $($entry.Name)" }
    }
} finally { Set-Location -LiteralPath $location.Path }
