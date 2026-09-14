//go:build windows

package rdp

import (
	"context"
	"testing"
)

func TestRunRemoteHostContinuesWithoutLogger(t *testing.T) {
	t.Setenv("SENTINELGRID_REMOTE_RELAY", "")
	t.Setenv("SENTINELGRID_REMOTE_TICKET", "")
	t.Setenv("SENTINELGRID_REMOTE_EXPIRES", "")
	err := runRemoteHost(context.Background(), nil)
	if got := RemoteHostExitCode(err); got != 21 {
		t.Fatalf("nil logger changed failure stage: exit code %d, want environment 21", got)
	}
}
