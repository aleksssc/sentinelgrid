package rdp

import (
	"errors"
	"testing"
)

func TestPairingCategory(t *testing.T) {
	for _, category := range []string{"handshake", "rejected", "ready_read", "ready_invalid", "cancelled"} {
		err := &PairingError{Category: category, err: errors.New("redacted")}
		if got := pairingCategory(err); got != category {
			t.Fatalf("category = %q, want %q", got, category)
		}
	}
	if got := pairingCategory(errors.New("unclassified")); got != "unknown" {
		t.Fatalf("unknown category = %q", got)
	}
}
