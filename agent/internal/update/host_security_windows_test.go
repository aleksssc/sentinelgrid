//go:build windows

package update

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWindowsPinnedCandidateCannotBeChanged(t *testing.T) {
	path := filepath.Join(t.TempDir(), "candidate.exe")
	if err := os.WriteFile(path, []byte("candidate"), 0600); err != nil {
		t.Fatal(err)
	}
	file, err := pinFile(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := os.WriteFile(path, []byte("changed"), 0600); err == nil {
		t.Fatal("pinned candidate overwritten")
	}
	if err := os.Remove(path); err == nil {
		t.Fatal("pinned candidate removed")
	}
}

func TestWindowsJournalAndFailedVersionsPersist(t *testing.T) {
	h := &WindowsHost{Root: t.TempDir()}
	s := stagingState()
	s.Status = "rolled_back"
	s.CompletedAt = time.Now()
	rememberFailure(&s)
	if err := h.Save(s); err != nil {
		t.Fatal(err)
	}
	restarted := &WindowsHost{Root: h.Root}
	loaded, err := restarted.Load()
	if err != nil {
		t.Fatal(err)
	}
	if allowed, err := versionAllowed("0.1.5", "0.1.6", loaded); err != nil || allowed {
		t.Fatal("failed version forgotten after restart")
	}
}

func TestWindowsMissingUpdaterReadiness(t *testing.T) {
	h := &WindowsHost{Root: t.TempDir(), InstallDir: t.TempDir()}
	if err := h.checkRecovery(context.Background()); err == nil {
		t.Fatal("missing updater passed readiness")
	}
}

func TestWindowsMaintenanceMarkerBlocksDispatch(t *testing.T) {
	h := &WindowsHost{Root: t.TempDir()}
	if err := atomicJSON(filepath.Join(h.Root, "maintenance.json"), struct{}{}); err != nil {
		t.Fatal(err)
	}
	if err := h.CanDispatch(context.Background()); err == nil {
		t.Fatal("MSI maintenance allowed dispatch")
	}
}

func TestWindowsCleanupRetainsTerminalFailureBackup(t *testing.T) {
	h := &WindowsHost{Root: t.TempDir()}
	s := stagingState()
	s.Status = "failed"
	s.Error = "ROLLBACK_FAILED"
	s.CompletedAt = time.Now()
	s.Attempts = maxRecoveryAttempts
	if err := h.Save(s); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(h.Root, "previous.exe")
	if err := os.WriteFile(path, []byte("required backup"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := h.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		t.Fatal("required rollback backup deleted")
	} else if err != nil {
		t.Fatal(err)
	}
}
