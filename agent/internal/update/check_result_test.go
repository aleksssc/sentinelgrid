package update

import (
	"errors"
	"testing"
)

func TestUpdateCheckCommandFeedback(t *testing.T) {
	for _, test := range []struct {
		name, current, target, code string
		available                   bool
	}{
		{"already current", "0.1.7", "0.1.7", "NO_NEWER_AGENT_VERSION", false},
		{"older channel release", "0.1.8", "0.1.7", "NO_NEWER_AGENT_VERSION", false},
		{"failed newer release", "0.1.7", "0.1.8", "UPDATE_RELEASE_BLOCKED", true},
		{"unavailable newer release", "0.1.7", "0.1.8", "NO_ELIGIBLE_AGENT_RELEASE", false},
		{"invalid version", "invalid", "0.1.8", "UPDATE_FAILED", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := noUpdateReason(test.current, test.target, test.available)
			if got := CommandErrorCode(errors.Join(err, nil, nil)); got != test.code {
				t.Fatalf("got %s, want %s (%v)", got, test.code, err)
			}
		})
	}
	if got := CommandErrorCode(errInstallationDisabled); got != "UPDATE_POLICY_DISABLED" {
		t.Fatalf("policy failure misclassified: %s", got)
	}
	if got := CommandErrorCode(errors.Join(errAlreadyCurrent, errors.New("lock cleanup failed"))); got != "UPDATE_FAILED" {
		t.Fatalf("cleanup error hidden: %s", got)
	}
	if got := CommandErrorCode(errors.New("download signature failed")); got != "UPDATE_FAILED" {
		t.Fatalf("installation failure misclassified: %s", got)
	}
}
