//go:build windows

package rdp

import (
	"context"
	"testing"
	"unsafe"
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

func TestWindowsInputRecordLayout(t *testing.T) {
	if got, want := unsafe.Sizeof(inputRecord{}), uintptr(40); got != want {
		t.Fatalf("INPUT layout is %d bytes, want %d bytes on Windows amd64", got, want)
	}
	if got, want := unsafe.Sizeof(inputUnion{}), uintptr(32); got != want {
		t.Fatalf("INPUT union layout is %d bytes, want %d bytes on Windows amd64", got, want)
	}
}
