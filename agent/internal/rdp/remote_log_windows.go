//go:build windows

package rdp

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const remoteLogDirectoryName = "logs"
const remoteLogFileName = "remote.log"

var remoteLogDirectorySDDL = "O:BAG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;;0x00100020;;;AU)"
var remoteLogFileSDDL = "O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x00100004;;;AU)"

type remoteLogger struct {
	handle windows.Handle
	mu     sync.Mutex
}

func remoteLogPath() (string, error) {
	programData, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, 0)
	if err != nil {
		return "", fmt.Errorf("locate ProgramData: %w", err)
	}
	return filepath.Join(programData, "SentinelGrid", remoteLogDirectoryName, remoteLogFileName), nil
}

// provisionRemoteLog runs in the service before the interactive process is
// launched. The host receives append-only access to this diagnostic file.
func provisionRemoteLog() error {
	path, err := remoteLogPath()
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if info, err := os.Lstat(dir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unsafe remote log directory")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect remote log directory: %w", err)
	}
	if err := createProtectedDirectory(dir, remoteLogDirectorySDDL); err != nil {
		return fmt.Errorf("prepare remote log directory: %w", err)
	}
	return createProtectedRemoteLog(path)
}

func createProtectedDirectory(path, sddl string) error {
	descriptor, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return err
	}
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	attributes := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: descriptor}
	if err := windows.CreateDirectory(ptr, &attributes); err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

func createProtectedRemoteLog(path string) error {
	descriptor, err := windows.SecurityDescriptorFromString(remoteLogFileSDDL)
	if err != nil {
		return err
	}
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	attributes := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: descriptor}
	handle, err := windows.CreateFile(ptr, windows.FILE_APPEND_DATA|windows.SYNCHRONIZE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, &attributes, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

func openRemoteLogger() (*remoteLogger, error) {
	path, err := remoteLogPath()
	if err != nil {
		return nil, err
	}
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(ptr, windows.FILE_APPEND_DATA|windows.SYNCHRONIZE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, fmt.Errorf("open remote diagnostic log: %w", err)
	}
	return &remoteLogger{handle: handle}, nil
}

func (l *remoteLogger) close() {
	if l != nil && l.handle != 0 {
		_ = windows.CloseHandle(l.handle)
		l.handle = 0
	}
}

func (l *remoteLogger) event(message string) {
	if l == nil || l.handle == 0 {
		return
	}
	line := []byte(time.Now().UTC().Format(time.RFC3339Nano) + " " + message + "\r\n")
	l.mu.Lock()
	defer l.mu.Unlock()
	var written uint32
	_ = windows.WriteFile(l.handle, line, &written, nil)
}
