//go:build windows

package rdp

import (
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type deadlineWrite struct {
	mu        sync.Mutex
	deadlines []time.Time
	packets   [][]byte
	entered   chan struct{}
	unblock   chan struct{}
	blocked   bool
	writing   int
	maxWrites int
}

func (w *deadlineWrite) SetWriteDeadline(deadline time.Time) error {
	w.mu.Lock()
	w.deadlines = append(w.deadlines, deadline)
	w.mu.Unlock()
	if w.blocked && !deadline.After(time.Now()) {
		select {
		case w.unblock <- struct{}{}:
		default:
		}
	}
	return nil
}

func (w *deadlineWrite) WriteMessage(_ int, packet []byte) error {
	w.mu.Lock()
	w.writing++
	if w.writing > w.maxWrites {
		w.maxWrites = w.writing
	}
	w.packets = append(w.packets, append([]byte(nil), packet...))
	w.mu.Unlock()
	if w.blocked {
		select {
		case w.entered <- struct{}{}:
		default:
		}
		<-w.unblock
	}
	w.mu.Lock()
	w.writing--
	w.mu.Unlock()
	return nil
}

func (w *deadlineWrite) snapshot() ([]time.Time, [][]byte, int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([]time.Time(nil), w.deadlines...), append([][]byte(nil), w.packets...), w.maxWrites
}

func TestStreamingWritesReplaceSetupDeadline(t *testing.T) {
	start := time.Date(2026, 9, 15, 1, 0, 0, 0, time.UTC)
	clock := start
	ws := &deadlineWrite{}
	if err := writePacketAt(ws, []byte("selected"), func() time.Time { return clock }); err != nil {
		t.Fatal(err)
	}
	clock = start.Add(remoteWriteTimeout + time.Second)
	h264 := &h264Writer{ws: ws, now: func() time.Time { return clock }}
	if err := h264.write([]byte("au-1")); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(time.Second)
	if err := h264.write([]byte("au-2")); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(time.Second)
	jpeg := &latestFrameWriter{ws: ws, now: func() time.Time { return clock }}
	if err := jpeg.write([]byte("frame-1")); err != nil {
		t.Fatal(err)
	}
	deadlines, packets, _ := ws.snapshot()
	if len(deadlines) != 4 || len(packets) != 4 {
		t.Fatalf("deadlines=%d packets=%d, want 4", len(deadlines), len(packets))
	}
	for i, want := range []time.Time{start.Add(remoteWriteTimeout), start.Add(2*remoteWriteTimeout + time.Second), start.Add(2*remoteWriteTimeout + 2*time.Second), start.Add(2*remoteWriteTimeout + 3*time.Second)} {
		if got := deadlines[i]; !got.Equal(want) {
			t.Fatalf("deadline %d = %s, want %s", i, got, want)
		}
	}
	for i, want := range []string{"selected", "au-1", "au-2", "frame-1"} {
		if got := string(packets[i]); got != want {
			t.Fatalf("packet %d = %q, want %q", i, got, want)
		}
	}
}

func TestWriterShutdownPreservesImmediateDeadline(t *testing.T) {
	ws := &deadlineWrite{entered: make(chan struct{}, 1), unblock: make(chan struct{}, 1), blocked: true}
	writer := &latestFrameWriter{ws: ws, wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{}), writes: make(chan time.Duration, 1), failures: make(chan frameWriteResult, 1), now: time.Now}
	go writer.run()
	writer.enqueue([]byte("frame"))
	select {
	case <-ws.entered:
	case <-time.After(time.Second):
		t.Fatal("writer did not begin its network write")
	}
	writer.close()
	deadlines, _, maxWrites := ws.snapshot()
	if len(deadlines) < 2 {
		t.Fatalf("deadline calls=%d, want streaming and immediate shutdown", len(deadlines))
	}
	if deadlines[len(deadlines)-1].After(time.Now().Add(100 * time.Millisecond)) {
		t.Fatalf("shutdown deadline %s is not immediate", deadlines[len(deadlines)-1])
	}
	if maxWrites != 1 {
		t.Fatalf("concurrent WriteMessage calls = %d, want 1", maxWrites)
	}
}

func TestStoppedWriterCannotRestoreNormalDeadline(t *testing.T) {
	ws := &deadlineWrite{}
	writer := &h264Writer{ws: ws, now: time.Now}
	writer.stopping.Store(true)
	if err := writer.write([]byte("late")); err != nil {
		t.Fatal(err)
	}
	deadlines, packets, _ := ws.snapshot()
	if len(deadlines) != 0 || len(packets) != 0 {
		t.Fatalf("stopped writer changed transport: deadlines=%d packets=%d", len(deadlines), len(packets))
	}
}

func TestWritePacketUsesBoundedDeadline(t *testing.T) {
	ws := &deadlineWrite{}
	if err := writePacket(ws, []byte("control")); err != nil {
		t.Fatal(err)
	}
	deadlines, packets, _ := ws.snapshot()
	if len(deadlines) != 1 || len(packets) != 1 {
		t.Fatalf("deadline calls=%d packets=%d, want 1", len(deadlines), len(packets))
	}
	remaining := time.Until(deadlines[0])
	if remaining < remoteWriteTimeout-time.Second || remaining > remoteWriteTimeout+time.Second {
		t.Fatalf("control write deadline remaining=%s, want approximately %s", remaining, remoteWriteTimeout)
	}
}

var _ websocketWriteConn = (*deadlineWrite)(nil)
var _ = websocket.BinaryMessage
