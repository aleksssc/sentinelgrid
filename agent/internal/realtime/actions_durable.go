package realtime

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"sentinelgrid/agent/internal/update"
)

var commandReceipts sync.Map
var actionExecution sync.Mutex

func handleDurableTypedCommand(parent context.Context, conn *websocket.Conn, mu *sync.Mutex, message serverMessage) {
	if _, loaded := processedTypedCommands.LoadOrStore(message.CommandID, struct{}{}); loaded {
		return
	}
	defer processedTypedCommands.Delete(message.CommandID)
	if !actionExecution.TryLock() {
		sendTypedResult(conn, mu, typedCommandResult{Type: "typed_command_result", CommandID: message.CommandID, Status: "failed", ErrorCode: "COMMAND_BUSY", ErrorMessage: "Another device command is already running."})
		return
	}
	defer actionExecution.Unlock()
	fail := func(code string, err error) {
		sendTypedResult(conn, mu, typedCommandResult{Type: "typed_command_result", CommandID: message.CommandID, Status: "failed", ErrorCode: code, ErrorMessage: safeActionError(err)})
	}
	deadline, err := time.Parse(time.RFC3339, message.ExpiresAt)
	if err != nil || !time.Now().Before(deadline) {
		fail("COMMAND_EXPIRED", fmt.Errorf("the command has expired"))
		return
	}
	if deadline.After(time.Now().Add(95 * time.Minute)) {
		fail("INVALID_PAYLOAD", fmt.Errorf("invalid command deadline"))
		return
	}
	if err := validateActionPayload(message.CommandType, message.Payload); err != nil {
		fail("INVALID_PAYLOAD", err)
		return
	}
	pid, created, boot, err := update.CommandIdentity()
	if err != nil {
		fail("COMMAND_IDENTITY_FAILED", err)
		return
	}
	var existing bool
	err = update.CommandJournal(parent, func(c *update.DeviceCommand) error {
		if c.ID == message.CommandID || c.Key == message.IdempotencyKey {
			existing = true
			return nil
		}
		if c.ID != "" && !c.Reported {
			return fmt.Errorf("another device command is awaiting completion or delivery")
		}
		*c = update.DeviceCommand{ID: message.CommandID, Key: message.IdempotencyKey, Type: message.CommandType, Status: "running", Phase: "preparing", Deadline: deadline, PID: pid, ProcessStarted: created, Boot: boot}
		return nil
	})
	if err != nil {
		fail("COMMAND_JOURNAL_FAILED", err)
		return
	}
	if existing {
		replayTypedResult(parent, conn, mu)
		return
	}
	receipt := make(chan string, 1)
	commandReceipts.Store(message.CommandID, receipt)
	defer commandReceipts.Delete(message.CommandID)
	sendTypedResult(conn, mu, typedCommandResult{Type: "typed_command_ack", CommandID: message.CommandID, Status: "acknowledged"})
	sendTypedResult(conn, mu, typedCommandResult{Type: "typed_command_running", CommandID: message.CommandID, Status: "running"})
	timer := time.NewTimer(20 * time.Second)
	defer timer.Stop()
	var confirmation string
	select {
	case confirmation = <-receipt:
	case <-parent.Done():
	case <-timer.C:
	}
	// No disruptive action is allowed until the server confirms the persisted running state.
	if confirmation != "running" {
		finishDurable(message.CommandID, nil, "COMMAND_ACK_TIMEOUT", fmt.Errorf("backend did not confirm command persistence; no action was executed"))
		replayTypedResult(context.WithoutCancel(parent), conn, mu)
		return
	}
	ctx, cancel := context.WithDeadline(context.WithoutCancel(parent), deadline)
	defer cancel()
	if err := ctx.Err(); err != nil {
		finishDurable(message.CommandID, nil, "COMMAND_EXPIRED", err)
		return
	}
	if err := update.CommandJournal(ctx, func(c *update.DeviceCommand) error { c.Phase = "executing"; return nil }); err != nil {
		finishDurable(message.CommandID, nil, "COMMAND_JOURNAL_FAILED", err)
		replayTypedResult(ctx, conn, mu)
		return
	}
	if message.CommandType == "restart_agent" {
		err := update.RestartCommandAvailable(ctx)
		if err == nil {
			err = update.CommandJournal(ctx, func(c *update.DeviceCommand) error {
				if c.ID != message.CommandID {
					return fmt.Errorf("command journal changed")
				}
				c.Phase = "restart_pending"
				return nil
			})
		}
		if err != nil {
			finishDurable(message.CommandID, nil, "AGENT_RESTART_UNAVAILABLE", err)
		}
		replayTypedResult(ctx, conn, mu)
		return
	}
	if message.CommandType == "reboot" || message.CommandType == "shutdown" {
		err := update.CommandJournal(ctx, func(c *update.DeviceCommand) error { c.Phase = "power_prepared"; return nil })
		if err != nil {
			finishDurable(message.CommandID, nil, "COMMAND_JOURNAL_FAILED", err)
			return
		}
	}
	result, code, actionErr := executeTypedAction(ctx, message.CommandType, message.Payload)
	if actionErr == nil && (message.CommandType == "reboot" || message.CommandType == "shutdown") {
		if err := update.CommandJournal(ctx, func(c *update.DeviceCommand) error { c.Result = result; c.Phase = "power_pending"; return nil }); err != nil {
			log.Printf("Power command result persistence: %v", err)
		}
	} else {
		finishDurable(message.CommandID, result, code, actionErr)
	}
	replayTypedResult(context.WithoutCancel(parent), conn, mu)
}

