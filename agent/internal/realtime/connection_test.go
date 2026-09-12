package realtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"sentinelgrid/agent/internal/config"
)

func TestCancellationWhileWaitingForRealtimeAuthentication(t *testing.T) {
	authReceived := make(chan struct{})
	var once sync.Once
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/realtime/endpoint" {
			_ = json.NewEncoder(w).Encode(map[string]any{"origin": nil})
			return
		}
		upgrader := websocket.Upgrader{}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Error(err)
			return
		}
		once.Do(func() { close(authReceived) })
		_, _, _ = conn.ReadMessage()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- connect(ctx, &config.Config{Server: server.URL, DeviceID: "test-device", AgentID: "test-agent", AgentToken: "synthetic-test-token"})
	}()
	select {
	case <-authReceived:
	case <-time.After(2 * time.Second):
		t.Fatal("authentication was not sent")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("authentication read ignored cancellation")
	}
}
