//go:build windows

package rdp

import (
	"context"
	"fmt"

	"golang.org/x/sys/windows"
)

// Available verifies that Windows has an interactive desktop. Remote control does not use RDP, TermService or TCP/3389.
func Available(context.Context) error {
	if windows.WTSGetActiveConsoleSessionId() == 0xffffffff {
		return fmt.Errorf("no active interactive Windows session")
	}
	return nil
}
