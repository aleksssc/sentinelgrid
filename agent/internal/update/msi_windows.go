//go:build windows

package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	buildinfo "sentinelgrid/agent"
	"sentinelgrid/agent/internal/config"
)

const msiMetadataValidation = `
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $null; $view = $null
try {
 $db = $installer.OpenDatabase($env:SG_MSI_FILE, 0)
 $view = $db.OpenView('SELECT ` + "`Property`, `Value` FROM `Property`" + `')
 $view.Execute(); $properties = @{}
 while ($null -ne ($row = $view.Fetch())) {
  try { $properties[$row.StringData(1)] = $row.StringData(2) }
  finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($row) }
 }
 if ($properties['ProductName'] -cne 'SentinelGrid Agent' -or
     $properties['UpgradeCode'] -ine '{B632A689-8C9E-4E77-BF7C-5E9C4A012901}' -or
     $properties['ProductVersion'] -cne $env:SG_MSI_VERSION -or
     $properties['SENTINELGRID_CHANNEL'] -cne $env:SG_MSI_CHANNEL -or
     $properties['SENTINELGRID_UPDATE_PROTOCOL'] -cne '2' -or
     $properties['SENTINELGRID_UPDATE_DEVELOPMENT'] -cne $env:SG_MSI_DEVELOPMENT -or
     $properties['SENTINELGRID_UPDATE_SIGNERS'] -cne $env:SG_MSI_PINS) { throw 'MSI qualification mismatch' }
 $view.Close(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
 $view = $db.OpenView('SELECT ` + "`File`, `Version` FROM `File`" + `')
 $view.Execute(); $files = @{}
 while ($null -ne ($row = $view.Fetch())) {
  try { $files[$row.StringData(1)] = $row.StringData(2) }
  finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($row) }
 }
 foreach ($name in @('SentinelGridAgentExe','SentinelGridUpdaterExe','SentinelGridRDPExe')) {
  if (-not $files.ContainsKey($name) -or [version]$files[$name] -ne [version]($env:SG_MSI_VERSION + '.0')) { throw 'MSI payload version mismatch' }
 }
 foreach ($version in $files.Values) {
  if (-not $version -or [version]$version -ne [version]($env:SG_MSI_VERSION + '.0')) { throw 'MSI mixed payload versions' }
 }
 $summary = $db.SummaryInformation(0)
 try { if ($summary.Property(7) -notmatch '^x64;') { throw 'MSI architecture mismatch' } }
 finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($summary) }
} finally {
 if ($view) { $view.Close() }
 foreach ($item in @($view,$db,$installer)) { if ($item) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($item) } }
}
`

func (h *WindowsHost) msiEnvironment(release Release) []string {
	return []string{"SG_MSI_FILE=" + filepath.Join(h.Root, "candidate.msi"), "SG_MSI_VERSION=" + release.Version,
		"SG_MSI_CHANNEL=" + release.Channel, "SG_MSI_DEVELOPMENT=" + strconv.FormatBool(developmentBuild),
		"SG_MSI_PINS=" + strings.ToUpper(signerPins()), "SG_MSI_SIGNER=" + strings.ToUpper(release.SignerSHA256),
		"SG_MSI_HASH=" + strings.ToUpper(release.SHA256), "SG_MSI_SIZE=" + strconv.FormatInt(release.Size, 10), "SG_MSI_ROOT=" + h.Root}
}

