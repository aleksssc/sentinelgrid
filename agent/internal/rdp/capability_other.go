//go:build !windows

package rdp

import (
	"context"
	"fmt"
)

func Available(context.Context) error { return fmt.Errorf("RDP host requires Windows with NLA") }
