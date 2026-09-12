package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"sentinelgrid/agent/internal/inventory"
)

func TestForcedInventoryAlwaysUploadsWithoutZeroingTelemetry(t *testing.T) {
	accepted := true
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing authentication")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["inventory"] == nil {
			t.Error("forced inventory was deduplicated")
		}
		if _, exists := body["cpu_usage"]; exists {
			t.Error("force inventory overwrote live metrics with zero")
		}
		if !accepted {
			w.WriteHeader(503)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"device_id":"device"}`))
	}))
	defer server.Close()
	client := NewClient(server.URL)
	for i := 0; i < 2; i++ {
		if _, err := client.SendInventory(context.Background(), "test-token", &inventory.Inventory{Hostname: "test"}); err != nil {
			t.Fatal(err)
		}
	}
	if requests != 2 {
		t.Fatal("missing immediate uploads")
	}
	accepted = false
	if _, err := client.SendInventory(context.Background(), "test-token", &inventory.Inventory{}); err == nil {
		t.Fatal("rejected upload succeeded")
	}
}
