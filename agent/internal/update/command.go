package update

import "time"

// This journal is only delivery/restart recovery for device_commands, not an update transaction.
type DeviceCommand struct {
	ID             string         `json:"id"`
	Key            string         `json:"key"`
	Type           string         `json:"command_type"`
	Status         string         `json:"status"`
	Phase          string         `json:"phase,omitempty"`
	Deadline       time.Time      `json:"deadline"`
	PID            uint32         `json:"pid"`
	ProcessStarted uint64         `json:"process_started"`
	Boot           string         `json:"boot"`
	Attempts       int            `json:"attempts"`
	Result         map[string]any `json:"result,omitempty"`
	ErrorCode      string         `json:"error_code,omitempty"`
	ErrorMessage   string         `json:"error_message,omitempty"`
	Reported       bool           `json:"reported"`
}

func (c DeviceCommand) Terminal() bool { return c.Status == "succeeded" || c.Status == "failed" }
func (c *DeviceCommand) Fail(code, message string) {
	c.Status, c.ErrorCode, c.ErrorMessage = "failed", code, message
}

func recoveredCommand(c DeviceCommand, pid uint32, created uint64, boot string, now time.Time) DeviceCommand {
	if c.ID == "" || c.Terminal() {
		return c
	}
	if (c.Type == "reboot" || c.Type == "shutdown") && c.Phase == "power_pending" && c.Boot != boot {
		c.Status = "succeeded"
		c.Result = map[string]any{"action": c.Type, "confirmation": "new_boot_authenticated_heartbeat"}
		return c
	}
	if c.Type == "restart_agent" && c.Phase == "restart_pending" && (c.PID != pid || c.ProcessStarted != created) {
		c.Status = "succeeded"
		c.Result = map[string]any{"action": c.Type, "confirmation": "new_process_authenticated_heartbeat"}
		return c
	}
	if now.After(c.Deadline) {
		c.Fail("COMMAND_TIMEOUT", "The operation was not confirmed before its deadline.")
	} else if (c.PID != pid || c.ProcessStarted != created) && c.Type != "shutdown" {
		c.Fail("COMMAND_INTERRUPTED", "The Agent restarted before the operation completed; it will not be executed again.")
	}
	return c
}
