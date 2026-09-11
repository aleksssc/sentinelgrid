package realtime

import (
	"context"
	"testing"
)

func TestUpdateAgentDisabled(t *testing.T) {
	_, code, err := executeTypedAction(context.Background(), "update_agent", nil)
	if err == nil || code != "AGENT_UNSUPPORTED" {
		t.Fatalf("unqualified updater was enabled: %s %v", code, err)
	}
}

func TestUpdateAgentRejectsPayload(t *testing.T) {
	for _, key := range []string{"url", "path", "version", "command", "arguments", "anything"} {
		_, code, err := executeTypedAction(context.Background(), "update_agent", map[string]any{key: "untrusted"})
		if err == nil || code != "INVALID_PAYLOAD" {
			t.Fatalf("update payload %s accepted: %s %v", key, code, err)
		}
	}
}
