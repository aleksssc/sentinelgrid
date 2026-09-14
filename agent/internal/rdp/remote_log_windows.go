//go:build windows

package rdp

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const remoteLogDirectoryName = "logs"
const remoteLogFileName = "remote.log"

// The child needs only directory traversal and append-only file writes. FILE_APPEND_DATA
// permits WriteFile at EOF without FILE_WRITE_DATA, attributes, or read access.
const remoteLogTraverseAccess = 0x00100020 // SYNCHRONIZE | FILE_TRAVERSE
const fileFlagBackupSemantics = 0x02000000

var advapi32 = windows.NewLazySystemDLL("advapi32.dll")
var impersonateLoggedOnUser = advapi32.NewProc("ImpersonateLoggedOnUser")
var revertToSelf = advapi32.NewProc("RevertToSelf")

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

func remoteLogDirectorySDDLForUser(userSID string) (string, error) {
	if userSID == "" {
		return "", fmt.Errorf("interactive user SID is unavailable")
	}
	return "O:BAG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;;0x00100020;;;" + userSID + ")", nil
}

func remoteLogFileSDDLForUser(userSID string) (string, error) {
	if userSID == "" {
		return "", fmt.Errorf("interactive user SID is unavailable")
	}
	return "O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x00100004;;;" + userSID + ")", nil
}

func interactiveUserSID(token windows.Token) (string, error) {
	user, err := token.GetTokenUser()
	if err != nil || user == nil || user.User.Sid == nil {
		return "", fmt.Errorf("read interactive user SID: %w", err)
	}
	return user.User.Sid.String(), nil
}

func provisionRemoteLog(token windows.Token) error {
	userSID, err := interactiveUserSID(token)
	if err != nil {
		return err
	}
	directorySDDL, err := remoteLogDirectorySDDLForUser(userSID)
	if err != nil {
		return err
	}
	fileSDDL, err := remoteLogFileSDDLForUser(userSID)
	if err != nil {
		return err
	}
	path, err := remoteLogPath()
	if err != nil {
		return err
	}
	root := filepath.Dir(filepath.Dir(path))
	if err := protectExistingDirectory(root, directorySDDL); err != nil {
		return fmt.Errorf("prepare remote log parent: %w", err)
	}
	dir := filepath.Dir(path)
	if info, err := os.Lstat(dir); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unsafe remote log directory")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect remote log directory: %w", err)
	}
	if err := createProtectedDirectory(dir, directorySDDL); err != nil {
		return fmt.Errorf("prepare remote log directory: %w", err)
	}
	return createProtectedRemoteLog(path, fileSDDL)
}

func protectExistingDirectory(path, sddl string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect directory: %w", err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("unsafe directory")
	}
	return setProtectedDACL(path, sddl)
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
	return setProtectedDACL(path, sddl)
}

func setProtectedDACL(path, sddl string) error {
	descriptor, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return err
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

func createProtectedRemoteLog(path, sddl string) error {
	descriptor, err := windows.SecurityDescriptorFromString(sddl)
	if err != nil {
		return err
	}
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	attributes := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: descriptor}
	handle, err := openRemoteLogFile(ptr, &attributes, windows.OPEN_ALWAYS)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	return setProtectedDACL(path, sddl)
}

func openRemoteLogFile(path *uint16, security *windows.SecurityAttributes, disposition uint32) (windows.Handle, error) {
	return windows.CreateFile(path, remoteLogAppendAccess, remoteLogShareMode, security, disposition, windows.FILE_ATTRIBUTE_NORMAL, 0)
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
	handle, err := openRemoteLogFile(ptr, nil, remoteLogDisposition)
	if err != nil {
		return nil, fmt.Errorf("open remote diagnostic log: %w", err)
	}
	return &remoteLogger{handle: handle}, nil
}

func openRemoteLogDirectory(path string) (windows.Handle, error) {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	return windows.CreateFile(ptr, remoteLogTraverseAccess, remoteLogShareMode, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL|fileFlagBackupSemantics, 0)
}

func verifyRemoteLogTraversal(path, stage string) error {
	handle, err := openRemoteLogDirectory(path)
	if err != nil {
		return fmt.Errorf("remote log traversal %s: %w", stage, err)
	}
	return windows.CloseHandle(handle)
}

// verifyRemoteLoggerAccess verifies every hierarchy component and then makes
// exactly the same CreateFile request as the child. Windows impersonation is
// thread-local, so keeping this goroutine locked is required.
func verifyRemoteLoggerAccess(token windows.Token) error {
	path, err := remoteLogPath()
	if err != nil {
		return err
	}
	programData := filepath.Dir(filepath.Dir(filepath.Dir(path)))
	root := filepath.Dir(filepath.Dir(path))
	logs := filepath.Dir(path)
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if result, _, err := impersonateLoggedOnUser.Call(uintptr(token)); result == 0 {
		return fmt.Errorf("impersonate interactive user: %w", err)
	}
	defer func() { _, _, _ = revertToSelf.Call() }()
	for _, item := range []struct{ path, stage string }{{programData, "ProgramData"}, {root, "SentinelGrid"}, {logs, "logs"}} {
		if err := verifyRemoteLogTraversal(item.path, item.stage); err != nil {
			return err
		}
	}
	logger, err := openRemoteLogger()
	if err != nil {
		return err
	}
	logger.close()
	return nil
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
