//go:build windows

package update

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

const CommandProtocol = "sentinelgrid-device-commands-v1"

func CommandIdentity() (uint32, uint64, string, error) {
	root, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil {
		return 0, 0, "", err
	}
	pid := uint32(os.Getpid())
	created, err := processIdentity(pid, filepath.Join(root, "SentinelGrid", "SentinelGridAgent.exe"))
	if err != nil {
		return 0, 0, "", err
	}
	boot, err := commandBootID()
	return pid, created, boot, err
}

func commandBootID() (string, error) {
	// SystemBootEnvironmentInformation's GUID is stable across process restarts, not reboots.
	var info struct {
		ID       windows.GUID
		Firmware uint32
		Flags    uint64
	}
	err := windows.NtQuerySystemInformation(90, unsafe.Pointer(&info), uint32(unsafe.Sizeof(info)), nil)
	if err != nil {
		return "", err
	}
	return info.ID.String(), nil
}

func CommandJournal(ctx context.Context, change func(*DeviceCommand) error) (resultErr error) {
	host, err := NewWindowsHost(ctx)
	if err != nil {
		return err
	}
	return host.commandJournal(change)
}

func (h *WindowsHost) commandJournal(change func(*DeviceCommand) error) (resultErr error) {
	path, err := windows.UTF16PtrFromString(filepath.Join(h.Root, "command.lock"))
	if err != nil {
		return err
	}
	handle, err := windows.CreateFile(path, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, windows.CloseHandle(handle)) }()
	if err := regularHandle(handle); err != nil {
		return err
	}
	var command DeviceCommand
	pathJSON := filepath.Join(h.Root, "command.json")
	if err := readMetadata(pathJSON, &command); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if command.ID != "" && (!commandPattern.MatchString(command.ID) || command.Type == "update_agent" || command.Deadline.IsZero()) {
		return fmt.Errorf("invalid device command journal")
	}
	if err := change(&command); err != nil {
		return err
	}
	if command.ID == "" {
		return nil
	}
	return atomicJSON(pathJSON, command)
}

func RestartCommandAvailable(ctx context.Context) error {
	h, err := NewWindowsHost(ctx)
	if err != nil {
		return err
	}
	if err := h.checkRecovery(ctx); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, filepath.Join(h.InstallDir, "SentinelGridUpdater.exe"), "-command-protocol").Output()
	if err != nil || strings.TrimSpace(string(output)) != CommandProtocol {
		return fmt.Errorf("installed recovery service does not support Agent restart commands")
	}
	return nil
}

func ConfirmCommandHeartbeat(server, expected, actual string, ok bool) {
	if !authenticatedHeartbeat(server, expected, actual, ok) {
		return
	}
	pid, created, boot, err := CommandIdentity()
	if err != nil {
		log.Printf("Command health identity: %v", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
	defer cancel()
	if err := CommandJournal(ctx, func(c *DeviceCommand) error {
		*c = recoveredCommand(*c, pid, created, boot, time.Now())
		return nil
	}); err != nil {
		log.Printf("Command heartbeat recovery: %v", err)
	}
}

func RunCommandRecovery(ctx context.Context) {
	timer := time.NewTicker(5 * time.Second)
	defer timer.Stop()
	for {
		if err := restartCommandPass(ctx); err != nil && ctx.Err() == nil {
			log.Printf("Device command recovery: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
	}
}

func restartCommandPass(ctx context.Context) (resultErr error) {
	h, err := NewWindowsHost(ctx)
	if err != nil {
		return err
	}
	var pending DeviceCommand
	if err := h.commandJournal(func(c *DeviceCommand) error { pending = *c; return nil }); err != nil {
		return err
	}
	if pending.ID == "" || pending.Terminal() || pending.Type != "restart_agent" || pending.Phase != "restart_pending" {
		return nil
	}
	if err := h.recoveryIdentity(ctx); err != nil {
		return err
	}
	unlock, err := h.Lock()
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	state, err := h.Load()
	if err != nil {
		return err
	}
	if Active(state) {
		return fmt.Errorf("Agent update owns service lifecycle")
	}
	if err := h.CanDispatch(ctx); err != nil {
		return err
	}
	manager, service, err := h.service()
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	defer service.Close()
	return h.commandJournal(func(c *DeviceCommand) error {
		if c.ID != pending.ID || c.Terminal() {
			return nil
		}
		status, err := service.Query()
		if err != nil {
			return err
		}
		// A restart already happened: only the new Agent's authenticated heartbeat can finish it.
		if status.State == svc.Running {
			created, err := processIdentity(status.ProcessId, filepath.Join(h.InstallDir, "SentinelGridAgent.exe"))
			if err != nil {
				return err
			}
			if status.ProcessId != c.PID || created != c.ProcessStarted {
				return nil
			}
		}
		if time.Now().After(c.Deadline) || c.Attempts >= 3 {
			c.Fail("AGENT_RESTART_FAILED", "Recovery could not restart the Agent before its deadline.")
			return nil
		}
		c.Attempts++
		// Persist the bounded attempt before touching SCM, including recovery-service crashes.
		if err := atomicJSON(filepath.Join(h.Root, "command.json"), c); err != nil {
			return err
		}
		actionCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		defer cancel()
		if err := stopService(actionCtx, service); err != nil {
			return err
		}
		if err := service.Start(); err != nil {
			return err
		}
		return nil
	})
}
