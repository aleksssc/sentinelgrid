[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$build = Join-Path $PSScriptRoot 'build-agent.ps1'
$cases = @(
    @{ Arguments = @('-DevSign', '-Dev'); Reason = '-DevSign cannot be combined' },
    @{ Arguments = @('-DevSign', '-Sign'); Reason = '-DevSign cannot be combined' },
    @{ Arguments = @('-DevSign', '-SkipMSI'); Reason = '-DevSign cannot be combined' },
    @{ Arguments = @('-DevSign'); Reason = '-DevSign requires explicit -Channel beta or dev' },
    @{ Arguments = @('-DevSign', '-Channel', 'beta', '-DevSignerSHA256', 'bad'); Reason = 'explicit development certificate SHA256 fingerprint' },
    @{ Arguments = @('-DevSign', '-Channel', 'beta', '-TrustedSignerSHA256', 'bad'); Reason = 'separate development certificate/pin parameters' },
    @{ Arguments = @('-Sign', '-DevSignerSHA256', 'bad'); Reason = 'Development certificate/pin parameters require -DevSign' },
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
Write-Host 'Nine fail-closed build mode tests passed. No certificate, artifacts, services or trust stores were changed.'
