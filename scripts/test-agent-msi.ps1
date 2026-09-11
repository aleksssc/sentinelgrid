[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BaselineMSI,
    [Parameter(Mandatory = $true)][string]$TargetMSI
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installer = New-Object -ComObject WindowsInstaller.Installer
function Read-Rows($Database, [string]$Query, [int]$Columns) {
    $view = $Database.OpenView($Query)
    try {
        $null = $view.Execute()
        while ($null -ne ($record = $view.Fetch())) {
            try {
                $row = @()
                for ($i = 1; $i -le $Columns; $i++) { $row += $record.StringData($i) }
                Write-Output -NoEnumerate $row
            } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) }
        }
    } finally { $null = $view.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) }
}
$databases = @()
try {
    foreach ($path in @($BaselineMSI, $TargetMSI)) { $databases += $installer.OpenDatabase((Resolve-Path -LiteralPath $path).Path, 0) }
    $components = @()
    $versions = @()
    foreach ($database in $databases) {
        $properties = @{}
        foreach ($row in (Read-Rows $database 'SELECT `Property`, `Value` FROM `Property`' 2)) { $properties[$row[0]] = $row[1] }
        if ($properties['UpgradeCode'] -ne '{B632A689-8C9E-4E77-BF7C-5E9C4A012901}') { throw 'Unexpected UpgradeCode.' }
        $version = $properties['ProductVersion']
        $versions += [version]$version
        $files = @(Read-Rows $database 'SELECT `File`, `Version` FROM `File`' 2)
        if ($files.Count -ne 2) { throw 'Endpoint MSI must contain exactly Agent and Updater.' }
        foreach ($file in $files) {
            if ([version]$file[1] -ne [version]($version + '.0')) { throw "MSI/PE file version mismatch: $($file[0])" }
        }
        $map = @{}
        foreach ($row in (Read-Rows $database 'SELECT `Component`, `ComponentId` FROM `Component`' 2)) { $map[$row[0]] = $row[1] }
        $components += $map
    }
    if ($versions[1] -le $versions[0]) { throw 'Target must be newer than baseline.' }
    foreach ($name in $components[0].Keys) { if ($components[1][$name] -ne $components[0][$name]) { throw 'Component identity changed across versions.' } }
    $target = $databases[1]
    $sequence = @{}
    foreach ($row in (Read-Rows $target 'SELECT `Action`, `Sequence` FROM `InstallExecuteSequence`' 2)) { $sequence[$row[0]] = [int]$row[1] }
    foreach ($action in @('EnrollSentinelGridAgent', 'ValidateSentinelGridConfig')) {
        if ($sequence[$action] -le $sequence['InstallServices'] -or $sequence[$action] -ge $sequence['StartServices']) { throw 'Enrollment/config validation must precede service start.' }
    }
    $actions = @{}
    foreach ($row in (Read-Rows $target 'SELECT `Action`, `Type` FROM `CustomAction`' 2)) { $actions[$row[0]] = [int]$row[1] }
    foreach ($action in @('EnrollSentinelGridAgent', 'ValidateSentinelGridConfig')) {
        if (($actions[$action] -band 0xC00) -ne 0xC00 -or ($actions[$action] -band 0xC0) -ne 0) { throw 'Enrollment/config validation must be checked, deferred and non-impersonated.' }
    }
    $launch = @(Read-Rows $target 'SELECT `Condition` FROM `LaunchCondition`' 1)
    if (-not ($launch | Where-Object { $_[0] -eq 'Installed OR NOT SG_SAME_VERSION' })) { throw 'Same-version duplicate-product guard is absent.' }
    Write-Host "PASS: MSI $($versions[0]) -> $($versions[1]) metadata, real PE versions, stable components, same-version guard and checked SYSTEM enrollment sequencing."
    Write-Host 'Read-only MSI database inspection only. No installation, repair, upgrade or uninstall was performed.'
} finally {
    foreach ($database in $databases) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer)
}
