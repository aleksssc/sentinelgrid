package update

import (
	"context"
	"errors"
	"testing"
	"time"
)

type timeoutHealthHost struct {
	fakeHost
	validations int
}

func (h *timeoutHealthHost) Healthy(context.Context, string) error {
	h.validations++
	if h.binary == "new" {
		return context.DeadlineExceeded
	}
	return nil
}

func TestHealthTimeoutRollsBack(t *testing.T) {
	h := &timeoutHealthHost{fakeHost: fakeHost{binary: "old"}}
	err := Install(context.Background(), h, "0.1.5", Release{Version: "0.1.6"})
	if !errors.Is(err, context.DeadlineExceeded) || h.validations != 2 || h.binary != "old" || h.state.Status != "rolled_back" {
		t.Fatalf("health timeout not recovered: %+v %v", h, err)
	}
}

func TestShutdownPreservesCriticalJournalForBoot(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h := &fakeHost{binary: "new", backup: "old", state: stagingState()}
	h.state.Status = "restarting"
	if err := RecoverLocked(ctx, h, h.state); err == nil {
		t.Fatal("cancelled recovery ran")
	}
	if h.binary != "new" || h.backup != "old" || h.state.Status != "restarting" || h.starts != 0 {
		t.Fatal("shutdown destroyed recovery intent")
	}
	_ = RecoverLocked(context.Background(), h, h.state)
	if h.binary != "old" || h.state.Status != "rolled_back" {
		t.Fatal("boot did not recover preserved journal")
	}
}

func TestExpiredHandoffRejected(t *testing.T) {
	r := testRelease()
	r.ExpiresAt = time.Now().Add(-time.Second)
	h := &fakeHost{state: stagingState()}
	if err := handoffLocked(context.Background(), h, h.state, r, func(State) error { return nil }, func(context.Context) error { return nil }); err == nil {
		t.Fatal("expired policy dispatched")
	}
}
