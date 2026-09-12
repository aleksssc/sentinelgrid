//go:build windows

package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

type WindowsHost struct {
	Root       string
	InstallDir string
	startTime  time.Time
	candidate  *os.File
}

func systemPowerShell(ctx context.Context, script string, env ...string) ([]byte, error) {
	root, err := windows.GetWindowsDirectory()
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; "+script)
	cmd.Env = append(os.Environ(), env...)
	output, err := cmd.Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			for _, reason := range []string{"Reparse path", "Untrusted owner", "Writable path", "Missing config directory", "Unexpected staging entry", "Unsafe service ACL", "Service security query failed", "Authenticode rejected", "Development signer forbidden in production"} {
				if strings.Contains(string(exit.Stderr), reason) {
					return nil, fmt.Errorf("Windows update security check: %s", reason)
				}
			}
		}
		return nil, fmt.Errorf("Windows update security operation failed")
	}
	return output, nil
}

func VerifySignature(ctx context.Context, path string) error {
	pins := strings.Split(strings.ToUpper(signerPins()), ",")
	for _, pin := range pins {
		if len(pin) != 64 || strings.IndexFunc(pin, func(r rune) bool { return !strings.ContainsRune("0123456789ABCDEF", r) }) >= 0 {
			return fmt.Errorf("trusted update signer not configured")
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	output, err := systemPowerShell(ctx, `
$s = Get-AuthenticodeSignature -LiteralPath $env:SG_VERIFY_FILE
if ($s.Status -ne 'Valid' -or $null -eq $s.SignerCertificate) { throw 'Authenticode rejected' }
if ($env:SG_VERIFY_DEVELOPMENT -ne 'true' -and $s.SignerCertificate.Subject -match 'SentinelGrid.*DEVELOPMENT ONLY') { throw 'Development signer forbidden in production' }
$h = [System.Security.Cryptography.SHA256]::Create()
try { [Console]::Write(([BitConverter]::ToString($h.ComputeHash($s.SignerCertificate.RawData))).Replace('-','')) } finally { $h.Dispose() }
`, "SG_VERIFY_FILE="+path, fmt.Sprintf("SG_VERIFY_DEVELOPMENT=%t", developmentBuild))
	if err != nil {
		return fmt.Errorf("Authenticode verification failed: %w", err)
	}
	for _, pin := range pins {
		if strings.TrimSpace(string(output)) == pin {
			return nil
		}
	}
	return fmt.Errorf("unexpected Authenticode signer")
}

const protectedPathValidation = `
$allowed = @('S-1-5-18','S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
function Assert-Protected([string]$p, [bool]$ancestor = $false) {
 $item = Get-Item -LiteralPath $p -Force
 if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse path' }
 $acl = Get-Acl -LiteralPath $p
 if ($allowed -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { throw 'Untrusted owner' }
 $mask = 0x000d0156
 if ($ancestor) { $mask = 0x000d0040 }
 foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
  if ($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
  $sid = $ace.IdentityReference.Value
  if ($ace.AccessControlType -eq 'Allow' -and ($ace.FileSystemRights -band $mask) -ne 0 -and $allowed -notcontains $sid) { throw 'Writable path' }
 }
}
`

func NewWindowsHost(ctx context.Context) (*WindowsHost, error) {
	programData, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, 0)
	if err != nil {
		return nil, err
	}
	programFiles, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil {
		return nil, err
	}
	host := &WindowsHost{Root: filepath.Join(programData, "SentinelGrid", "updates"), InstallDir: filepath.Join(programFiles, "SentinelGrid")}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	_, err = systemPowerShell(ctx, protectedPathValidation+`
foreach ($p in @((Split-Path -Parent $env:SG_UPDATE_ROOT), $env:SG_INSTALL_ROOT)) {
 if (Test-Path -LiteralPath $p) { Assert-Protected $p }
 elseif ($p -ne $env:SG_INSTALL_ROOT) { throw 'Missing config directory' }
 $parent = Split-Path -Parent $p
 while ($parent) {
  Assert-Protected $parent $true
  $next = Split-Path -Parent $parent
  if ($next -eq $parent) { break }
  $parent = $next
 }
}
$config = Join-Path (Split-Path -Parent $env:SG_UPDATE_ROOT) 'agent.json'
if (Test-Path -LiteralPath $config) { Assert-Protected $config }
foreach ($name in @('SentinelGridAgent.exe','SentinelGridUpdater.exe','SentinelGridAgent.update.exe')) {
 $p = Join-Path $env:SG_INSTALL_ROOT $name
 if (Test-Path -LiteralPath $p) { Assert-Protected $p }
}
if (Test-Path -LiteralPath $env:SG_UPDATE_ROOT) { Assert-Protected $env:SG_UPDATE_ROOT }
else {
 New-Item -ItemType Directory -Path $env:SG_UPDATE_ROOT | Out-Null
 $acl = New-Object Security.AccessControl.DirectorySecurity
 $acl.SetSecurityDescriptorSddlForm('O:SYG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')
 Set-Acl -LiteralPath $env:SG_UPDATE_ROOT -AclObject $acl
}
Assert-Protected $env:SG_UPDATE_ROOT
Get-ChildItem -LiteralPath $env:SG_UPDATE_ROOT -Force | ForEach-Object {
 if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint -or $_.PSIsContainer) { throw 'Unexpected staging entry' }
 Assert-Protected $_.FullName
}
`, "SG_UPDATE_ROOT="+host.Root, "SG_INSTALL_ROOT="+host.InstallDir)
	if err != nil {
		return nil, fmt.Errorf("update directory security validation failed: %w", err)
	}
	return host, nil
}

func (h *WindowsHost) Lock() (func() error, error) {
	path, err := windows.UTF16PtrFromString(filepath.Join(h.Root, "update.lock"))
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(path, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, fmt.Errorf("update lock unavailable: %w", err)
	}
	if err := regularHandle(handle); err != nil {
		return nil, errors.Join(err, windows.CloseHandle(handle))
	}
	return func() error { return windows.CloseHandle(handle) }, nil
}

func regularHandle(handle windows.Handle) error {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(handle, &info); err != nil {
		return err
	}
	if info.FileAttributes&(windows.FILE_ATTRIBUTE_REPARSE_POINT|windows.FILE_ATTRIBUTE_DIRECTORY) != 0 || info.NumberOfLinks != 1 {
		return fmt.Errorf("unsafe update file")
	}
	return nil
}

// Deny write/delete sharing from verification until copying has finished.
func pinFile(path string) (*os.File, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	if err := regularHandle(handle); err != nil {
		return nil, errors.Join(err, windows.CloseHandle(handle))
	}
	return os.NewFile(uintptr(handle), path), nil
}

func atomicJSON(path string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := removeKnown(tmp); err != nil {
		return err
	}
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(data)
	err = errors.Join(writeErr, file.Sync(), file.Close())
	if err != nil {
		return err
	}
	from, err := windows.UTF16PtrFromString(tmp)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}

func readMetadata(path string, target any) error {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(p, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	if err := regularHandle(handle); err != nil {
		return errors.Join(err, windows.CloseHandle(handle))
	}
	file := os.NewFile(uintptr(handle), path)
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 16385))
	if err != nil {
		return err
	}
	return strictJSON(data, target)
}

