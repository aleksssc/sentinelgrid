[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$build = Join-Path $PSScriptRoot 'build-agent.ps1'
foreach ($name in @('build-agent.ps1', 'validate-agent-release.ps1')) {
    $tokens = $null; $errors = $null
    [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name), [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw "PowerShell parse failed: $name" }
}
$cases = @(
    @{ Arguments = @('-DevRepairProductCode', '954F563F-B9A8-4B6C-AF67-E50DE8E52376'); Reason = '-DevRepairProductCode requires' },
    @{ Arguments = @('-DevSign', '-Publish', '-DevRepairProductCode', '954F563F-B9A8-4B6C-AF67-E50DE8E52376'); Reason = '-DevRepairProductCode requires' },
    @{ Arguments = @('-DevSign', '-DevRepairProductCode', '00000000-0000-0000-0000-000000000000'); Reason = '-DevRepairProductCode requires' },
    @{ Arguments = @('-Dev', '-Publish'); Reason = '-Publish requires a complete signed release' },
    @{ Arguments = @('-Dev', '-ServerURL', 'http://insecure.example'); Reason = 'ServerURL must be an HTTPS enrollment origin' },
    @{ Arguments = @('-DevSign', '-Dev'); Reason = '-DevSign cannot be combined' },
    @{ Arguments = @('-DevSign', '-Sign'); Reason = '-DevSign cannot be combined' },
    @{ Arguments = @('-DevSign', '-SkipMSI'); Reason = '-DevSign cannot be combined' },
    @{ Arguments = @('-DevSign'); Reason = '-DevSign requires explicit -Channel beta or dev' },
    @{ Arguments = @('-DevSign', '-Channel', 'beta', '-DevSignerSHA256', 'bad'); Reason = 'explicit development certificate SHA256 fingerprint' },
    @{ Arguments = @('-DevSign', '-Channel', 'beta', '-TrustedSignerSHA256', 'bad'); Reason = 'separate development certificate/pin parameters' },
    @{ Arguments = @('-Sign', '-DevSignerSHA256', 'bad'); Reason = 'Development certificate/pin parameters require -DevSign' },
    @{ Arguments = @('-DevCertificateStore', 'CurrentUser'); Reason = 'Development certificate/pin parameters require -DevSign' },
    @{ Arguments = @('-Dev', '-Channel', 'beta'); Reason = '-Dev requires the dev channel' },
    @{ Arguments = @('-SkipMSI'); Reason = '-SkipMSI is allowed only with explicit -Dev' }
)
foreach ($case in $cases) {
    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $build, '-Version', '0.1.6') + $case.Arguments
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = Join-Path $PSHOME 'powershell.exe'
    $start.Arguments = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Build mode rejection test timed out.' }
        $text = ($stdout.Result + $stderr.Result) -replace '\s+', ' '
        if ($process.ExitCode -eq 0 -or -not $text.Contains($case.Reason)) { throw "Unsafe or unexpected build mode result: $text" }
        Write-Host "PASS: $($case.Arguments -join ' ')"
    } finally { $process.Dispose() }
}
Write-Host "$($cases.Count) fail-closed build mode tests and PowerShell syntax checks passed. No certificate, artifacts, services or trust stores were changed."
