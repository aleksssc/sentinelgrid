//go:build windows

package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func prepareDirectory(dir string) error {
	if !windows.GetCurrentProcessToken().IsElevated() {
		return fmt.Errorf("configuration writes require Administrator or SYSTEM")
	}
	root, err := windows.KnownFolderPath(windows.FOLDERID_ProgramData, 0)
	if err != nil {
		return err
	}
	if !strings.EqualFold(dir, filepath.Join(root, "SentinelGrid")) {
		return fmt.Errorf("unexpected Agent configuration directory")
	}
	for path := dir; ; path = filepath.Dir(path) {
		item, err := os.Lstat(path)
		if err == nil {
			p, err := windows.UTF16PtrFromString(path)
			if err != nil {
				return err
			}
			attrs, err := windows.GetFileAttributes(p)
			if err != nil {
				return err
			}
			if !item.IsDir() || attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
				return fmt.Errorf("unsafe configuration directory")
			}
		} else if !errors.Is(err, os.ErrNotExist) || path != dir {
			return err
		}
		if filepath.Dir(path) == path {
			break
		}
	}
	descriptor, err := windows.SecurityDescriptorFromString("O:BAG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
	if err != nil {
		return err
	}
	ptr, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return err
	}
	attrs := windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: descriptor}
	if err := windows.CreateDirectory(ptr, &attrs); err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return err
	}
	existing, err := windows.GetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	owner, _, err := existing.Owner()
	if err != nil {
		return err
	}
	if owner.String() != "S-1-5-18" && owner.String() != "S-1-5-32-544" {
		return fmt.Errorf("untrusted configuration directory owner; administrator repair required")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
}

func replaceConfig(source, target string) error {
	from, err := windows.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