func (h *WindowsHost) Load() (State, error) {
	var state State
	err := readMetadata(filepath.Join(h.Root, "state.json"), &state)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, err
	}
	return state, state.Validate()
}

func (h *WindowsHost) Save(state State) error {
	if err := state.Validate(); err != nil {
		return err
	}
	if err := atomicJSON(filepath.Join(h.Root, "state.json"), state); err != nil {
		return err
	}
	log.Printf("Agent update state: %s", state.Status)
	return nil
}

func signedVersion(ctx context.Context, path, product string) (string, error) {
	if err := VerifySignature(ctx, path); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "-version").Output()
	if err != nil {
		return "", fmt.Errorf("could not determine signed product version")
	}
	text := strings.TrimSpace(string(output))
	prefix := "SentinelGrid " + product + " "
	if !strings.HasPrefix(text, prefix) {
		return "", fmt.Errorf("signed artifact product mismatch")
	}
	version := strings.TrimPrefix(text, prefix)
	if _, err := parseVersion(version); err != nil {
		return "", err
	}
	return version, nil
}

func (h *WindowsHost) Verify(ctx context.Context, release Release) error {
	if developmentBuild && release.Channel != "beta" && release.Channel != "dev" {
		return fmt.Errorf("development updates require beta or dev channel")
	}
	path := filepath.Join(h.Root, "candidate.exe")
	if h.candidate == nil {
		file, err := pinFile(path)
		if err != nil {
			return err
		}
		h.candidate = file
	}
	if err := VerifyArtifact(ctx, path, release, VerifySignature); err != nil {
		return err
	}
	version, err := signedVersion(ctx, path, "Agent")
	if err != nil || version != release.Version {
		return fmt.Errorf("signed artifact product/version mismatch")
	}
	if developmentBuild {
		return matchingBuildTrust(ctx, path)
	}
	return nil
}

