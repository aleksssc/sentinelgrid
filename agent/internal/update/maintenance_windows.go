//go:build windows

package update

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

// Called only by the MSI's embedded updater. No product, path or service input.
// A stale marker after an interrupted MSI fails closed until repair/rollback.
func Maintenance(ctx context.Context, begin bool) (resultErr error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil || user.User.Sid.String() != "S-1-5-18" {
		return fmt.Errorf("MSI coordination requires LocalSystem")
	}
	host, err := NewWindowsHost(ctx)
	if err != nil {
		return err
	}
	var unlock func() error
	for {
		unlock, err = host.Lock()
		if err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("SentinelGrid update is busy; retry MSI maintenance later")
		case <-time.After(time.Second):
		}
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	state, err := host.Load()
	if err != nil {
		return err
	}
	path := filepath.Join(host.Root, "maintenance.json")
	if begin {
		if Active(state) {
			return fmt.Errorf("SentinelGrid update must recover before MSI maintenance")
		}
		if err := atomicJSON(path, struct {
			At time.Time `json:"started_at"`
		}{time.Now().UTC()}); err != nil {
			return err
		}
		manager, service, err := host.namedService(RecoveryServiceName, "SentinelGridUpdater.exe")
		if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
			return nil
		}
		if err != nil {
			return err
		}
		defer manager.Disconnect()
		defer service.Close()
		return stopService(ctx, service)
	}
	if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	manager, service, err := host.namedService(RecoveryServiceName, "SentinelGridUpdater.exe")
	if errors.Is(err, windows.ERROR_SERVICE_DOES_NOT_EXIST) {
		return removeKnown(path)
	}
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	defer service.Close()
	status, err := service.Query()
	if err != nil {
		return err
	}
	if status.State == svc.Stopped {
		if err := service.Start(); err != nil {
			return err
		}
	}
	return removeKnown(path)
}
