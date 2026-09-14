//go:build windows

package rdp

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// h264Writer serializes websocket writes without making capture wait on a slow
// peer. Its GOP queue discards an incomplete dependency chain atomically.
type h264Writer struct {
	ws             *websocket.Conn
	queue          *h264GOPQueue
	wake           chan struct{}
	stop           chan struct{}
	done           chan struct{}
	writes         chan time.Duration
	failures       chan frameWriteResult
	stopping       atomic.Bool
	stopped        sync.Once
	force          func() error
	recoveryForced bool
}

func newH264Writer(ws *websocket.Conn, force func() error) *h264Writer {
	w := &h264Writer{ws: ws, queue: newH264GOPQueue(32), wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{}), writes: make(chan time.Duration, 1), failures: make(chan frameWriteResult, 1), force: force}
	go w.run()
	return w
}
func (w *h264Writer) enqueue(packet []byte, flags uint32) {
	if w.stopping.Load() {
		return
	}
	force := w.queue.enqueue(packet, flags)
	if flags&H264FlagKeyframe != 0 {
		w.recoveryForced = false
	}
	if force && !w.recoveryForced && w.force != nil {
		w.recoveryForced = true
		_ = w.force()
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}
func (w *h264Writer) beginShutdown() { w.stopping.Store(true); w.queue.requireRecovery() }
func (w *h264Writer) close() {
	w.stopped.Do(func() { w.beginShutdown(); _ = w.ws.SetWriteDeadline(time.Now()); close(w.stop); <-w.done })
}
func (w *h264Writer) dropCount() uint64               { _, units, _ := w.queue.stats(); return units }
func (w *h264Writer) stats() (uint64, uint64, uint64) { return w.queue.stats() }
func (w *h264Writer) run() {
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
			packet := w.queue.dequeue()
			if packet == nil {
				break
			}
			started := time.Now()
			if err := w.ws.WriteMessage(websocket.BinaryMessage, packet); err != nil {
				w.beginShutdown()
				select {
				case w.failures <- frameWriteResult{err: err, normal: isNormalWebSocketClose(err)}:
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
