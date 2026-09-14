package main

import (
	"sentinelgrid/agent/internal/rdp"
	"sync"
)

type compressedFrame struct {
	data     []byte
	metadata rdp.FrameMetadata
}

// latestCompressedFrame is a one-slot handoff. Decoding always starts with the
// newest available JPEG, rather than consuming an unbounded stale backlog.
type latestCompressedFrame struct {
	mu      sync.Mutex
	latest  compressedFrame
	ready   chan struct{}
	done    chan struct{}
	dropped uint64
	closed  bool
}

func newLatestCompressedFrame() *latestCompressedFrame {
	return &latestCompressedFrame{ready: make(chan struct{}, 1), done: make(chan struct{})}
}

func (q *latestCompressedFrame) replace(frame compressedFrame) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return false
	}
	if q.latest.data != nil {
		q.dropped++
	}
	q.latest = frame
	select {
	case q.ready <- struct{}{}:
	default:
	}
	return true
}

func (q *latestCompressedFrame) take() (compressedFrame, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.latest.data == nil || q.closed {
		return compressedFrame{}, false
	}
	frame := q.latest
	q.latest = compressedFrame{}
	return frame, true
}

func (q *latestCompressedFrame) close() {
	q.mu.Lock()
	if !q.closed {
		q.closed = true
		q.latest = compressedFrame{}
		close(q.done)
	}
	q.mu.Unlock()
}

func (q *latestCompressedFrame) dropCount() uint64 {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.dropped
}
