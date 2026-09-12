//go:build !windows

package update

import (
	"context"
	"fmt"
)

func CommandJournal(context.Context, func(*DeviceCommand) error) error {
	return fmt.Errorf("device actions require the installed Windows Agent")
}
func CommandIdentity() (uint32, uint64, string, error) {
	return 0, 0, "", fmt.Errorf("Windows required")
}
func ConfirmCommandHeartbeat(string, string, string, bool) {}
func RestartCommandAvailable(context.Context) error        { return fmt.Errorf("Windows required") }
func RunCommandRecovery(context.Context)                   {}
