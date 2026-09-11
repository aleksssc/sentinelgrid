package update

import (
	"context"
	"errors"
	"testing"
)

type fakeHost struct {
	state     State
	locked    bool
	fail      string
	binary    string
	backup    string
	starts    int
	committed bool
}

func (h *fakeHost) Lock() (func() error, error) {
	if h.locked {
		return nil, errors.New("locked")
	}
	h.locked = true
	return func() error { h.locked = false; return nil }, nil
}
func (h *fakeHost) Load() (State, error) { return h.state, nil }
func (h *fakeHost) Save(s State) error   { h.state = s; return nil }
func (h *fakeHost) Verify(context.Context, Release) error {
	if h.fail == "verify" {
		return errors.New("invalid signature")
	}
	return nil
}
func (h *fakeHost) Stop(context.Context) error { return nil }
func (h *fakeHost) Backup() error              { h.backup = h.binary; return nil }
func (h *fakeHost) Replace() error {
	h.binary = "new"
	if h.fail == "replace" {
		return errors.New("install failed")
	}
	return nil
}
func (h *fakeHost) Start(context.Context) error {
	h.starts++
	if h.fail == "start" && h.starts == 1 {
		return errors.New("start failed")
	}
	return nil
}
func (h *fakeHost) Healthy(context.Context, string) error {
	if h.fail == "health" && h.binary == "new" {
		return errors.New("health failed")
	}
	return nil
}
func (h *fakeHost) Restore() error { h.binary = h.backup; return nil }
func (h *fakeHost) Commit() error  { h.committed = true; h.backup = ""; return nil }

func TestInstallRollback(t *testing.T) {
	for _, failure := range []string{"replace", "start", "health"} {
		t.Run(failure, func(t *testing.T) {
			h := &fakeHost{binary: "old", fail: failure}
			err := Install(context.Background(), h, "0.1.3", Release{Version: "0.1.4"})
			if err == nil || h.binary != "old" || h.state.Status != "rolled_back" || h.state.FailedVersion != "0.1.4" || h.locked {
				t.Fatalf("rollback failed: %+v %v", h, err)
			}
			if err := Install(context.Background(), h, "0.1.3", Release{Version: "0.1.4"}); err == nil {
				t.Fatal("failed version retried")
			}
		})
	}
}
func TestInstallSuccess(t *testing.T) {
	h := &fakeHost{binary: "old"}
	if err := Install(context.Background(), h, "0.1.3", Release{Version: "0.1.4"}); err != nil {
		t.Fatal(err)
	}
	if h.state.Status != "succeeded" || h.binary != "new" || !h.committed || h.locked || h.state.CompletedAt.IsZero() {
		t.Fatalf("bad success state: %+v", h)
	}
}
func TestUpdateLock(t *testing.T) {
	h := &fakeHost{locked: true, binary: "old"}
	if err := Install(context.Background(), h, "0.1.3", Release{Version: "0.1.4"}); err == nil || h.binary != "old" {
		t.Fatal("concurrent install allowed")
	}
}
func TestInvalidSignatureDoesNotStopAgent(t *testing.T) {
	h := &fakeHost{binary: "old", fail: "verify"}
	if err := Install(context.Background(), h, "0.1.3", Release{Version: "0.1.4"}); err == nil || h.starts != 0 || h.binary != "old" {
		t.Fatal("verification failure modified Agent")
	}
}
func TestCancelledAndStagedUpdate(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	h := &fakeHost{binary: "old"}
	if err := Install(ctx, h, "0.1.3", Release{Version: "0.1.4"}); err == nil || h.starts != 0 {
		t.Fatal("cancelled update ran")
	}
	h.state = State{Status: "staged", Target: "0.1.5"}
	if err := Install(context.Background(), h, "0.1.3", Release{Version: "0.1.4"}); err == nil {
		t.Fatal("replaced another staged update")
	}
}
func TestInterruptedInstallRecovery(t *testing.T) {
	h := &fakeHost{binary: "new", backup: "old", state: State{Status: "installing", Target: "0.1.4", Previous: "0.1.3"}}
	if err := Install(context.Background(), h, "0.1.3", Release{Version: "0.1.4"}); err == nil || h.binary != "old" || h.state.Status != "rolled_back" {
		t.Fatal("interrupted update not recovered")
	}
}
func TestQualificationGate(t *testing.T) {
	if !Qualified && Operational() {
		t.Fatal("unqualified updater advertised")
	}
}
