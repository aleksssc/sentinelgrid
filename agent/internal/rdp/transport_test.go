package rdp

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestConnectionValidation(t *testing.T) {
	valid := Connection{Relay: "wss://relay.example/rdp", Ticket: strings.Repeat("a", 43), ExpiresAt: time.Now().Add(time.Minute)}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, url := range []string{"ws://relay.example/rdp", "https://relay.example/rdp", "wss://user:pass@relay.example/rdp", "wss://relay.example/rdp?token=secret", "wss://relay.example/other", "wss://relay.example/rdp#x"} {
		candidate := valid
		candidate.Relay = url
		if candidate.Validate() == nil {
			t.Fatalf("accepted %s", url)
		}
	}
	for _, ticket := range []string{"", strings.Repeat("a", 44), strings.Repeat("a", 42) + "\n"} {
		candidate := valid
		candidate.Ticket = ticket
		if candidate.Validate() == nil {
			t.Fatal("accepted invalid ticket")
		}
	}
	valid.ExpiresAt = time.Now().Add(-time.Second)
	if valid.Validate() == nil {
		t.Fatal("accepted expired connection")
	}
}

func TestBridgeRoundTripAndCancellation(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		for {
			kind, data, err := ws.ReadMessage()
			if err != nil {
				return
			}
			if err := ws.WriteMessage(kind, data); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	endpoint, tcp := net.Pipe()
	defer endpoint.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Bridge(ctx, ws, tcp) }()
	data := bytes.Repeat([]byte{0, 1, 0xfe, 0xff}, 40000)
	endpoint.SetDeadline(time.Now().Add(5 * time.Second))
	writeDone := make(chan error, 1)
	go func() { _, err := endpoint.Write(data); writeDone <- err }()
	got := make([]byte, len(data))
	if _, err := io.ReadFull(endpoint, got); err != nil {
		t.Fatal(err)
	}
	if err := <-writeDone; err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, data) {
		t.Fatal("RDP byte stream corrupted")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation leaked bridge")
	}
}

func TestBridgeTCPDisconnectClosesWebSocket(t *testing.T) {
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		_, _, _ = ws.ReadMessage()
	}))
	defer server.Close()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	endpoint, tcp := net.Pipe()
	done := make(chan error, 1)
	go func() { done <- Bridge(context.Background(), ws, tcp) }()
	endpoint.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("TCP close did not release tunnel")
	}
}
