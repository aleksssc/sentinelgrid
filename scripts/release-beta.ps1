[CmdletBinding()]
param([string]$OrganizationId)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Write-Warning 'release-beta.ps1 is deprecated. Use .\scripts\release-agent.ps1 -Channel beta. This wrapper runs the same pipeline.'
$arguments = @{ Channel = 'beta' }
if ($PSBoundParameters.ContainsKey('OrganizationId')) { $arguments.OrganizationId = $OrganizationId }
& (Join-Path $PSScriptRoot 'release-agent.ps1') @arguments
