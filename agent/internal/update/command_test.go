package update

import (
	"testing"
	"time"
)

func TestCommandRecoveryRequiresNewProcessOrBootAndHeartbeat(t *testing.T) {
	now := time.Now()
	for _, kind := range []string{"restart_agent", "reboot", "shutdown"} {
		phase := "power_pending"
		if kind == "restart_agent" {
			phase = "restart_pending"
		}
		c := DeviceCommand{ID: "command", Type: kind, Status: "running", Phase: phase, PID: 1, ProcessStarted: 10, Boot: "boot-a", Deadline: now.Add(time.Minute)}
		same := recoveredCommand(c, 1, 10, "boot-a", now)
		if same.Status != "running" {
			t.Fatalf("%s completed in original process", kind)
		}
		nextBoot := "boot-b"
		if kind == "restart_agent" {
			nextBoot = "boot-a"
		}
		next := recoveredCommand(c, 2, 20, nextBoot, now)
		if next.Status != "succeeded" || next.Result["confirmation"] == nil {
			t.Fatalf("%s missing confirmation: %+v", kind, next)
		}
	}
}

func TestCommandRecoveryDoesNotReplayInterruptedWork(t *testing.T) {
	now := time.Now()
	for _, kind := range []string{"force_inventory", "flush_dns", "gpupdate", "lock"} {
		c := DeviceCommand{ID: "command", Type: kind, Status: "running", PID: 1, ProcessStarted: 10, Boot: "a", Deadline: now.Add(time.Minute)}
		recovered := recoveredCommand(c, 2, 20, "a", now)
		if recovered.Status != "failed" || recovered.ErrorCode != "COMMAND_INTERRUPTED" {
			t.Fatalf("unsafe replay: %+v", recovered)
		}
	}
}

func TestCommandDeadlineAndTerminalState(t *testing.T) {
	now := time.Now()
	c := DeviceCommand{ID: "command", Type: "gpupdate", Status: "running", PID: 1, ProcessStarted: 10, Boot: "a", Deadline: now.Add(-time.Second)}
	if recovered := recoveredCommand(c, 1, 10, "a", now); recovered.ErrorCode != "COMMAND_TIMEOUT" {
		t.Fatal(recovered)
	}
	c.Status = "succeeded"
	if recovered := recoveredCommand(c, 2, 20, "b", now); recovered.Status != "succeeded" {
		t.Fatal("terminal state regressed")
	}
	c.Status, c.Type, c.Phase = "running", "reboot", "power_pending"
	c.Deadline = now.Add(time.Minute)
	if recovered := recoveredCommand(c, 2, 20, "a", now); recovered.Status == "succeeded" {
		t.Fatal("process restart incorrectly proved reboot")
	}
	c.Phase = "power_prepared"
	if recovered := recoveredCommand(c, 2, 20, "b", now); recovered.Status == "succeeded" {
		t.Fatal("unaccepted power intent incorrectly proved reboot")
	}
}
