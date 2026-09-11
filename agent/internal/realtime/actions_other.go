//go:build !windows

package realtime

import (
	"context"
	"fmt"
)

func executePowerAction(context.Context, string, int, bool) (map[string]any, string, error) {
	return nil, "WINDOWS_REQUIRED", fmt.Errorf("this action is only available on Windows")
}

func executeLockAction(context.Context) (map[string]any, string, error) {
	return nil, "WINDOWS_REQUIRED", fmt.Errorf("this action is only available on Windows")
}

func executeFlushDNS(context.Context) (map[string]any, string, error) {
	return nil, "WINDOWS_REQUIRED", fmt.Errorf("this action is only available on Windows")
}

func executeGPUpdate(context.Context) (map[string]any, string, error) {
	return nil, "WINDOWS_REQUIRED", fmt.Errorf("this action is only available on Windows")
}
