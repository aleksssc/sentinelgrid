//go:build windows

package update

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	buildinfo "sentinelgrid/agent"
)

// Called only by the MSI's embedded updater. No product, path or service input.
// A stale marker after an interrupted MSI fails closed until repair/rollback.
func Maintenance(ctx context.Context, begin bool) (resultErr error) {
	return MSIMaintenance(ctx, begin, false)
}

func MSIMaintenance(ctx context.Context, begin, rollback bool) (resultErr error) {
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
	remoteMSI := state.Pending != nil && state.Pending.Schema == 2 && state.Status == "installing" && state.Authorized && state.MSI != nil
	if begin {
		if state.MSI != nil && state.MSI.RepairRequired {
			running, err := workerRunning(state)
			if err != nil || running {
				return errors.Join(fmt.Errorf("MSI coordinator must finish before repair"), err)
			}
		}
		if Active(state) && !remoteMSI {
			return fmt.Errorf("SentinelGrid update must recover before MSI maintenance")
		}
		if remoteMSI {
			if err := host.verifyMSI(ctx, state.Pending.Release()); err != nil {
				return err
			}
			defer host.ClosePins()
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
	if remoteMSI {
		outcome := "committed"
		if rollback {
			outcome = "rolled_back"
		}
		if err := atomicJSON(filepath.Join(host.Root, "msi-outcome.json"), struct {
			TransactionID string `json:"transaction_id"`
			Outcome       string `json:"outcome"`
		}{state.TransactionID, outcome}); err != nil {
			return err
		}
	}
	if !rollback && state.MSI != nil && state.MSI.RepairRequired {
		hash, err := configDigest(filepath.Join(filepath.Dir(host.Root), "agent.json"))
		if err != nil || hash != state.MSI.ConfigSHA256 {
			return fmt.Errorf("repair changed enrolled configuration")
		}
		if err := host.productVersions(ctx, buildinfo.Version()); err != nil {
			return err
		}
		state.MSI.RepairRequired = false
		if err := host.Save(state); err != nil {
			return err
		}
		log.Print("MSI_MANUAL_REPAIR_COMPLETED")
	}
	return removeKnown(path)
}
