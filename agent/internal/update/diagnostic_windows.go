//go:build windows

package update

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

func matchingBuildTrust(ctx context.Context, path string) error {
	// Callers keep the executable pinned across verification and execution.
	if err := VerifySignature(ctx, path); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "-update-build-info").Output()
	if err != nil {
		return fmt.Errorf("signed executable lacks update build trust diagnostics")
	}
	var trust BuildTrust
	if err := strictJSON(output, &trust); err != nil {
		return fmt.Errorf("invalid executable update build trust")
	}
	if trust != buildTrust() {
		return fmt.Errorf("Agent/updater build qualification or signer pins differ")
	}
	return nil
}

func systemProcess(pid uint32) error {
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(process)
	var token windows.Token
	if err := windows.OpenProcessToken(process, windows.TOKEN_QUERY, &token); err != nil {
		return err
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return err
	}
	if user.User.Sid.String() != "S-1-5-18" {
		return fmt.Errorf("installed service process is not LocalSystem")
	}
	return nil
}

func (h *WindowsHost) recoveryIdentity(ctx context.Context) error {
	if err := systemProcess(uint32(os.Getpid())); err != nil {
		return err
	}
	service, err := svc.IsWindowsService()
	if err != nil || !service {
		return fmt.Errorf("recovery requires Windows service execution")
	}
	path := filepath.Join(h.InstallDir, "SentinelGridUpdater.exe")
	if _, err := processIdentity(uint32(os.Getpid()), path); err != nil {
		return err
	}
	file, err := pinFile(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return VerifySignature(ctx, path)
}

// The elevated observer checks the actual service PIDs/tokens instead of
// pretending its administrator token is the running Agent's SYSTEM token.
func ReadinessDiagnostic() error {
	probeMu.Lock()
	defer probeMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	return operationalFor(ctx, true)
}
