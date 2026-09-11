//go:build windows

package update

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsExclusiveUpdateLock(t *testing.T) {
	h := &WindowsHost{Root: t.TempDir()}
	unlock, err := h.Lock()
	if err != nil {
		t.Fatal(err)
	}
	if second, err := h.Lock(); err == nil {
		second()
		t.Fatal("second update lock acquired")
	}
	if err := unlock(); err != nil {
		t.Fatal(err)
	}
	unlock, err = h.Lock()
	if err != nil {
		t.Fatal(err)
	}
	if err := unlock(); err != nil {
		t.Fatal(err)
	}
}

func TestWindowsRejectUnsignedArtifact(t *testing.T) {
	old := TrustedSignerSHA256
	TrustedSignerSHA256 = "0000000000000000000000000000000000000000000000000000000000000000"
	defer func() { TrustedSignerSHA256 = old }()
	path := filepath.Join(t.TempDir(), "unsigned.exe")
	if err := os.WriteFile(path, []byte("unsigned"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := VerifySignature(context.Background(), path); err == nil {
		t.Fatal("unsigned artifact accepted")
	}
}
