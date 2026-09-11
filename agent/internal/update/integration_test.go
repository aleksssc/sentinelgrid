package update

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const testTransaction = "11111111-1111-4111-8111-111111111111"

func stagingState() State {
	return State{Status: "downloading", Target: "0.1.6", Previous: "0.1.5", TransactionID: testTransaction}
}

func testRelease() Release {
	return Release{Product: "SentinelGridAgent", Platform: "windows", Architecture: "amd64", Version: "0.1.6", Channel: "beta", SHA256: strings.Repeat("a", 64), Size: 42, DownloadURL: "https://example.invalid/secret-url", ExpiresAt: time.Now().Add(10 * time.Minute)}
}

func TestSuccessfulHandoffAndLockReservation(t *testing.T) {
	h := &fakeHost{state: stagingState(), binary: "old"}
	unlock, err := h.Lock()
	if err != nil {
		t.Fatal(err)
	}
	if err := handoffLocked(context.Background(), h, h.state, testRelease(), func(s State) error {
		if s.Authorized {
			t.Fatal("authorized before server receipt")
		}
		if _, err := h.Lock(); err == nil {
			t.Fatal("duplicate update lock")
		}
		return nil
	}, func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if err := unlock(); err != nil {
		t.Fatal(err)
	}
	if availableForStage(h.state) || !h.state.Authorized || h.state.Pending == nil || h.binary != "old" || h.starts != 0 {
		t.Fatalf("unsafe handoff: %+v", h)
	}
	data, err := json.Marshal(h.state)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"download_url", "agent_token", "secret-url", "destination", "service_name", "arguments"} {
		if strings.Contains(string(data), forbidden) {
			t.Fatalf("pending leaked %s", forbidden)
		}
	}
}

func TestInvalidPendingMetadata(t *testing.T) {
	for _, data := range []string{
		`{"schema":1,"version":"0.1.6","channel":"beta","sha256":"bad","size_bytes":42}`,
		`{"schema":1,"version":"0.1.6","url":"https://example.invalid"}`,
		`{"schema":1,"path":"C:\\evil.exe"}`,
		`{"schema":1} {}`,
	} {
		var p Pending
		err := strictJSON([]byte(data), &p)
		if err == nil {
			err = p.Validate()
		}
		if err == nil {
			t.Fatalf("invalid metadata accepted: %s", data)
		}
	}
	s := stagingState()
	s.Status = "staged"
	if s.Validate() == nil {
		t.Fatal("staged without verified metadata")
	}
	s = stagingState()
	s.Previous = "0.1.7"
	if s.Validate() == nil {
		t.Fatal("journal downgrade")
	}
}

func TestReadinessChecksFailClosed(t *testing.T) {
	for _, reason := range []string{"updater missing", "updater wrong signer", "service missing", "unsafe ACL", "journal not writable", "untrusted pins", "incompatible version", "reparse point"} {
		t.Run(reason, func(t *testing.T) {
			checks := []readinessCheck{{reason, func(context.Context) error { return errors.New(reason) }}}
			if evaluateReadiness(context.Background(), true, checks) == nil {
				t.Fatal("readiness succeeded")
			}
		})
	}
	checks := []readinessCheck{{"test prerequisite", func(context.Context) error { return nil }}}
	if evaluateReadiness(context.Background(), true, checks) != nil {
		t.Fatal("complete prerequisites rejected")
	}
	if evaluateReadiness(context.Background(), false, checks) == nil {
		t.Fatal("source gate bypassed")
	}
}

func TestShutdownAndMaintenancePreventHandoff(t *testing.T) {
	for _, mode := range []string{"shutdown", "MSI", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			h := &fakeHost{state: stagingState(), binary: "old"}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancel" {
				cancel()
			}
			err := handoffLocked(ctx, h, h.state, testRelease(), func(State) error { t.Fatal("dispatch authorized while blocked"); return nil }, func(ctx context.Context) error { return dispatchAllowed(ctx, mode == "shutdown", mode == "MSI") })
			if err == nil || h.state.Authorized || h.starts != 0 {
				t.Fatal("blocked dispatch ran")
			}
		})
	}
}

func TestRebootRecoveryBeforeReplacement(t *testing.T) {
	for _, phase := range []string{"downloading", "staged"} {
		h := &fakeHost{binary: "old", backup: "old", state: stagingState()}
		h.state.Status = phase
		if err := RecoverLocked(context.Background(), h, h.state); err != nil {
			t.Fatal(err)
		}
		if h.binary != "old" || h.starts != 0 || h.state.Status != "failed" || h.state.CompletedAt.IsZero() {
			t.Fatalf("unsafe pre-replacement recovery: %+v", h)
		}
		if ok, err := versionAllowed("0.1.5", "0.1.6", h.state); err != nil || ok {
			t.Fatal("interrupted version retried")
		}
	}
}

