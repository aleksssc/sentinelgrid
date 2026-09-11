//go:build windows

package update

import (
	"fmt"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/mgr"
)

// MSI invokes this after InstallServices. It cannot create or retarget a service.
func ConfigureRecovery() error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	if user.User.Sid.String() != "S-1-5-18" {
		return fmt.Errorf("recovery registration requires LocalSystem")
	}
	root, err := windows.KnownFolderPath(windows.FOLDERID_ProgramFiles, 0)
	if err != nil {
		return err
	}
	host := &WindowsHost{InstallDir: filepath.Join(root, "SentinelGrid")}
	manager, service, err := host.namedService(RecoveryServiceName, "SentinelGridUpdater.exe")
	if err != nil {
		return err
	}
	defer manager.Disconnect()
	defer service.Close()
	if err := service.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: time.Minute},
		{Type: mgr.ServiceRestart, Delay: time.Minute},
		{Type: mgr.NoAction},
	}, 86400); err != nil {
		return err
	}
	return service.SetRecoveryActionsOnNonCrashFailures(true)
}
