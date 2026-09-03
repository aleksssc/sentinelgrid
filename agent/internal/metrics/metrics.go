package metrics

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

/* =========================
   METRICS
========================= */

type Metrics struct {
	CPUUsage float64 `json:"cpu_usage"`

	RAMUsage float64 `json:"ram_usage"`

	RAMTotalBytes uint64 `json:"ram_total_bytes"`

	RAMUsedBytes uint64 `json:"ram_used_bytes"`

	DiskUsage float64 `json:"disk_usage"`

	DiskTotalBytes uint64 `json:"disk_total_bytes"`

	DiskUsedBytes uint64 `json:"disk_used_bytes"`

	UptimeSeconds uint64 `json:"uptime_seconds"`
}

/* =========================
   POWERSHELL RESPONSE
========================= */

type windowsMetrics struct {
	CPUUsage float64 `json:"CPUUsage"`

	RAMUsage float64 `json:"RAMUsage"`

	RAMTotalBytes uint64 `json:"RAMTotalBytes"`

	RAMUsedBytes uint64 `json:"RAMUsedBytes"`

	DiskUsage float64 `json:"DiskUsage"`

	DiskTotalBytes uint64 `json:"DiskTotalBytes"`

	DiskUsedBytes uint64 `json:"DiskUsedBytes"`

	UptimeSeconds uint64 `json:"UptimeSeconds"`
}

/* =========================
   COLLECT
========================= */

func Collect() (
	Metrics,
	error,
) {

	if runtime.GOOS !=
		"windows" {

		return Metrics{},
			fmt.Errorf(
				"metrics collection currently supports Windows only",
			)
	}

	const script = `
$ErrorActionPreference = "Stop"

$os = Get-CimInstance Win32_OperatingSystem

$processors = @(
    Get-CimInstance Win32_Processor
)

$cpuUsage = 0

if ($processors.Count -gt 0) {
    $cpuUsage = (
        $processors |
        Measure-Object -Property LoadPercentage -Average
    ).Average
}

$ramTotal = [double]$os.TotalVisibleMemorySize * 1024
$ramFree = [double]$os.FreePhysicalMemory * 1024
$ramUsed = $ramTotal - $ramFree

$ramUsage = 0

if ($ramTotal -gt 0) {
    $ramUsage = ($ramUsed / $ramTotal) * 100
}

$systemDrive = $env:SystemDrive

$disk = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $systemDrive + "'")

$diskTotal = 0
$diskFree = 0
$diskUsed = 0
$diskUsage = 0

if ($null -ne $disk) {

    $diskTotal = [double]$disk.Size
    $diskFree = [double]$disk.FreeSpace
    $diskUsed = $diskTotal - $diskFree

    if ($diskTotal -gt 0) {
        $diskUsage = ($diskUsed / $diskTotal) * 100
    }
}

$uptime = (
    (Get-Date) -
    $os.LastBootUpTime
).TotalSeconds

[PSCustomObject]@{
    CPUUsage = [math]::Round($cpuUsage, 2)

    RAMUsage = [math]::Round($ramUsage, 2)
    RAMTotalBytes = [uint64]$ramTotal
    RAMUsedBytes = [uint64]$ramUsed

    DiskUsage = [math]::Round($diskUsage, 2)
    DiskTotalBytes = [uint64]$diskTotal
    DiskUsedBytes = [uint64]$diskUsed

    UptimeSeconds = [uint64]$uptime
} | ConvertTo-Json -Compress
`

	output, err :=
		runPowerShell(
			script,
		)

	if err != nil {

		return Metrics{},
			err
	}

	var windowsData windowsMetrics

	if err :=
		json.Unmarshal(
			output,
			&windowsData,
		); err != nil {

		return Metrics{},
			fmt.Errorf(
				"could not decode metrics: %w",
				err,
			)
	}

	return Metrics{
			CPUUsage:
				windowsData.CPUUsage,

			RAMUsage:
				windowsData.RAMUsage,

			RAMTotalBytes:
				windowsData.RAMTotalBytes,

			RAMUsedBytes:
				windowsData.RAMUsedBytes,

			DiskUsage:
				windowsData.DiskUsage,

			DiskTotalBytes:
				windowsData.DiskTotalBytes,

			DiskUsedBytes:
				windowsData.DiskUsedBytes,

			UptimeSeconds:
				windowsData.UptimeSeconds,
		},
		nil
}

/* =========================
   POWERSHELL
========================= */

func runPowerShell(
	script string,
) (
	[]byte,
	error,
) {

	fullScript :=
		`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ` +
			script

	command :=
		exec.Command(
			"powershell.exe",
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			fullScript,
		)

	output, err :=
		command.CombinedOutput()

	if err != nil {

		return nil,
			fmt.Errorf(
				"PowerShell metrics collection failed: %w: %s",
				err,
				strings.TrimSpace(
					string(
						output,
					),
				),
			)
	}

	return []byte(
			strings.TrimSpace(
				string(
					output,
				),
			),
		),
		nil
}