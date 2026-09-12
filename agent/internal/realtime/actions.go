package realtime

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"sentinelgrid/agent/internal/update"
)

var processedTypedCommands sync.Map

type typedCommandResult struct {
	Type         string         `json:"type"`
	CommandID    string         `json:"command_id"`
	Status       string         `json:"status"`
	Result       map[string]any `json:"result,omitempty"`
	ErrorCode    string         `json:"error_code,omitempty"`
	ErrorMessage string         `json:"error_message,omitempty"`
}

func handleTypedCommand(
	parentContext context.Context,
	conn *websocket.Conn,
	writeMu *sync.Mutex,
	message serverMessage,
) {
	if message.CommandType != "update_agent" {
		handleDurableTypedCommand(parentContext, conn, writeMu, message)
		return
	}
	if _, loaded := processedTypedCommands.LoadOrStore(message.IdempotencyKey, struct{}{}); loaded {
		if message.CommandType == "update_agent" {
			return
		}
		sendTypedResult(conn, writeMu, typedCommandResult{
			Type: "typed_command_result", CommandID: message.CommandID,
			Status: "failed", ErrorCode: "DUPLICATE_COMMAND",
			ErrorMessage: "This command was already processed.",
		})
		return
	}

	expiresAt, err := time.Parse(time.RFC3339, message.ExpiresAt)
	if err != nil || !time.Now().Before(expiresAt) {
		sendTypedResult(conn, writeMu, typedCommandResult{
			Type: "typed_command_result", CommandID: message.CommandID,
			Status: "failed", ErrorCode: "COMMAND_EXPIRED",
			ErrorMessage: "The command has expired.",
		})
		return
	}

	sendTypedResult(conn, writeMu, typedCommandResult{
		Type: "typed_command_ack", CommandID: message.CommandID, Status: "acknowledged",
	})
	sendTypedResult(conn, writeMu, typedCommandResult{
		Type: "typed_command_running", CommandID: message.CommandID, Status: "running",
	})

	if message.CommandType == "update_agent" && len(message.Payload) == 0 && update.Operational() {
		err := update.RequestUpdate(parentContext, message.CommandID)
		if errors.Is(err, update.ErrDeferred) {
			return
		}
		if err != nil {
			sendTypedResult(conn, writeMu, typedCommandResult{
				Type: "typed_command_result", CommandID: message.CommandID, Status: "failed",
				ErrorCode: update.CommandErrorCode(err), ErrorMessage: safeActionError(err),
			})
		}
		return
	}

	result, code, actionErr := executeTypedAction(parentContext, message.CommandType, message.Payload)
	if actionErr != nil {
		sendTypedResult(conn, writeMu, typedCommandResult{
			Type: "typed_command_result", CommandID: message.CommandID,
			Status: "failed", ErrorCode: code, ErrorMessage: safeActionError(actionErr),
		})
		return
	}

	sendTypedResult(conn, writeMu, typedCommandResult{
		Type: "typed_command_result", CommandID: message.CommandID,
		Status: "succeeded", Result: result,
	})
}

func sendTypedResult(conn *websocket.Conn, writeMu *sync.Mutex, result typedCommandResult) {
	writeMu.Lock()
	defer writeMu.Unlock()
	if err := conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		log.Printf("Command write deadline: %v", err)
		return
	}
	if err := conn.WriteJSON(result); err != nil {
		log.Printf("Could not send typed command result: %v", err)
	}
}

func safeActionError(err error) string {
	message := strings.TrimSpace(err.Error())
	if message == "" || len(message) > 512 {
		return "The action could not be completed."
	}
	return message
}

func validateDelay(payload map[string]any) (int, bool) {
	value, exists := payload["delay_seconds"]
	if !exists {
		return 0, true
	}
	number, ok := value.(float64)
	if !ok || number < 0 || number > 3600 || number != float64(int(number)) {
		return 0, false
	}
	return int(number), true
}

func validateForce(payload map[string]any) (bool, bool) {
	value, exists := payload["force"]
	if !exists {
		return false, true
	}
	force, ok := value.(bool)
	return force, ok
}

func executeTypedAction(ctx context.Context, commandType string, payload map[string]any) (map[string]any, string, error) {
	switch commandType {
	case "force_inventory":
		return executeForceInventory(ctx)
	case "update_agent":
		if len(payload) != 0 {
			return nil, "INVALID_PAYLOAD", fmt.Errorf("update_agent accepts no payload or download URL")
		}
		return nil, "AGENT_UNSUPPORTED", fmt.Errorf("secure updater is not operational")
	case "reboot", "shutdown":
		delay, ok := validateDelay(payload)
		if !ok {
			return nil, "INVALID_PAYLOAD", fmt.Errorf("delay_seconds must be an integer from 0 to 3600")
		}
		force, ok := validateForce(payload)
		if !ok {
			return nil, "INVALID_PAYLOAD", fmt.Errorf("force must be boolean")
		}
		return executePowerAction(ctx, commandType, delay, force)
	case "lock":
		return executeLockAction(ctx)
	case "flush_dns":
		return executeFlushDNS(ctx)
	case "gpupdate":
		return executeGPUpdate(ctx)
	default:
		return nil, "UNSUPPORTED_COMMAND", fmt.Errorf("unsupported command type")
	}
}
