//go:build windows

package rdp

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

func init() {
	if filepath.Base(os.Args[0]) == "SentinelGridAgent.exe" && len(os.Args) == 1 {
		if err := EnsureProtocolRegistration(); err != nil {
			log.Printf("[RDP] protocol registration repair failed: %v", err)
		}
	}
}

// EnsureProtocolRegistration repairs the machine-level launcher after in-place Agent updates.
func EnsureProtocolRegistration() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if filepath.Base(exe) != "SentinelGridAgent.exe" {
		return nil
	}
	viewer := filepath.Join(filepath.Dir(exe), "SentinelGridRDP.exe")
	if _, err := os.Stat(viewer); err != nil {
		return fmt.Errorf("SentinelGrid Remote viewer unavailable: %w", err)
	}
	key, _, err := registry.CreateKey(registry.LOCAL_MACHINE, `Software\Classes\sentinelgrid`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if err = key.SetStringValue("", "URL:SentinelGrid Remote Protocol"); err != nil {
		return err
	}
	if err = key.SetStringValue("URL Protocol", ""); err != nil {
		return err
	}
	command, _, err := registry.CreateKey(key, `shell\open\command`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer command.Close()
	return command.SetStringValue("", `"`+viewer+`" -uri "%1"`)
}
