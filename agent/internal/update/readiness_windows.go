//go:build windows

package update

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
	buildinfo "sentinelgrid/agent"
	"sentinelgrid/agent/internal/config"
)

const RecoveryServiceName = "SentinelGridUpdater"
const Protocol = "1"

var shuttingDown = windows.NewLazySystemDLL("user32.dll").NewProc("GetSystemMetrics")

func windowsStopping() bool {
	v, _, _ := shuttingDown.Call(0x2000) // SM_SHUTTINGDOWN
	return stopping.Load() || v != 0
}

func (h *WindowsHost) CanDispatch(ctx context.Context) error {
	var command DeviceCommand
	commandErr := readMetadata(filepath.Join(h.Root, "command.json"), &command)
	if commandErr != nil && !errors.Is(commandErr, os.ErrNotExist) {
		return commandErr
	}
	if commandErr == nil && command.Phase == "power_pending" && !command.Terminal() && time.Now().Before(command.Deadline) {
		boot, err := commandBootID()
		if err != nil {
			return err
		}
		if command.Boot == boot {
			return fmt.Errorf("a device power command is pending")
		}
	}
	_, err := os.Lstat(filepath.Join(h.Root, "maintenance.json"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return dispatchAllowed(ctx, windowsStopping(), err == nil)
}

func (h *WindowsHost) checkRecovery(ctx context.Context) error { return h.checkRecoveryFor(ctx, false) }

func (h *WindowsHost) checkRecoveryFor(ctx context.Context, diagnostic bool) error {
	path := filepath.Join(h.InstallDir, "SentinelGridUpdater.exe")
	file, err := pinFile(path)
	if err != nil {
		return fmt.Errorf("updater missing or unsafe")
	}
	defer file.Close()
	if err := matchingBuildTrust(ctx, path); err != nil {
		return err
	}
	version, err := signedVersion(ctx, path, "Updater")
	if err != nil {
		return err
	}
	parts, err := parseVersion(version)
	if err != nil {
		return err
	}
	current, err := parseVersion(buildinfo.Version())
	if err != nil || parts[1] != current[1] || parts[2] != current[2] {
		return fmt.Errorf("incompatible updater version")
	}
	probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(probeCtx, path, "-protocol").Output()
	if err != nil || strings.TrimSpace(string(output)) != Protocol {
		return fmt.Errorf("incompatible updater journal protocol")
	}
	manager, service, err := h.namedService(RecoveryServiceName, "SentinelGridUpdater.exe")
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	defer service.Close()
	status, err := service.Query()
	if err != nil || status.State != svc.Running {
		return fmt.Errorf("recovery service is not running")
	}
	if _, err := processIdentity(status.ProcessId, path); err != nil {
		return err
	}
	actions, err := service.RecoveryActions()
	if err != nil || len(actions) != 3 || actions[0].Type != mgr.ServiceRestart || actions[1].Type != mgr.ServiceRestart || actions[2].Type != mgr.NoAction || actions[0].Delay != time.Minute || actions[1].Delay != time.Minute {
		return fmt.Errorf("bounded recovery restart policy is not installed")
	}
	agentManager, agentService, err := h.service()
	if err != nil {
		return err
	}
	agentStatus, queryErr := agentService.Query()
	agentService.Close()
	agentManager.Disconnect()
	if queryErr != nil || agentStatus.State != svc.Running || (!diagnostic && agentStatus.ProcessId != uint32(os.Getpid())) {
		return fmt.Errorf("readiness requires the installed Agent service process")
	}
	if _, err := processIdentity(agentStatus.ProcessId, filepath.Join(h.InstallDir, "SentinelGridAgent.exe")); err != nil {
		return err
	}
	if err := systemProcess(agentStatus.ProcessId); err != nil {
		return err
	}
	if err := systemProcess(status.ProcessId); err != nil {
		return err
	}
	// Reject service ACLs that let a normal user change the executable or stop recovery.
	_, err = systemPowerShell(ctx, `
$sc = Join-Path $env:SystemRoot 'System32\sc.exe'
foreach ($name in @('SentinelGridAgent','SentinelGridUpdater')) {
 $text = (& $sc sdshow $name | Out-String).Trim()
 if ($LASTEXITCODE -ne 0) { throw 'Service security query failed' }
 $sd = New-Object Security.AccessControl.RawSecurityDescriptor($text)
 foreach ($ace in $sd.DiscretionaryAcl) {
  if ($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and ($ace.AccessMask -band 0x000d0132) -ne 0 -and $ace.SecurityIdentifier.Value -notin @('S-1-5-18','S-1-5-32-544')) { throw 'Unsafe service ACL' }
 }
}
`)
	return err
}

func operational(ctx context.Context) error { return operationalFor(ctx, false) }

func operationalFor(ctx context.Context, diagnostic bool) error {
	var host *WindowsHost
	return evaluateReadiness(ctx, sourceQualified(), []readinessCheck{
		{"Windows architecture", func(context.Context) error {
			if runtime.GOARCH != "amd64" {
				return fmt.Errorf("updates require Windows amd64")
			}
			return nil
		}},
		{"SYSTEM identity", func(context.Context) error {
			user, err := windows.GetCurrentProcessToken().GetTokenUser()
			if err != nil {
				return err
			}
			if user.User.Sid.String() != "S-1-5-18" && !(diagnostic && windows.GetCurrentProcessToken().IsElevated()) {
				return fmt.Errorf("updater requires LocalSystem")
			}
			return nil
		}},
		{"protected directories", func(ctx context.Context) error {
			var err error
			host, err = NewWindowsHost(ctx)
			if err == nil {
				_, err = os.Stat(host.InstallDir)
			}
			return err
		}},
		{"fixed configuration", func(context.Context) error {
			if !strings.EqualFold(config.FilePath(), filepath.Join(filepath.Dir(host.Root), "agent.json")) {
				return fmt.Errorf("unexpected configuration path")
			}
			file, err := pinFile(config.FilePath())
			if err != nil {
				return err
			}
			defer file.Close()
			cfg, err := config.Load()
			if err == nil && !authenticatedHeartbeat(cfg.Server, cfg.DeviceID, cfg.DeviceID, true) {
				return fmt.Errorf("update health requires HTTPS configuration")
			}
			return err
		}},
		{"signed installed Agent", func(ctx context.Context) error {
			path := filepath.Join(host.InstallDir, "SentinelGridAgent.exe")
			self, err := os.Executable()
			if err != nil || !strings.EqualFold(self, path) {
				return fmt.Errorf("readiness requires the fixed installed Agent executable")
			}
			version, err := host.CurrentVersion(ctx)
			if err != nil {
				return err
			}
			if version != buildinfo.Version() {
				return fmt.Errorf("running and installed Agent versions differ")
			}
			return nil
		}},
		{"dispatch coordination", func(ctx context.Context) error { return host.CanDispatch(ctx) }},
		{"signed recovery service", func(ctx context.Context) error { return host.checkRecoveryFor(ctx, diagnostic) }},
		{"durable journal", func(context.Context) error {
			// Capability describes support, not whether another update owns the lock.
			state, err := host.Load()
			if err != nil {
				return err
			}
			if diagnostic {
				fmt.Printf("Journal status: %q; active: %t; recovery attempts: %d; reported: %t; error: %q\n", state.Status, Active(state), state.Attempts, state.Reported, state.Error)
			}
			unlock, lockErr := host.Lock()
			if lockErr != nil {
				if !errors.Is(lockErr, windows.ERROR_SHARING_VIOLATION) {
					return lockErr
				}
				if diagnostic {
					fmt.Println("Update lock: held by another process; capability is not an idle-state guarantee")
				}
			} else {
				if err := unlock(); err != nil {
					return err
				}
				if diagnostic {
					fmt.Println("Update lock: available (probe released ownership)")
				}
			}
			if state.Error == "ROLLBACK_FAILED" {
				return fmt.Errorf("recovery exhausted; administrator repair required")
			}
			path, err := windows.UTF16PtrFromString(filepath.Join(host.Root, "state.json"))
			if err != nil {
				return err
			}
			handle, err := windows.CreateFile(path, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
			if err == nil {
				if err := errors.Join(regularHandle(handle), windows.CloseHandle(handle)); err != nil {
					return err
				}
			} else if !errors.Is(err, os.ErrNotExist) {
				return err
			}
			probeName := "readiness.json"
			if diagnostic {
				probeName = "diagnostic-readiness.json"
			}
			if err := atomicJSON(filepath.Join(host.Root, probeName), struct {
				Protocol string `json:"protocol"`
			}{Protocol}); err != nil {
				return err
			}
			return removeKnown(filepath.Join(host.Root, probeName))
		}},
	})
}

// The same update lock excludes a typed power action from an active transaction.
// The caller sets the stop flag only after Windows accepts the power request.
func GuardPowerAction(ctx context.Context) (func() error, error) {
	if !sourceQualified() {
		return func() error { return nil }, nil
	}
	host, err := NewWindowsHost(ctx)
	if err != nil {
		return nil, err
	}
	unlock, err := host.Lock()
	if err != nil {
		return nil, err
	}
	state, err := host.Load()
	if err == nil {
		err = host.CanDispatch(ctx)
	}
	if err != nil || Active(state) {
		if err == nil {
			err = fmt.Errorf("Agent update owns service lifecycle")
		}
		return nil, errors.Join(err, unlock())
	}
	return unlock, nil
}
