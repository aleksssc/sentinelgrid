package update

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeMSIHost struct {
	fakeHost
	launches    int
	healthCalls int
	result      *MSIResult
	running     bool
	healthError error
	saved       []string
}

func (h *fakeMSIHost) Save(s State) error {
	if err := s.Validate(); err != nil {
		return err
	}
	h.saved = append(h.saved, s.Status)
	h.state = s
	return nil
}
func (h *fakeMSIHost) PrepareMSI(context.Context, State) (*MSIProgress, error) {
	return &MSIProgress{StartedAt: time.Now().UTC(), PreviousPID: 42, PreviousProcessStarted: 123, ConfigSHA256: strings.Repeat("a", 64)}, nil
}
func (h *fakeMSIHost) LaunchMSI(_ context.Context, s State) error {
	h.launches++
	h.running = true
	return nil
}
func (h *fakeMSIHost) MSIResult(context.Context, State) (*MSIResult, bool, error) {
	return h.result, h.running, nil
}
func (h *fakeMSIHost) ProductHealthy(_ context.Context, s State) error {
	h.healthCalls++
	if h.state.Status != "awaiting_health" || s.MSI.ExitCode == nil {
		return errors.New("health before installer result")
	}
	return h.healthError
}
func msiRelease() Release {
	r := testRelease()
	r.ArtifactType = "msi"
	r.UpdateProtocol = 2
	r.SignerSHA256 = strings.Repeat("A", 64)
	return r
}
func stagedMSI(t *testing.T, command string) *fakeMSIHost {
	t.Helper()
	h := &fakeMSIHost{fakeHost: fakeHost{state: stagingState(), binary: "old"}}
	h.state.CommandID = command
	if err := handoffLocked(context.Background(), h, h.state, msiRelease(), func(State) error { return nil }, func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	return h
}
func restartMSIJournal(t *testing.T, h *fakeMSIHost) {
	t.Helper()
	bytes, err := json.Marshal(h.state)
	if err != nil {
		t.Fatal(err)
	}
	var state State
	if err := strictJSON(bytes, &state); err != nil {
		t.Fatal(err)
	}
	if err := state.Validate(); err != nil {
		t.Fatal(err)
	}
	h.state = state
}
func TestAutoAndForceUseSameMSIInstallation(t *testing.T) {
	for _, command := range []string{"", testTransaction} {
		t.Run("command="+command, func(t *testing.T) {
			h := stagedMSI(t, command)
			if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
				t.Fatal(err)
			}
			if h.launches != 1 || h.state.Status != "installing" || h.starts != 0 || h.backup != "" {
				t.Fatal("MSI did not own service/binary lifecycle")
			}
			restartMSIJournal(t, h)
			if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
				t.Fatal(err)
			}
			if h.launches != 1 || h.healthCalls != 0 {
				t.Fatal("installer relaunched or health premature")
			}
			h.running = false
			h.result = &MSIResult{TransactionID: testTransaction, ExitCode: 0, Detail: "MSI_FINISHED"}
			if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
				t.Fatal(err)
			}
			if h.state.Status != "succeeded" || h.healthCalls != 1 || h.state.CommandID != command || h.state.TransactionID != testTransaction {
				t.Fatal("lost health/correlation")
			}
			if strings.Join(h.saved, ",") != "staged,staged,installing,awaiting_health,succeeded" {
				t.Fatalf("wrong phase order %v", h.saved)
			}
		})
	}
}
func TestMSIInstallFailureNeverRunsEXERollback(t *testing.T) {
	h := stagedMSI(t, "")
	if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
		t.Fatal(err)
	}
	h.running = false
	h.result = &MSIResult{TransactionID: testTransaction, ExitCode: 1603, Detail: "MSI_FINISHED"}
	if err := recoverMSILocked(context.Background(), h, h.state); err == nil {
		t.Fatal("failure hidden")
	}
	if h.state.Status != "failed" || h.healthCalls != 0 || h.binary != "old" || h.starts != 0 || h.state.MSI.ExitCode == nil || *h.state.MSI.ExitCode != 1603 {
		t.Fatal("failure claimed success or EXE rollback ran")
	}
}
func TestMSIRequiresWholeProductAndConfigHealth(t *testing.T) {
	for _, reason := range []string{"Agent version mismatch", "Updater version mismatch", "RDP version mismatch", "agent.json changed", "heartbeat absent", "old Agent process", "MSI commit missing"} {
		t.Run(reason, func(t *testing.T) {
			h := stagedMSI(t, testTransaction)
			if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
				t.Fatal(err)
			}
			h.running = false
			h.result = &MSIResult{TransactionID: testTransaction, ExitCode: 0, Detail: "MSI_FINISHED"}
			h.healthError = errors.New(reason)
			if err := recoverMSILocked(context.Background(), h, h.state); err == nil {
				t.Fatal("invalid health accepted")
			}
			if h.state.Status != "failed" || !h.state.MSI.RepairRequired || availableForStage(h.state) || len(cleanupNames(h.state)) != 0 {
				t.Fatal("unsafe product accepted/cleaned")
			}
		})
	}
}
func TestMSIRestartWithoutResultFailsClosed(t *testing.T) {
	h := stagedMSI(t, "")
	if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
		t.Fatal(err)
	}
	restartMSIJournal(t, h)
	h.running = false
	if err := recoverMSILocked(context.Background(), h, h.state); err == nil {
		t.Fatal("unknown result accepted")
	}
	if h.state.Status != "failed" || !h.state.MSI.RepairRequired || h.launches != 1 || h.healthCalls != 0 {
		t.Fatal("ambiguous install retried")
	}
}
func TestMSIRebootRequiredWaitsForHealth(t *testing.T) {
	h := stagedMSI(t, "")
	if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
		t.Fatal(err)
	}
	h.running = false
	h.result = &MSIResult{TransactionID: testTransaction, ExitCode: 3010, Detail: "MSI_FINISHED"}
	h.healthError = errors.New("reboot pending")
	if err := recoverMSILocked(context.Background(), h, h.state); err == nil {
		t.Fatal("reboot hidden")
	}
	if h.state.Status != "awaiting_health" || !Active(h.state) {
		t.Fatal("reboot-required claimed success")
	}
	restartMSIJournal(t, h)
	h.healthError = nil
	if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
		t.Fatal(err)
	}
	if h.state.Status != "succeeded" || h.launches != 1 {
		t.Fatal("reboot recovery failed")
	}
}
func TestMSIPolicyVersionAndLegacyRecoveryGuards(t *testing.T) {
	for _, target := range []string{"0.1.4", "0.1.5"} {
		h := stagedMSI(t, "")
		h.state.Target = target
		h.state.Pending.Version = target
		if err := recoverMSILocked(context.Background(), h, h.state); err == nil || h.launches != 0 {
			t.Fatal("downgrade/replay accepted")
		}
	}
	h := stagedMSI(t, "")
	h.state.Authorized = false
	if err := recoverMSILocked(context.Background(), h, h.state); err == nil || h.launches != 0 {
		t.Fatal("unauthorized MSI ran")
	}
	h = stagedMSI(t, "")
	h.state.Pending.NotAfter = time.Now().Add(-time.Minute)
	if err := recoverMSILocked(context.Background(), h, h.state); err == nil || h.launches != 0 {
		t.Fatal("expired MSI ran")
	}
	h = stagedMSI(t, "")
	if err := RecoverLocked(context.Background(), h, h.state); err == nil {
		t.Fatal("MSI passed through legacy recovery")
	}
	if err := installLocked(context.Background(), h, h.state, "0.1.5", msiRelease()); err == nil {
		t.Fatal("MSI passed through legacy replacement")
	}
}
func TestMSIDownloadingCrashAndCancelledHealth(t *testing.T) {
	h := stagedMSI(t, "")
	h.state.Status = "downloading"
	if err := recoverMSILocked(context.Background(), h, h.state); err == nil || h.state.Status != "failed" || h.launches != 0 {
		t.Fatal("download recovery unsafe")
	}
	h = stagedMSI(t, "")
	if err := recoverMSILocked(context.Background(), h, h.state); err != nil {
		t.Fatal(err)
	}
	h.running = false
	h.result = &MSIResult{TransactionID: testTransaction, ExitCode: 0, Detail: "MSI_FINISHED"}
	h.healthError = context.Canceled
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := recoverMSILocked(ctx, h, h.state); err == nil || h.state.Status != "awaiting_health" {
		t.Fatal("SCM cancellation lost resumable health")
	}
}
