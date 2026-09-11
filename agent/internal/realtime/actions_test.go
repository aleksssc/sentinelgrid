package realtime

import (
	"context"
	"testing"
)

func TestValidateDelay(t *testing.T) {
	if delay, ok := validateDelay(map[string]any{"delay_seconds": float64(30)}); !ok || delay != 30 {
		t.Fatalf("expected valid delay, got %d, %v", delay, ok)
	}

	if _, ok := validateDelay(map[string]any{"delay_seconds": float64(3601)}); ok {
		t.Fatal("expected out-of-range delay to be rejected")
	}
}

func TestValidateForce(t *testing.T) {
	if force, ok := validateForce(map[string]any{"force": true}); !ok || !force {
		t.Fatal("expected boolean force payload")
	}

	if _, ok := validateForce(map[string]any{"force": "true"}); ok {
		t.Fatal("expected non-boolean force payload to be rejected")
	}
}

func TestUnsupportedTypedAction(t *testing.T) {
	_, code, err := executeTypedAction(context.Background(), "powershell", nil)
	if err == nil || code != "UNSUPPORTED_COMMAND" {
		t.Fatalf("expected unsupported command, got code=%s err=%v", code, err)
	}
}