func finishDurable(id string, result map[string]any, code string, actionErr error) {
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	if err := update.CommandJournal(ctx, func(c *update.DeviceCommand) error {
		if c.ID != id {
			return fmt.Errorf("command journal identity mismatch")
		}
		c.Result = result
		if actionErr != nil {
			c.Fail(code, safeActionError(actionErr))
		} else {
			c.Status = "succeeded"
		}
		return nil
	}); err != nil {
		log.Printf("Command result persistence failed: %v", err)
	}
}

func replayTypedResult(ctx context.Context, conn *websocket.Conn, mu *sync.Mutex) {
	var c update.DeviceCommand
	if err := update.CommandJournal(ctx, func(value *update.DeviceCommand) error { c = *value; return nil }); err != nil {
		log.Printf("Command result delivery pending: %v", err)
		return
	}
	if c.ID == "" || c.Reported || (!c.Terminal() && c.Phase == "preparing") {
		return
	}
	kind := "typed_command_running"
	if c.Terminal() {
		kind = "typed_command_result"
	}
	sendTypedResult(conn, mu, typedCommandResult{Type: kind, CommandID: c.ID, Status: c.Status, Result: c.Result, ErrorCode: c.ErrorCode, ErrorMessage: c.ErrorMessage})
}

func receiveTypedReceipt(ctx context.Context, message serverMessage) {
	if message.Status == "running" {
		if value, ok := commandReceipts.Load(message.CommandID); ok {
			select {
			case value.(chan string) <- message.Status:
			default:
			}
		}
		return
	}
	if message.Status != "succeeded" && message.Status != "failed" && message.Status != "expired" {
		return
	}
	if err := update.CommandJournal(ctx, func(c *update.DeviceCommand) error {
		if c.ID == message.CommandID {
			c.Reported = true
			c.Status = message.Status
			if c.Status == "expired" {
				c.Status = "failed"
			}
		}
		return nil
	}); err != nil {
		log.Printf("Command receipt persistence failed: %v", err)
	}
}

func validateActionPayload(action string, payload map[string]any) error {
	switch action {
	case "force_inventory", "flush_dns", "gpupdate", "restart_agent", "lock", "reboot", "shutdown":
	default:
		return fmt.Errorf("unsupported command type")
	}
	for key := range payload {
		if (action != "reboot" && action != "shutdown") || (key != "delay_seconds" && key != "force") {
			return fmt.Errorf("unexpected command payload field")
		}
	}
	if _, ok := validateDelay(payload); !ok {
		return fmt.Errorf("invalid delay_seconds")
	}
	if _, ok := validateForce(payload); !ok {
		return fmt.Errorf("invalid force")
	}
	return nil
}
