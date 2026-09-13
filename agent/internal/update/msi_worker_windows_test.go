//go:build windows

package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// This launches the real fixed coordinator as an ordinary test user. The
// deliberately unsigned payload must fail before msiexec can ever be started.
func TestMSIWorkerSurvivesCallerCancellationAndRejectsUnsigned(t *testing.T) {
	host := &WindowsHost{Root: t.TempDir()}
	fake := stagedMSI(t, "")
	if err := recoverMSILocked(context.Background(), fake, fake.state); err != nil {
		t.Fatal(err)
	}
	state := fake.state
	data := []byte("unsigned test payload; never executable")
	digest := sha256.Sum256(data)
	state.Pending.SHA256, state.Pending.Size = hex.EncodeToString(digest[:]), int64(len(data))
	if err := os.WriteFile(filepath.Join(host.Root, "candidate.msi"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := host.Save(state); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := host.LaunchMSI(ctx, state); err != nil {
		t.Fatal(err)
	}
	cancel()
	state, err := host.Load()
	if err != nil {
		t.Fatal(err)
	}
	if state.MSI.WorkerPID == 0 || state.MSI.WorkerStarted == 0 {
		t.Fatal("worker launch not durably acknowledged")
	}
	deadline := time.Now().Add(90 * time.Second)
	for {
		result, running, err := host.MSIResult(context.Background(), state)
		if err != nil {
			t.Fatal(err)
		}
		if !running {
			if result == nil || result.TransactionID != state.TransactionID || result.ExitCode != 1603 || result.Detail != "MSI_VERIFICATION_FAILED" {
				t.Fatalf("unsigned MSI did not fail in the verification phase: %+v", result)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("coordinator did not terminate")
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func TestMSIMissingExitCodeIsNotSuccess(t *testing.T) {
	host := &WindowsHost{Root: t.TempDir()}
	fake := stagedMSI(t, "")
	if err := recoverMSILocked(context.Background(), fake, fake.state); err != nil {
		t.Fatal(err)
	}
	if err := atomicJSON(filepath.Join(host.Root, "msi-result.json"), map[string]string{"transaction_id": testTransaction, "detail": "MSI_FINISHED"}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := host.MSIResult(context.Background(), fake.state); err == nil {
		t.Fatal("missing exit code became success")
	}
}
