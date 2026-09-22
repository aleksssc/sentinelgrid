//go:build windows

package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const remoteInstallDirectoryName = "SentinelGrid\\Remote"

func installRemoteViewer() (string, error) {
	source, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve Remote executable: %w", err)
	}

	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		var err error
		localAppData, err = os.UserCacheDir()
		if err != nil || localAppData == "" {
			return "", fmt.Errorf("LOCALAPPDATA unavailable")
		}
	}

	directory := filepath.Join(localAppData, remoteInstallDirectoryName)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", fmt.Errorf("create Remote install directory: %w", err)
	}
	target := filepath.Join(directory, "SentinelGridRDP.exe")

	same, err := sameFile(source, target)
	if err != nil {
		return "", err
	}
	if !same {
		if err := copyExecutable(source, target); err != nil {
			return "", err
		}
	}

	// If a full product install/download placed the native video module beside
	// this executable, preserve it. A standalone download still works through
	// the built-in JPEG/GDI fallback when the DLL is absent.
	sourceDLL := filepath.Join(filepath.Dir(source), "SentinelGridVideo.dll")
	targetDLL := filepath.Join(directory, "SentinelGridVideo.dll")
	if info, statErr := os.Stat(sourceDLL); statErr == nil && !info.IsDir() {
		_ = copyFile(sourceDLL, targetDLL)
	}

	if err := registerRemoteProtocol(target); err != nil {
		return "", err
	}
	return target, nil
}

func sameFile(left, right string) (bool, error) {
	leftInfo, err := os.Stat(left)
	if err != nil {
		return false, err
	}
	rightInfo, err := os.Stat(right)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return os.SameFile(leftInfo, rightInfo), nil
}

func copyExecutable(source, target string) error {
	temp := target + ".new"
	_ = os.Remove(temp)
	if err := copyFile(source, temp); err != nil {
		return fmt.Errorf("copy Remote executable: %w", err)
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(temp)
		return fmt.Errorf("replace Remote executable: %w", err)
	}
	if err := os.Rename(temp, target); err != nil {
		_ = os.Remove(temp)
		return fmt.Errorf("activate Remote executable: %w", err)
	}
	return nil
}

func copyFile(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0700)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		_ = out.Close()
		if !ok {
			_ = os.Remove(target)
		}
	}()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	if err := out.Sync(); err != nil {
		return err
	}
	ok = true
	return nil
}

func registerRemoteProtocol(executable string) error {
	key, _, err := registry.CreateKey(
		registry.CURRENT_USER,
		`Software\Classes\sentinelgrid`,
		registry.SET_VALUE|registry.CREATE_SUB_KEY,
	)
	if err != nil {
		return fmt.Errorf("open protocol registration: %w", err)
	}
	defer key.Close()

	if err := key.SetStringValue("", "URL:SentinelGrid Remote Protocol"); err != nil {
		return err
	}
	if err := key.SetStringValue("URL Protocol", ""); err != nil {
		return err
	}
	command, _, err := registry.CreateKey(
		key,
		`shell\open\command`,
		registry.SET_VALUE,
	)
	if err != nil {
		return err
	}
	defer command.Close()
	return command.SetStringValue("", `"`+executable+`" -uri "%1"`)
}


var (
	user32RemoteInstaller = windows.NewLazySystemDLL("user32.dll")
	messageBoxWRemote      = user32RemoteInstaller.NewProc("MessageBoxW")
)

func showRemoteInstallResult(installed string, err error) {
	title, _ := windows.UTF16PtrFromString("SentinelGrid Remote")
	message := "SentinelGrid Remote is installed and ready. Return to the browser and click Open Remote."
	flags := uintptr(0x00000040) // MB_ICONINFORMATION
	if err != nil {
		message = "SentinelGrid Remote could not be installed or repaired."
		flags = 0x00000010 // MB_ICONERROR
	} else if installed != "" {
		message += "\n\nInstalled to:\n" + installed
	}
	body, _ := windows.UTF16PtrFromString(message)
	messageBoxWRemote.Call(
		0,
		uintptr(unsafe.Pointer(body)),
		uintptr(unsafe.Pointer(title)),
		flags,
	)
}