func (h *WindowsHost) verifyMSI(ctx context.Context, release Release) error {
	if !sourceQualified() || release.ArtifactType != "msi" || release.UpdateProtocol != 2 || (developmentBuild && release.Channel != "beta" && release.Channel != "dev") {
		return fmt.Errorf("MSI release is not qualified for this build")
	}
	trusted := false
	for _, pin := range strings.Split(signerPins(), ",") {
		if strings.EqualFold(pin, release.SignerSHA256) {
			trusted = true
		}
	}
	if !trusted {
		return fmt.Errorf("release signer is not embedded in this build")
	}
	path := filepath.Join(h.Root, "candidate.msi")
	if h.candidate == nil {
		file, err := pinFile(path)
		if err != nil {
			return err
		}
		h.candidate = file
	}
	if err := VerifyArtifact(ctx, path, release, func(ctx context.Context, path string) error { return verifySignature(ctx, path, release.SignerSHA256) }); err != nil {
		return err
	}
	_, err := systemPowerShell(ctx, msiMetadataValidation, h.msiEnvironment(release)...)
	return err
}

func configDigest(path string) (string, error) {
	file, err := pinFile(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, io.LimitReader(file, 1048577)); err != nil {
		return "", err
	}
	info, err := file.Stat()
	if err != nil || info.Size() > 1048576 {
		return "", fmt.Errorf("invalid configuration size")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (h *WindowsHost) PrepareMSI(ctx context.Context, state State) (*MSIProgress, error) {
	if err := h.CanDispatch(ctx); err != nil {
		return nil, err
	}
	current, err := h.CurrentVersion(ctx)
	if err != nil || current != state.Previous {
		return nil, fmt.Errorf("installed Agent changed before MSI handoff")
	}
	if _, err := config.Load(); err != nil {
		return nil, fmt.Errorf("MSI requires existing enrolled configuration")
	}
	hash, err := configDigest(filepath.Join(filepath.Dir(h.Root), "agent.json"))
	if err != nil {
		return nil, err
	}
	manager, service, err := h.service()
	if err != nil {
		return nil, err
	}
	defer manager.Disconnect()
	defer service.Close()
	status, err := service.Query()
	if err != nil {
		return nil, err
	}
	created, err := processIdentity(status.ProcessId, filepath.Join(h.InstallDir, "SentinelGridAgent.exe"))
	if err != nil {
		return nil, err
	}
	for _, name := range []string{"msi-result.json", "msi-outcome.json"} {
		if err := removeKnown(filepath.Join(h.Root, name)); err != nil {
			return nil, err
		}
	}
	return &MSIProgress{StartedAt: time.Now().UTC(), PreviousPID: status.ProcessId, PreviousProcessStarted: created, ConfigSHA256: hash}, nil
}

// This fixed OS-hosted coordinator outlives SCM stopping/upgrading the Updater.
// It receives no URL, credentials, service name or client-controlled execution options.
const msiWorker = `
$ErrorActionPreference = 'Stop'
$lock = $null; $file = $null
$phase = 'MSI_COORDINATOR_START_FAILED'
function Write-Result([int]$code,[string]$detail) {
 $data = [Text.Encoding]::UTF8.GetBytes((@{transaction_id=$env:SG_MSI_TRANSACTION;exit_code=$code;detail=$detail} | ConvertTo-Json -Compress))
 $tmp = Join-Path $env:SG_MSI_ROOT 'msi-result.json.tmp'
 $target = Join-Path $env:SG_MSI_ROOT 'msi-result.json'
 $stream = [IO.File]::Open($tmp,'Create','Write','None')
 try { $stream.Write($data,0,$data.Length); $stream.Flush($true) } finally { $stream.Dispose() }
 if (-not [SGNative]::MoveFileEx($tmp,$target,9)) { throw 'Durable MSI result failed' }
}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class SGNative { [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool MoveFileEx(string a,string b,int flags); }'
try {
 $lock = [IO.File]::Open((Join-Path $env:SG_MSI_ROOT 'msi-runner.lock'),'OpenOrCreate','ReadWrite','None')
 $deadline = [DateTime]::UtcNow.AddSeconds(60)
 $phase = 'MSI_HANDOFF_ACK_FAILED'
 do {
  $state = Get-Content -LiteralPath (Join-Path $env:SG_MSI_ROOT 'state.json') -Raw | ConvertFrom-Json
  if ($state.transaction_id -ne $env:SG_MSI_TRANSACTION -or $state.update_status -ne 'installing' -or
      $state.authorized -ne $true -or $state.pending.schema -ne 2 -or
      $state.pending.artifact_type -cne 'msi' -or $state.pending.version -cne $env:SG_MSI_VERSION) { throw 'MSI ownership lost' }
  if ($state.msi.worker_pid -eq $PID) {
   if ([uint64]$state.msi.worker_started -ne [uint64]([Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc())) { throw 'MSI worker identity mismatch' }
   break
  }
  if ([DateTime]::UtcNow -gt $deadline) { throw 'MSI launch was not acknowledged' }
  Start-Sleep -Milliseconds 200
 } while ($true)
 $file = [IO.File]::Open($env:SG_MSI_FILE,'Open','Read','Read')
 $phase = 'MSI_VERIFICATION_FAILED'
 if ($file.Length -ne [long]$env:SG_MSI_SIZE) { throw 'MSI size mismatch' }
 $hash = [Security.Cryptography.SHA256]::Create()
 try { $digest = ([BitConverter]::ToString($hash.ComputeHash($file))).Replace('-','') } finally { $hash.Dispose() }
 if ($digest -cne $env:SG_MSI_HASH) { throw 'MSI hash mismatch' }
 $sig = Get-AuthenticodeSignature -LiteralPath $env:SG_MSI_FILE
 if ($sig.Status -ne 'Valid' -or $null -eq $sig.SignerCertificate) { throw 'Authenticode rejected' }
 if ($env:SG_MSI_DEVELOPMENT -ne 'true' -and $sig.SignerCertificate.Subject -match 'SentinelGrid.*DEVELOPMENT ONLY') { throw 'Development signer forbidden' }
 $hash = [Security.Cryptography.SHA256]::Create()
 try { $pin = ([BitConverter]::ToString($hash.ComputeHash($sig.SignerCertificate.RawData))).Replace('-','') } finally { $hash.Dispose() }
 if ($pin -cne $env:SG_MSI_SIGNER -or $env:SG_MSI_PINS.Split(',') -cnotcontains $pin) { throw 'Signer pin rejected' }
` + msiMetadataValidation + `
 $start = New-Object Diagnostics.ProcessStartInfo
 $phase = 'MSI_INSTALL_START_FAILED'
 if ([DateTime]::UtcNow -ge ([DateTime]$state.pending.not_after).ToUniversalTime()) { throw 'MSI authorization expired' }
 $start.FileName = Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\msiexec.exe'
 $start.UseShellExecute = $false
 $start.CreateNoWindow = $true
 $start.Arguments = '/i "' + $env:SG_MSI_FILE + '" /qn /norestart REBOOT=ReallySuppress'
 $process = [Diagnostics.Process]::Start($start)
 $process.WaitForExit()
 $phase = 'MSI_RESULT_PERSIST_FAILED'
 Write-Result $process.ExitCode 'MSI_FINISHED'
} catch {
 # Fixed error only: exception text can include local environment data.
 Write-Result 1603 $phase
 exit 1
} finally {
 if ($file) { $file.Dispose() }
 if ($lock) { $lock.Dispose() }
}
`

func powerShellPath() (string, error) {
	root, err := windows.GetWindowsDirectory()
	return filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), err
}

func (h *WindowsHost) LaunchMSI(ctx context.Context, state State) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, err := powerShellPath()
	if err != nil {
		return err
	}
	// Deliberately not CommandContext: SCM cancellation must not terminate Windows Installer.
	cmd := exec.Command(path, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", msiWorker)
	cmd.Env = append(os.Environ(), h.msiEnvironment(state.Pending.Release())...)
	cmd.Env = append(cmd.Env, "SG_MSI_TRANSACTION="+state.TransactionID)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP, HideWindow: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	defer cmd.Process.Release()
	pid := uint32(cmd.Process.Pid)
	created, err := processIdentity(pid, path)
	if err != nil {
		return err
	}
	state.MSI.WorkerPID, state.MSI.WorkerStarted = pid, created
	return h.Save(state)
}

func workerRunning(state State) (bool, error) {
	if state.MSI.WorkerPID == 0 {
		return false, nil
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, state.MSI.WorkerPID)
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(handle)
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		return false, err
	}
	// Image identity was verified before acknowledging launch. This same handle
	// binds creation time and exit status, including PID reuse and exited workers.
	if uint64(created.HighDateTime)<<32|uint64(created.LowDateTime) != state.MSI.WorkerStarted {
		return false, nil
	}
	var code uint32
	if err := windows.GetExitCodeProcess(handle, &code); err != nil {
		return false, err
	}
	return code == 259, nil
}

