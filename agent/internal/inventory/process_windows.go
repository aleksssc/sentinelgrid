//go:build windows

package inventory

import (
	"os/exec"
	"syscall"
)

func hideInventoryWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}
