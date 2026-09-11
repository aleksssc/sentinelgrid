//go:build windows

package update

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestWindowsDevelopmentPinDoesNotAcceptUnsignedCode(t *testing.T) {
	oldProd, oldDev := TrustedSignerSHA256, DevelopmentSignerSHA256
	defer func() { TrustedSignerSHA256, DevelopmentSignerSHA256 = oldProd, oldDev }()
	TrustedSignerSHA256, DevelopmentSignerSHA256 = strings.Repeat("A", 64), strings.Repeat("A", 64)
	path, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifySignature(context.Background(), path); err == nil {
		t.Fatal("unsigned test executable passed pinned Authenticode")
	}
}
