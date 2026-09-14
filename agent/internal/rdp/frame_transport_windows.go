//go:build windows

package rdp

import (
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// latestFrameWriter gives the websocket exactly one writer and permits at most
// one replaceable video frame to wait behind a slow network write.
type latestFrameWriter struct {
	ws       *websocket.Conn
	mu       sync.Mutex
	latest   []byte
	wake     chan struct{}
	stop     chan struct{}
	done     chan struct{}
	writes   chan time.Duration
	errors   chan error
	stopping atomic.Bool
	stopped  sync.Once
	dropped  uint64
}

func newLatestFrameWriter(ws *websocket.Conn) *latestFrameWriter {
	writer := &latestFrameWriter{ws: ws, wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{}), writes: make(chan time.Duration, 1), errors: make(chan error, 1)}
	go writer.run()
	return writer
}

func (w *latestFrameWriter) enqueue(frame []byte) {
	if w.stopping.Load() {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.stopping.Load() {
		return
	}
	if w.latest != nil {
		w.dropped++
	}
	w.latest = frame
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *latestFrameWriter) dropCount() uint64 {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.dropped
}

// close starts shutdown before unblocking a pending write, so no further frame
// can be selected or reported as a transport failure during normal teardown.
func (w *latestFrameWriter) close() {
	w.stopped.Do(func() {
		w.stopping.Store(true)
		w.mu.Lock()
		w.latest = nil
		w.mu.Unlock()
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
			if w.stopping.Load() {
				return
			}
			w.mu.Lock()
			frame := w.latest
			w.latest = nil
			w.mu.Unlock()
			if frame == nil {
				break
			}
			started := time.Now()
			if err := w.ws.WriteMessage(websocket.BinaryMessage, frame); err != nil {
				if !w.stopping.Load() {
					select {
					case w.errors <- err:
					default:
					}
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

func isNormalWebSocketClose(err error) bool {
	var closeErr *websocket.CloseError
	return errors.As(err, &closeErr) && (closeErr.Code == websocket.CloseNormalClosure || closeErr.Code == websocket.CloseGoingAway)
}
