//go:build windows && amd64

package rdp

import (
	"testing"
	"unsafe"
)

func TestNativeVideoFrameABI(t *testing.T) {
	if got, want := unsafe.Sizeof(nativeVideoFrame{}), uintptr(40); got != want {
		t.Fatalf("nativeVideoFrame size=%d want=%d", got, want)
	}
	if got, want := unsafe.Offsetof(nativeVideoFrame{}.AcquireMicroseconds), uintptr(16); got != want {
		t.Fatalf("nativeVideoFrame acquire offset=%d want=%d", got, want)
	}
}
