package rdp

import (
	"errors"
	"strings"
	"testing"
)

func TestSanitizeRemoteLogErrorRemovesSensitiveValues(t *testing.T) {
	err := errors.New("relay failed at wss://relay.example.test/connect?ticket=secret ticket=abc agent_token=def cookie=session Bearer credential")
	got := sanitizeRemoteLogError(err)
	for _, value := range []string{"relay failed", "[url]", "ticket=[redacted]", "agent_token=[redacted]", "cookie=[redacted]", "Bearer [redacted]"} {
		if !strings.Contains(got, value) {
			t.Fatalf("sanitized log %q does not contain %q", got, value)
		}
	}
	for _, secret := range []string{"secret", "abc", "def", "session", "credential"} {
		if strings.Contains(got, secret) {
			t.Fatalf("sanitized log leaked %q: %q", secret, got)
		}
	}
}

func TestSanitizeRemoteLogErrorNormalizesEmptyAndNil(t *testing.T) {
	if got := sanitizeRemoteLogError(nil); got != "none" {
		t.Fatalf("nil error = %q, want none", got)
	}
	if got := sanitizeRemoteLogError(errors.New(" \n\t ")); got != "unknown" {
		t.Fatalf("empty error = %q, want unknown", got)
	}
}