func (h *WindowsHost) MSIResult(ctx context.Context, state State) (*MSIResult, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	running, err := workerRunning(state)
	if err != nil || running {
		return nil, running, err
	}
	// The updater may have died before acknowledging the worker PID. The lock
	// prevents treating an unacknowledged-but-live coordinator as a finished MSI.
	p, err := windows.UTF16PtrFromString(filepath.Join(h.Root, "msi-runner.lock"))
	if err != nil {
		return nil, false, err
	}
	handle, err := windows.CreateFile(p, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
		return nil, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	defer windows.CloseHandle(handle)
	if err := regularHandle(handle); err != nil {
		return nil, false, err
	}
	var result struct {
		TransactionID string `json:"transaction_id"`
		ExitCode      *int   `json:"exit_code"`
		Detail        string `json:"detail"`
	}
	if err := readMetadata(filepath.Join(h.Root, "msi-result.json"), &result); errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	} else if err != nil {
		return nil, false, err
	}
	if result.ExitCode == nil || *result.ExitCode < 0 || *result.ExitCode > 65535 || !transactionPattern.MatchString(result.TransactionID) || result.Detail == "" {
		return nil, false, fmt.Errorf("invalid MSI result receipt")
	}
	return &MSIResult{TransactionID: result.TransactionID, ExitCode: *result.ExitCode, Detail: result.Detail}, false, nil
}

