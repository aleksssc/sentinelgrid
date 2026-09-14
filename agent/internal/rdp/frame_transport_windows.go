//go:build windows

package rdp

import (
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// latestFrameWriter gives the websocket exactly one writer and permits at most
// one replaceable video frame to wait behind a slow network write.
type latestFrameWriter struct {
	ws      *websocket.Conn
	mu      sync.Mutex
	latest  []byte
	wake    chan struct{}
	stop    chan struct{}
	done    chan struct{}
	writes  chan time.Duration
	errors  chan error
	stopped sync.Once
	dropped uint64
}

func newLatestFrameWriter(ws *websocket.Conn) *latestFrameWriter {
	writer := &latestFrameWriter{ws: ws, wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{}), writes: make(chan time.Duration, 1), errors: make(chan error, 1)}
	go writer.run()
	return writer
}

func (w *latestFrameWriter) enqueue(frame []byte) {
	w.mu.Lock()
	if w.latest != nil {
		w.dropped++
	}
	w.latest = frame
	w.mu.Unlock()
	select {
	case w.wake <- struct{}{}:
	default:
	}
}
func (w *latestFrameWriter) dropCount() uint64 { w.mu.Lock(); defer w.mu.Unlock(); return w.dropped }
func (w *latestFrameWriter) close() {
	w.stopped.Do(func() {
		// Break a blocked network write before waiting for the sole writer.
		_ = w.ws.SetWriteDeadline(time.Now())
		close(w.stop)
		<-w.done
	})
}
func (w *latestFrameWriter) run() {
	defer close(w.done)
	for {
		select {
		case <-w.stop:
			return
		case <-w.wake:
		}
		for {
			w.mu.Lock()
			frame := w.latest
			w.latest = nil
			w.mu.Unlock()
			if frame == nil {
				break
			}
			started := time.Now()
			if err := w.ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
				select {
				case w.errors <- err:
				default:
				}
				return
			}
			select {
			case w.writes <- time.Since(started):
			default:
			}
		}
	}
}
