//go:build windows

package rdp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestLatestFrameWriterNormalPeerCloseWinsWriteRace(t *testing.T) {
	upgrader := websocket.Upgrader{}
	for attempt := 0; attempt < 100; attempt++ {
		received := make(chan struct{})
		server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
			connection, err := upgrader.Upgrade(response, request, nil)
			if err != nil {
				t.Errorf("upgrade: %v", err)
				return
			}
			defer connection.Close()
			if _, _, err = connection.ReadMessage(); err != nil {
				t.Errorf("server read: %v", err)
				return
			}
			close(received)
			if err = connection.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "done"), time.Now().Add(time.Second)); err != nil {
				t.Errorf("server close: %v", err)
				return
			}
			_ = connection.SetReadDeadline(time.Now().Add(time.Second))
			_, _, _ = connection.ReadMessage()
		}))

		url := "ws" + strings.TrimPrefix(server.URL, "http")
		connection, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			server.Close()
			t.Fatal(err)
		}
		writer := newLatestFrameWriter(connection)
		done := make(chan remoteInputResult, 1)
		go readRemoteInput(context.Background(), connection, done, writer.close)
		writer.enqueue([]byte{1})
		select {
		case <-received:
		case <-time.After(time.Second):
			t.Fatalf("attempt %d: server did not receive active frame", attempt)
		}
		writer.enqueue([]byte{2})

		result, receivedResult := awaitRemoteInputResult(done)
		writer.close()
		connection.Close()
		server.Close()
		if !receivedResult || !result.normal || result.err != nil {
			t.Fatalf("attempt %d: normal peer close became %#v", attempt, result)
		}
	}
}

func TestLatestFrameWriterStopsAcceptingFrames(t *testing.T) {
	writer := &latestFrameWriter{wake: make(chan struct{}, 1)}
	writer.stopping.Store(true)
	writer.enqueue([]byte{1})
	if writer.latest != nil {
		t.Fatal("writer accepted a frame after shutdown began")
	}
}
