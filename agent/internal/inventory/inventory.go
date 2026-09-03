package inventory

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

/* =========================
   INVENTORY
========================= */

type Inventory struct {
	Hostname string `json:"hostname"`

	OS        string `json:"os"`
	OSVersion string `json:"os_version"`
	OSBuild   string `json:"os_build"`

	Arch string `json:"arch"`

	LocalIP    string `json:"local_ip"`
	MACAddress string `json:"mac_address"`

	Manufacturer string `json:"manufacturer"`
	Model        string `json:"model"`
	SerialNumber string `json:"serial_number"`

	CPUName string `json:"cpu_name"`

	RAMTotalBytes uint64 `json:"ram_total_bytes"`

	AgentVersion string `json:"agent_version"`
}

/* =========================
   WINDOWS SYSTEM INFO
========================= */

type windowsSystemInfo struct {
	OS string `json:"OS"`

	OSVersion string `json:"OSVersion"`

	OSBuild string `json:"OSBuild"`

	Manufacturer string `json:"Manufacturer"`

	Model string `json:"Model"`

	SerialNumber string `json:"SerialNumber"`

	CPUName string `json:"CPUName"`

	RAMTotalBytes uint64 `json:"RAMTotalBytes"`
}

/* =========================
   COLLECT
========================= */

func Collect(
	agentVersion ...string,
) (
	Inventory,
	error,
) {

	/* =========================
	   HOSTNAME
	========================= */

	hostname, err :=
		os.Hostname()

	if err != nil {

		return Inventory{},
			fmt.Errorf(
				"could not get hostname: %w",
				err,
			)
	}

	/* =========================
	   NETWORK
	========================= */

	localIP,
		macAddress :=
		collectPrimaryNetwork()

	/* =========================
	   VERSION
	========================= */

	version := ""

	if len(
		agentVersion,
	) > 0 {

		version =
			strings.TrimSpace(
				agentVersion[0],
			)
	}

	/* =========================
	   BASE INVENTORY
	========================= */

	result :=
		Inventory{
			Hostname:
				hostname,

			OS:
				runtime.GOOS,

			Arch:
				runtime.GOARCH,

			LocalIP:
				localIP,

			MACAddress:
				macAddress,

			AgentVersion:
				version,
		}

	/* =========================
	   WINDOWS DETAILS
	========================= */

	if runtime.GOOS !=
		"windows" {

		return result,
			nil
	}

	systemInfo, err :=
		collectWindowsSystemInfo()

	if err != nil {

		/*
			Inventory should still work
			even if CIM fails.

			Hostname/network data is still
			useful for enrollment.
		*/

		return result,
			nil
	}

	if strings.TrimSpace(
		systemInfo.OS,
	) != "" {

		result.OS =
			strings.TrimSpace(
				systemInfo.OS,
			)
	}

	result.OSVersion =
		strings.TrimSpace(
			systemInfo.OSVersion,
		)

	result.OSBuild =
		strings.TrimSpace(
			systemInfo.OSBuild,
		)

	result.Manufacturer =
		strings.TrimSpace(
			systemInfo.Manufacturer,
		)

	result.Model =
		strings.TrimSpace(
			systemInfo.Model,
		)

	result.SerialNumber =
		strings.TrimSpace(
			systemInfo.SerialNumber,
		)

	result.CPUName =
		strings.TrimSpace(
			systemInfo.CPUName,
		)

	result.RAMTotalBytes =
		systemInfo.RAMTotalBytes

	return result,
		nil
}

/* =========================
   WINDOWS SYSTEM INVENTORY
========================= */

func collectWindowsSystemInfo() (
	windowsSystemInfo,
	error,
) {

	const script = `
$ErrorActionPreference = "Stop"

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1

[PSCustomObject]@{
    OS = [string]$os.Caption
    OSVersion = [string]$os.Version
    OSBuild = [string]$os.BuildNumber
    Manufacturer = [string]$computer.Manufacturer
    Model = [string]$computer.Model
    SerialNumber = [string]$bios.SerialNumber
    CPUName = [string]$cpu.Name
    RAMTotalBytes = [uint64]$computer.TotalPhysicalMemory
} | ConvertTo-Json -Compress
`

	output, err :=
		runPowerShell(
			script,
		)

	if err != nil {

		return windowsSystemInfo{},
			err
	}

	var result windowsSystemInfo

	if err :=
		json.Unmarshal(
			output,
			&result,
		); err != nil {

		return windowsSystemInfo{},
			fmt.Errorf(
				"could not decode system inventory: %w",
				err,
			)
	}

	return result,
		nil
}

/* =========================
   PRIMARY NETWORK
========================= */

func collectPrimaryNetwork() (
	string,
	string,
) {

	interfaces, err :=
		net.Interfaces()

	if err != nil {

		return "",
			""
	}

	/*
		First attempt:

		Find an UP adapter with a private IPv4.
	*/

	for _,
		iface :=
		range interfaces {

		if iface.Flags&
			net.FlagUp == 0 {

			continue
		}

		if iface.Flags&
			net.FlagLoopback != 0 {

			continue
		}

		addresses, err :=
			iface.Addrs()

		if err != nil {

			continue
		}

		for _,
			address :=
			range addresses {

			ip :=
				parseAddressIP(
					address.String(),
				)

			if ip == nil ||
				ip.To4() == nil ||
				ip.IsLoopback() {

				continue
			}

			if !ip.IsPrivate() {

				continue
			}

			return ip.String(),
				iface.HardwareAddr.String()
		}
	}

	/*
		Fallback:

		Any non-loopback IPv4.
	*/

	for _,
		iface :=
		range interfaces {

		if iface.Flags&
			net.FlagUp == 0 {

			continue
		}

		if iface.Flags&
			net.FlagLoopback != 0 {

			continue
		}

		addresses, err :=
			iface.Addrs()

		if err != nil {

			continue
		}

		for _,
			address :=
			range addresses {

			ip :=
				parseAddressIP(
					address.String(),
				)

			if ip == nil ||
				ip.To4() == nil ||
				ip.IsLoopback() {

				continue
			}

			return ip.String(),
				iface.HardwareAddr.String()
		}
	}

	return "",
		""
}

/* =========================
   ADDRESS HELPER
========================= */

func parseAddressIP(
	value string,
) net.IP {

	ip,
		_,
		err :=
		net.ParseCIDR(
			value,
		)

	if err == nil {

		return ip
	}

	return net.ParseIP(
		value,
	)
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
				"PowerShell failed: %w: %s",
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