//go:build !windows

package inventory

import "os/exec"

func hideInventoryWindow(*exec.Cmd) {}