func (h *WindowsHost) ClosePins() error {
	if h.candidate == nil {
		return nil
	}
	err := h.candidate.Close()
	h.candidate = nil
	return err
}

func (h *WindowsHost) service() (*mgr.Mgr, *mgr.Service, error) {
	return h.namedService("SentinelGridAgent", "SentinelGridAgent.exe")
}

func (h *WindowsHost) namedService(name, executable string) (*mgr.Mgr, *mgr.Service, error) {
	manager, err := mgr.Connect()
	if err != nil {
		return nil, nil, err
	}
	service, err := manager.OpenService(name)
	if err != nil {
		manager.Disconnect()
		return nil, nil, err
	}
	cfg, err := service.Config()
	if err != nil || !strings.EqualFold(strings.Trim(cfg.BinaryPathName, "\""), filepath.Join(h.InstallDir, executable)) ||
		!strings.EqualFold(cfg.ServiceStartName, "LocalSystem") || cfg.ServiceType != windows.SERVICE_WIN32_OWN_PROCESS || cfg.StartType != mgr.StartAutomatic {
		service.Close()
		manager.Disconnect()
		return nil, nil, fmt.Errorf("unexpected SentinelGrid service configuration")
	}
	return manager, service, nil
}

func stopService(ctx context.Context, service *mgr.Service) error {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	status, err := service.Query()
	if err != nil || status.State == svc.Stopped {
		return err
	}
	if status.State != svc.StopPending {
		if _, err := service.Control(svc.Stop); err != nil {
			return err
		}
	}
	for {
		status, err = service.Query()
		if err != nil || status.State == svc.Stopped {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (h *WindowsHost) Stop(ctx context.Context) error {
	if err := h.CanDispatch(ctx); err != nil {
		return err
	}
	manager, service, err := h.service()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	defer service.Close()
	return stopService(ctx, service)
}

func copyExclusive(source, target string) error {
	input, err := pinFile(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	err = errors.Join(copyErr, output.Sync(), output.Close())
	if err != nil {
		return errors.Join(err, removeKnown(target))
	}
	return nil
}

func (h *WindowsHost) Backup() error {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	state, err := h.Load()
	if err != nil {
		return err
	}
	path := filepath.Join(h.InstallDir, "SentinelGridAgent.exe")
	file, err := pinFile(path)
	if err != nil {
		return err
	}
	defer file.Close()
	version, err := signedVersion(ctx, path, "Agent")
	if err != nil || version != state.Previous {
		return fmt.Errorf("installed Agent changed before backup")
	}
	return copyExclusive(path, filepath.Join(h.Root, "previous.exe"))
}

func (h *WindowsHost) replaceFrom(source string) error {
	if err := h.CanDispatch(context.Background()); err != nil {
		return err
	}
	temporary := filepath.Join(h.InstallDir, "SentinelGridAgent.update.exe")
	if err := removeKnown(temporary); err != nil {
		return err
	}
	if err := copyExclusive(source, temporary); err != nil {
		return err
	}
	from, err := windows.UTF16PtrFromString(temporary)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(filepath.Join(h.InstallDir, "SentinelGridAgent.exe"))
	if err != nil {
		return err
	}
	return windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}

func (h *WindowsHost) Replace() error {
	if h.candidate == nil {
		return fmt.Errorf("candidate must remain pinned through replacement")
	}
	return h.replaceFrom(filepath.Join(h.Root, "candidate.exe"))
}

func (h *WindowsHost) Restore() error {
	state, err := h.Load()
	if err != nil {
		return err
	}
	path := filepath.Join(h.Root, "previous.exe")
	file, err := pinFile(path)
	if err != nil {
		return err
	}
	defer file.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	version, err := signedVersion(ctx, path, "Agent")
	if err != nil || version != state.Previous {
		return fmt.Errorf("rollback artifact verification failed")
	}
	return h.replaceFrom(path)
}

func (h *WindowsHost) Start(ctx context.Context) error {
	if err := h.CanDispatch(ctx); err != nil {
		return err
	}
	manager, service, err := h.service()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	defer service.Close()
	h.startTime = time.Now()
	return service.Start()
}

func processIdentity(pid uint32, expected string) (uint64, error) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(handle)
	var name [32768]uint16
	size := uint32(len(name))
	if err := windows.QueryFullProcessImageName(handle, 0, &name[0], &size); err != nil {
		return 0, err
	}
	if !strings.EqualFold(windows.UTF16ToString(name[:size]), expected) {
		return 0, fmt.Errorf("unexpected Agent process image")
	}
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		return 0, err
	}
	return uint64(created.HighDateTime)<<32 | uint64(created.LowDateTime), nil
}

func (h *WindowsHost) Healthy(ctx context.Context, version string) error {
	manager, service, err := h.service()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	defer service.Close()
	state, err := h.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	var pid uint32
	var runningSince time.Time
	for {
		status, err := service.Query()
		if err != nil || status.State == svc.Stopped {
			return fmt.Errorf("Agent service stopped during validation")
		}
		if pid != 0 && status.State != svc.Running {
			return fmt.Errorf("Agent left running state during validation")
		}
		if status.State == svc.Running {
			if pid != 0 && status.ProcessId != pid {
				return fmt.Errorf("Agent process restarted during validation")
			}
			if pid == 0 {
				pid, runningSince = status.ProcessId, time.Now()
			}
			created, err := processIdentity(pid, filepath.Join(h.InstallDir, "SentinelGridAgent.exe"))
			if err != nil {
				return err
			}
			var health Health
			err = readMetadata(filepath.Join(h.Root, "health.json"), &health)
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			if err == nil && healthMatches(health, version, state.TransactionID, pid, created, h.startTime, runningSince, time.Now()) {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("Agent heartbeat validation timed out: %w", ctx.Err())
		case <-time.After(2 * time.Second):
		}
	}
}

func removeKnown(path string) error {
	file, err := pinFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Remove(path)
}

func (h *WindowsHost) Commit() error {
	if err := h.ClosePins(); err != nil {
		return err
	}
	state, err := h.Load()
	if err != nil {
		return err
	}
	for _, name := range cleanupNames(state) {
		if err := removeKnown(filepath.Join(h.Root, name)); err != nil {
			return err
		}
	}
	return nil
}