func TestRebootAndUpdaterCrashAfterReplacement(t *testing.T) {
	for _, phase := range []string{"installing", "restarting", "failed"} {
		h := &fakeHost{binary: "new", backup: "old", state: stagingState()}
		h.state.Status = phase
		if err := RecoverLocked(context.Background(), h, h.state); err == nil {
			t.Fatal("recovery cause not surfaced")
		}
		if h.binary != "old" || h.state.Status != "rolled_back" || h.state.Attempts != 1 {
			t.Fatalf("recovery failed: %+v", h)
		}
	}
}

type failingRestoreHost struct {
	fakeHost
	restores int
}

func (h *failingRestoreHost) Restore() error { h.restores++; return errors.New("restore failed") }

func TestRollbackFailureBoundedAcrossRestarts(t *testing.T) {
	h := &failingRestoreHost{fakeHost: fakeHost{binary: "new", backup: "old", state: stagingState()}}
	h.state.Status = "restarting"
	for i := 0; i < 10; i++ {
		_ = RecoverLocked(context.Background(), h, h.state)
		data, err := json.Marshal(h.state)
		if err != nil {
			t.Fatal(err)
		}
		var reloaded State
		if err := strictJSON(data, &reloaded); err != nil {
			t.Fatal(err)
		}
		h.state = reloaded
	}
	if h.restores != maxRecoveryAttempts || h.state.Error != "ROLLBACK_FAILED" || h.backup != "old" || h.state.CompletedAt.IsZero() {
		t.Fatalf("unbounded/lost recovery: %+v", h)
	}
	if len(cleanupNames(h.state)) != 0 || availableForStage(h.state) {
		t.Fatal("terminal failure lost backup or allowed another update")
	}
}

func TestFailedVersionHistorySurvivesSerialization(t *testing.T) {
	s := stagingState()
	rememberFailure(&s)
	s.Target = "0.1.7"
	rememberFailure(&s)
	data, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var recovered State
	if err := strictJSON(data, &recovered); err != nil {
		t.Fatal(err)
	}
	for _, v := range []string{"0.1.6", "0.1.6+repacked", "0.1.7"} {
		if allowed, err := versionAllowed("0.1.5", v, recovered); err != nil || allowed {
			t.Fatalf("failed version retried: %s", v)
		}
	}
}

func TestAuthenticatedHeartbeatHealth(t *testing.T) {
	now := time.Now()
	h := Health{Version: "0.1.6", TransactionID: testTransaction, PID: 42, ProcessStarted: 123, At: now.Add(-time.Second)}
	matches := func(health Health, since time.Time) bool {
		return healthMatches(health, "0.1.6", testTransaction, 42, 123, now.Add(-time.Minute), since, now)
	}
	if !matches(h, now.Add(-61*time.Second)) {
		t.Fatal("healthy heartbeat rejected")
	}
	if matches(h, now.Add(-59*time.Second)) {
		t.Fatal("stable process threshold bypassed")
	}
	for _, mutate := range []func(*Health){
		func(h *Health) { h.Version = "0.1.5" }, func(h *Health) { h.PID++ },
		func(h *Health) { h.ProcessStarted++ }, func(h *Health) { h.TransactionID = "" },
		func(h *Health) { h.At = now.Add(-91 * time.Second) }, func(h *Health) { h.At = now.Add(time.Minute) },
	} {
		invalid := h
		mutate(&invalid)
		if matches(invalid, now.Add(-time.Minute)) {
			t.Fatal("invalid/stale heartbeat accepted")
		}
	}
}

func TestStaleCleanupPreservesRequiredFiles(t *testing.T) {
	for _, phase := range []string{"downloading", "staged", "installing", "restarting", "failed"} {
		s := stagingState()
		s.Status = phase
		if len(cleanupNames(s)) != 0 {
			t.Fatalf("cleaned active %s", phase)
		}
	}
	s := stagingState()
	s.Status = "rolled_back"
	s.CompletedAt = time.Now()
	for _, name := range cleanupNames(s) {
		if name == "state.json" || strings.ContainsAny(name, `\/`) {
			t.Fatalf("unsafe cleanup: %s", name)
		}
	}
	if len(cleanupNames(s)) != 3 {
		t.Fatal("known stale artifacts not selected")
	}
}

func TestAuthorizationFailureNeverPublishes(t *testing.T) {
	h := &fakeHost{state: stagingState()}
	err := handoffLocked(context.Background(), h, h.state, testRelease(), func(State) error { return errors.New("policy revoked") }, func(context.Context) error { return nil })
	if err == nil || h.state.Authorized {
		t.Fatal("unauthorized handoff published")
	}
}
