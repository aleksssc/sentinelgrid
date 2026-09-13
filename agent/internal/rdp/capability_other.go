//go:build !windows

package rdp

import (
	"context"
	"fmt"
)

func Available(context.Context) error {
	return fmt.Errorf("remote host requires an interactive Windows session")
}
