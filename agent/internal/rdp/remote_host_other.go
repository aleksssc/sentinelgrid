//go:build !windows

package rdp

import (
	"context"
	"fmt"
)

func LaunchInteractive(context.Context, Connection) error {
	return fmt.Errorf("remote host requires Windows")
}
func RunRemoteHost(context.Context) error { return fmt.Errorf("remote host requires Windows") }
