//go:build windows

package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMSISHAAndSignerFailures(t *testing.T) {
	path := filepath.Join(t.TempDir(), "candidate.msi")
	data := []byte("not a signed MSI")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	r := msiRelease()
	r.Size = int64(len(data))
	sum := sha256.Sum256(data)
	r.SHA256 = hex.EncodeToString(sum[:])
	for _, reason := range []string{"unsigned MSI", "wrong signer"} {
		called := false
		if err := VerifyArtifact(context.Background(), path, r, func(context.Context, string) error { called = true; return errors.New(reason) }); err == nil || !called {
			t.Fatal("signature failure ignored")
		}
	}
	r.SHA256 = strings.Repeat("a", 64)
	if err := VerifyArtifact(context.Background(), path, r, func(context.Context, string) error { t.Fatal("signature attempted before hash validation"); return nil }); err == nil {
		t.Fatal("bad MSI SHA accepted")
	}
	oldProd, oldDev := TrustedSignerSHA256, DevelopmentSignerSHA256
	defer func() { TrustedSignerSHA256, DevelopmentSignerSHA256 = oldProd, oldDev }()
	if developmentBuild {
		DevelopmentSignerSHA256 = strings.Repeat("A", 64)
	} else {
		TrustedSignerSHA256 = strings.Repeat("A", 64)
	}
	if err := VerifySignature(context.Background(), path); err == nil {
		t.Fatal("native Authenticode accepted unsigned MSI")
	}
}
func TestMSIJournalAndConfigSurviveRestart(t *testing.T) {
	root := t.TempDir()
	h := &WindowsHost{Root: root}
	path := filepath.Join(root, "agent.json")
	config := []byte(`{"device_id":"existing","agent_token":"test-only"}`)
	if err := os.WriteFile(path, config, 0600); err != nil {
		t.Fatal(err)
	}
	before, err := configDigest(path)
	if err != nil {
		t.Fatal(err)
	}
	fake := stagedMSI(t, testTransaction)
	if err := recoverMSILocked(context.Background(), fake, fake.state); err != nil {
		t.Fatal(err)
	}
	if err := h.Save(fake.state); err != nil {
		t.Fatal(err)
	}
	restarted := &WindowsHost{Root: root}
	state, err := restarted.Load()
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != "installing" || state.Pending.Schema != 2 || state.CommandID != testTransaction {
		t.Fatal("MSI journal lost")
	}
	state.Status = "succeeded"
	code := 0
	state.MSI.ExitCode = &code
	state.CompletedAt = state.MSI.StartedAt
	if err := restarted.Save(state); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"candidate.msi", "msi-result.json", "msi-outcome.json"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := restarted.Commit(); err != nil {
		t.Fatal(err)
	}
	after, err := configDigest(path)
	if err != nil || after != before {
		t.Fatal("cleanup modified configuration")
	}
	if _, err := restarted.Load(); err != nil {
		t.Fatal("cleanup lost transaction")
	}
}
func TestMSIScriptsParseWithoutExecution(t *testing.T) {
	for _, script := range []string{msiMetadataValidation, msiWorker} {
		_, err := systemPowerShell(context.Background(), `$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseInput($env:SG_TEST_SCRIPT,[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Invalid MSI coordinator syntax'}`, "SG_TEST_SCRIPT="+script)
		if err != nil {
			t.Fatal(err)
		}
	}
}
