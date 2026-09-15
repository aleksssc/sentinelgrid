//go:build windows

package rdp

import (
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type frameWriteResult struct {
	err    error
	normal bool
}

// latestFrameWriter gives the websocket exactly one writer and permits at most
// one replaceable video frame to wait behind a slow network write.
type latestFrameWriter struct {
	ws       websocketWriteConn
	mu       sync.Mutex
	latest   []byte
	wake     chan struct{}
	stop     chan struct{}
	done     chan struct{}
	writes   chan time.Duration
	failures chan frameWriteResult
	stopping atomic.Bool
	stopped  sync.Once
	dropped  uint64
	now      func() time.Time
}

func newLatestFrameWriter(ws *websocket.Conn) *latestFrameWriter {
	writer := &latestFrameWriter{ws: ws, wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{}), writes: make(chan time.Duration, 1), failures: make(chan frameWriteResult, 1), now: time.Now}
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

// beginShutdown atomically rejects new frames and discards the one replaceable
// pending frame. It is safe to call both before and after the writer exits.
func (w *latestFrameWriter) beginShutdown() {
	w.stopping.Store(true)
	w.mu.Lock()
	w.latest = nil
	w.mu.Unlock()
}

// close starts shutdown before unblocking a pending write, so no further frame
// can be selected or reported as a transport failure during teardown.
func (w *latestFrameWriter) close() {
	w.stopped.Do(func() {
		w.beginShutdown()
		_ = w.ws.SetWriteDeadline(time.Now())
		close(w.stop)
		<-w.done
	})
}

func (w *latestFrameWriter) write(frame []byte) error {
	if w.stopping.Load() {
		return nil
	}
	if err := w.ws.SetWriteDeadline(w.now().Add(remoteWriteTimeout)); err != nil {
		return err
	}
	// Do not allow a fresh normal deadline to undo close's immediate deadline.
	if w.stopping.Load() {
		_ = w.ws.SetWriteDeadline(time.Now())
		return nil
	}
	return w.ws.WriteMessage(websocket.BinaryMessage, frame)
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
			if err := w.write(frame); err != nil {
				w.beginShutdown()
				select {
				case w.failures <- frameWriteResult{err: err, normal: isNormalWebSocketClose(err)}:
				default:
				}
				return
			}
			if w.stopping.Load() {
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
