//go:build windows

package update

import (
	"path/filepath"
	"testing"
	"time"
)

func TestDeviceCommandJournalSurvivesProcessRestartAndKeepsUpdateJournal(t *testing.T) {
	host := &WindowsHost{Root: t.TempDir()}
	state := stagingState()
	if err := host.Save(state); err != nil {
		t.Fatal(err)
	}
	const id = "12345678-1234-1234-1234-123456789abc"
	if err := host.commandJournal(func(c *DeviceCommand) error {
		*c = DeviceCommand{ID: id, Type: "gpupdate", Key: "key", Status: "failed", Deadline: time.Now().Add(time.Minute), ErrorCode: "GPUPDATE_FAILED", Result: map[string]any{"exit_code": 5, "stderr": "rejected"}}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	restarted := &WindowsHost{Root: host.Root}
	if err := restarted.commandJournal(func(c *DeviceCommand) error {
		if c.ID != id || c.ErrorCode != "GPUPDATE_FAILED" || c.Result["stderr"] != "rejected" {
			t.Fatalf("journal result lost: %+v", c)
		}
		c.Reported = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	after, err := host.Load()
	if err != nil || after.TransactionID != state.TransactionID || after.Status != state.Status {
		t.Fatal("update journal modified", err)
	}
	var saved DeviceCommand
	if err := readMetadata(filepath.Join(host.Root, "command.json"), &saved); err != nil || !saved.Reported {
		t.Fatal("receipt not persisted", err)
	}
}