func (h *WindowsHost) ProductHealthy(ctx context.Context, state State) error {
	if buildinfo.Version() != state.Target {
		return fmt.Errorf("running Updater does not match target version")
	}
	var outcome struct {
		TransactionID string `json:"transaction_id"`
		Outcome       string `json:"outcome"`
	}
	if err := readMetadata(filepath.Join(h.Root, "msi-outcome.json"), &outcome); err != nil {
		return err
	}
	if outcome.TransactionID != state.TransactionID || outcome.Outcome != "committed" {
		return fmt.Errorf("MSI commit confirmation missing")
	}
	if err := h.CanDispatch(ctx); err != nil {
		return err
	}
	hash, err := configDigest(filepath.Join(filepath.Dir(h.Root), "agent.json"))
	if err != nil || hash != state.MSI.ConfigSHA256 {
		return fmt.Errorf("enrollment configuration changed during MSI")
	}
	if err := h.productVersions(ctx, state.Target); err != nil {
		return err
	}
	h.startTime = state.MSI.StartedAt
	return h.Healthy(ctx, state.Target)
}

func (h *WindowsHost) productVersions(ctx context.Context, target string) error {
	for _, product := range []string{"Agent", "Updater", "RDP"} {
		path := filepath.Join(h.InstallDir, "SentinelGrid"+product+".exe")
		file, err := pinFile(path)
		if err != nil {
			return err
		}
		defer file.Close()
		version, err := signedVersion(ctx, path, product)
		if err != nil || version != target {
			return fmt.Errorf("installed %s does not match target version", product)
		}
		if product != "RDP" {
			if err := matchingBuildTrust(ctx, path); err != nil {
				return err
			}
		}
	}
	return nil
}
