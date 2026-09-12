//go:build windows

package update

import (
	"fmt"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc/mgr"
)

const serviceSecurity = "D:P(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLORC;;;IU)(A;;CCLCSWLORC;;;SU)"

func protectService(service *mgr.Service) error {
	descriptor, err := windows.SecurityDescriptorFromString(serviceSecurity)
	if err != nil {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	if err := windows.SetSecurityInfo(service.Handle, windows.SE_SERVICE, windows.DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		return fmt.Errorf("protect %s service: %w", service.Name, err)
	}
	return nil
}

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
	agentManager, agentService, err := host.service()
	if err != nil {
		return err
	}
	defer agentManager.Disconnect()
	defer agentService.Close()
	if err := protectService(agentService); err != nil {
		return err
	}
	if err := protectService(service); err != nil {
		return err
	}
	if err := service.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: time.Minute},
		{Type: mgr.ServiceRestart, Delay: time.Minute},
		{Type: mgr.NoAction},
	}, 86400); err != nil {
		return err
	}
	return service.SetRecoveryActionsOnNonCrashFailures(true)
}
