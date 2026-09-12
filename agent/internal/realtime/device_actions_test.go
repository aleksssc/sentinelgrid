package realtime

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAllDeviceCommandPayloads(t *testing.T) {
	for _, kind := range []string{"force_inventory", "flush_dns", "gpupdate", "restart_agent", "lock", "reboot", "shutdown"} {
		if err := validateActionPayload(kind, nil); err != nil {
			t.Fatal(kind, err)
		}
		if err := validateActionPayload(kind, map[string]any{"command": "arbitrary"}); err == nil {
			t.Fatal("arbitrary payload accepted", kind)
		}
	}
	for _, payload := range []map[string]any{{"delay_seconds": -1.0}, {"delay_seconds": 1.5}, {"force": "yes"}} {
		if err := validateActionPayload("reboot", payload); err == nil {
			t.Fatal("invalid power payload accepted")
		}
	}
	if err := validateActionPayload("reboot", map[string]any{"delay_seconds": 30.0, "force": false}); err != nil {
		t.Fatal(err)
	}
}

func TestInventoryCommandWaitsForUploadAcceptance(t *testing.T) {
	for _, uploadErr := range []error{nil, errors.New("backend rejected inventory")} {
		done := make(chan error, 1)
		go func() {
			_, _, err := executeForceInventory(context.Background())
			done <- err
		}()
		request := <-InventoryRequests
		select {
		case <-done:
			t.Fatal("inventory completed before upload acceptance")
		default:
		}
		request.Done <- uploadErr
		if err := <-done; !errors.Is(err, uploadErr) {
			t.Fatalf("upload result lost: %v", err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if _, code, err := executeForceInventory(ctx); err == nil || code != "INVENTORY_TIMEOUT" {
		t.Fatal("inventory timeout missing")
	}
}
