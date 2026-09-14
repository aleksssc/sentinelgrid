//go:build windows

package rdp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRemoteSessionControllerNormalCloseWinsConcurrentWriteFailure(t *testing.T) {
	upgrader := websocket.Upgrader{}
	for attempt := 0; attempt < 1000; attempt++ {
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
			}
		}))

		url := "ws" + strings.TrimPrefix(server.URL, "http")
		connection, _, err := websocket.DefaultDialer.Dial(url, nil)
		if err != nil {
			server.Close()
			t.Fatal(err)
		}
		captureCtx, cancelCapture := context.WithCancel(context.Background())
		writer := newLatestFrameWriter(connection)
		done := make(chan remoteInputResult, 1)
		go readRemoteInput(captureCtx, connection, done)
		controller := remoteSessionController{ws: connection, writer: writer, cancelCapture: cancelCapture, inputDone: done}
		writer.enqueue([]byte{1})
		select {
		case <-received:
		case <-time.After(time.Second):
			t.Fatalf("attempt %d: server did not receive active frame", attempt)
		}
		// Keep a replaceable frame pending while the normal close is delivered.
		writer.enqueue([]byte{2})
		if err := controller.resolveWriteFailure(context.Background(), frameWriteResult{err: errors.New("simultaneous write failure")}); err != nil {
			t.Fatalf("attempt %d: normal peer close became %v", attempt, err)
		}
		if captureCtx.Err() == nil {
			t.Fatalf("attempt %d: capture was not cancelled", attempt)
		}
		connection.Close()
		server.Close()
	}
}

func TestRemoteSessionControllerRetainsGenuineWriteFailure(t *testing.T) {
	upgrader := websocket.Upgrader{}
	broken := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		connection, err := upgrader.Upgrade(response, request, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		close(broken)
		_ = connection.UnderlyingConn().Close()
	}))
	defer server.Close()

	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	captureCtx, cancelCapture := context.WithCancel(context.Background())
	writer := newLatestFrameWriter(connection)
	done := make(chan remoteInputResult, 1)
	go readRemoteInput(captureCtx, connection, done)
	controller := remoteSessionController{ws: connection, writer: writer, cancelCapture: cancelCapture, inputDone: done}
	select {
	case <-broken:
	case <-time.After(time.Second):
		t.Fatal("server did not break connection")
	}
	failureDeadline := time.NewTimer(time.Second)
	defer failureDeadline.Stop()
	for {
		writer.enqueue(make([]byte, 1<<20))
		select {
		case failure := <-writer.failures:
			err = controller.resolveWriteFailure(context.Background(), failure)
			goto resolved
		case <-time.After(time.Millisecond):
		case <-failureDeadline.C:
			t.Fatal("writer did not report broken connection")
		}
	}

resolved:
	if got := RemoteHostExitCode(err); got != 27 {
		t.Fatalf("genuine write failure exit code = %d, want 27; err=%v", got, err)
	}
	if captureCtx.Err() == nil {
		t.Fatal("capture was not cancelled")
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
