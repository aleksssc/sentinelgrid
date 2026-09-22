//go:build windows

package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"sentinelgrid/agent/internal/rdp"
)

type blockedViewerConn struct {
	net.Conn
	block                atomic.Bool
	started, closed      chan struct{}
	startOnce, closeOnce sync.Once
}

func (c *blockedViewerConn) Write(data []byte) (int, error) {
	if c.block.Load() {
		c.startOnce.Do(func() { close(c.started) })
		<-c.closed
		return 0, net.ErrClosed
	}
	return c.Conn.Write(data)
}
func (c *blockedViewerConn) Close() error {
	c.closeOnce.Do(func() { close(c.closed) })
	return c.Conn.Close()
}

func TestViewerShutdownUnblocksWriterAndReaderWithinSingleGrace(t *testing.T) {
	serverDone := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(serverDone)
		ws, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	var socket *blockedViewerConn
	dialer := websocket.Dialer{NetDialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		conn, err := (&net.Dialer{}).DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		socket = &blockedViewerConn{Conn: conn, started: make(chan struct{}), closed: make(chan struct{})}
		return socket, nil
	}}
	ws, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	v := &viewer{ws: ws, sessionState: viewerStateConnected, compressed: newLatestCompressedFrame(), inputMode: "full"}
	v.input = newViewerInputSender(v)
	readerDone := make(chan struct{})
	go func() { defer close(readerDone); v.receive() }()
	socket.block.Store(true)
	v.queueInput(rdp.Input{Type: "key_down", VK: 0x11})
	select {
	case <-socket.started:
	case <-time.After(2 * time.Second):
		t.Fatal("writer did not reach blocking socket")
	}
	returned := make(chan struct{})
	go func() { v.beginShutdown(); close(returned) }()
	select {
	case <-returned:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("UI close waited for network shutdown")
	}
	for name, done := range map[string]<-chan struct{}{"cleanup": v.shutdownDone, "sender": v.input.done, "reader": readerDone, "peer": serverDone} {
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatalf("%s leaked after bounded socket close", name)
		}
	}
	v.mu.RLock()
	state := v.sessionState
	v.mu.RUnlock()
	if state != viewerStateDisconnecting {
		t.Fatalf("intentional shutdown became %s", state.label())
	}
}
