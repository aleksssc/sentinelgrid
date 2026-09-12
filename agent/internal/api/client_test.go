package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sentinelgrid/agent/internal/inventory"
)

func TestInventoryAcknowledgementAndRefresh(t *testing.T) {
	var payloads []map[string]any
	accept := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		payloads = append(payloads, body)
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing token")
		}
		if !accept {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"device_id":"test-device","rdp_pending":false}`))
	}))
	defer server.Close()
	client := NewClient(server.URL)
	data := HeartbeatData{Inventory: &inventory.Inventory{AgentVersion: "0.1.5", Hostname: "test-host"}}
	send := func(wantInventory bool) {
		t.Helper()
		response, err := client.HeartbeatWithData("test-token", data)
		if err != nil {
			t.Fatal(err)
		}
		if response.RDPPending == nil || *response.RDPPending {
			t.Fatal("RDP negotiation lost")
		}
		last := payloads[len(payloads)-1]
		_, present := last["inventory"]
		if present != wantInventory {
			t.Fatalf("inventory present %v; wanted %v", present, wantInventory)
		}
		if last["rdp_control"] != true || last["cpu_usage"] != float64(0) {
			t.Fatal("metrics/control omitted")
		}
	}
	send(true)
	send(false)
	data.Inventory.AgentVersion = "0.1.6"
	accept = false
	if _, err := client.HeartbeatWithData("test-token", data); err == nil {
		t.Fatal("failed heartbeat accepted")
	}
	accept = true
	send(true)
	send(false)
	data.Inventory.Capabilities = map[string]bool{"rdp": true}
	send(true)
	client.lastInventoryAt = time.Now().Add(-30 * time.Minute)
	send(true)
}

func TestUnacknowledgedHeartbeatRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"ok":false,"device_id":"x"}`)) }))
	defer server.Close()
	if _, err := NewClient(server.URL).Heartbeat("test-token"); err == nil {
		t.Fatal("false health acknowledgement accepted")
	}
}
