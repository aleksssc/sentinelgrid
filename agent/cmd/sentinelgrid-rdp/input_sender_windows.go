//go:build windows

package main

import (
	"fmt"
	"sync"
	"time"

	"sentinelgrid/agent/internal/rdp"
)

const (
	viewerMouseMoveInterval = time.Second / 60
	viewerInputQueueLimit   = 512
	viewerInputStatsPeriod  = 4 * time.Second
)

type viewerInputSender struct {
	viewer *viewer

	mu       sync.Mutex
	move     *rdp.Input
	critical []rdp.Input
	wake     chan struct{}
	stop     chan struct{}
	stopOnce sync.Once

	mouseEvents         uint64
	mouseMovesSent      uint64
	mouseMovesCoalesced uint64
	criticalEventsSent  uint64
	writeMetrics        durationWindow
	lastMoveSent        time.Time
	lastStatsLogged     time.Time
	lastWriteFailure    time.Time
}

func newViewerInputSender(v *viewer) *viewerInputSender {
	sender := &viewerInputSender{
		viewer:          v,
		wake:            make(chan struct{}, 1),
		stop:            make(chan struct{}),
		writeMetrics:    newDurationWindow(120),
		lastStatsLogged: time.Now(),
	}
	go sender.run()
	return sender
}

func (s *viewerInputSender) close() {
	s.stopOnce.Do(func() { close(s.stop) })
}

func (s *viewerInputSender) enqueueMouseMove(input rdp.Input) {
	s.mu.Lock()
	s.mouseEvents++
	if s.move != nil {
		s.mouseMovesCoalesced++
	}
	s.move = &input
	s.mu.Unlock()
	s.signal()
}

func (s *viewerInputSender) enqueueCritical(input rdp.Input) {
	s.mu.Lock()
	if input.Type == "mouse_down" || input.Type == "mouse_up" || input.Type == "mouse_wheel" {
		s.mouseEvents++
	}
	if len(s.critical) >= viewerInputQueueLimit {
		s.mu.Unlock()
		s.viewer.logger.event("VIEWER_INPUT_QUEUE_FULL")
		return
	}
	s.critical = append(s.critical, input)
	s.mu.Unlock()
	s.signal()
}

func (s *viewerInputSender) signal() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

func (s *viewerInputSender) run() {
	ticker := time.NewTicker(viewerMouseMoveInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-s.wake:
		case <-ticker.C:
		}
		s.flush()
		s.logStats()
	}
}

func (s *viewerInputSender) flush() {
	for {
		input, isMove, ok := s.next()
		if !ok {
			return
		}
		started := time.Now()
		err := s.viewer.writeInput(input)
		elapsed := time.Since(started)
		s.mu.Lock()
		s.writeMetrics.add(elapsed)
		if err == nil {
			if isMove {
				s.mouseMovesSent++
				s.lastMoveSent = time.Now()
			} else {
				s.criticalEventsSent++
			}
		}
		logFailure := err != nil && time.Since(s.lastWriteFailure) >= time.Second
		if logFailure {
			s.lastWriteFailure = time.Now()
		}
		s.mu.Unlock()
		if logFailure {
			s.viewer.logger.event("VIEWER_INPUT_SEND_FAILED")
		}
	}
}

func (s *viewerInputSender) next() (rdp.Input, bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.critical) != 0 {
		input := s.critical[0]
		copy(s.critical, s.critical[1:])
		s.critical[len(s.critical)-1] = rdp.Input{}
		s.critical = s.critical[:len(s.critical)-1]
		return input, false, true
	}
	if s.move == nil || time.Since(s.lastMoveSent) < viewerMouseMoveInterval {
		return rdp.Input{}, false, false
	}
	input := *s.move
	s.move = nil
	return input, true, true
}

func (s *viewerInputSender) logStats() {
	s.mu.Lock()
	if time.Since(s.lastStatsLogged) < viewerInputStatsPeriod {
		s.mu.Unlock()
		return
	}
	s.lastStatsLogged = time.Now()
	mouseEvents, movesSent := s.mouseEvents, s.mouseMovesSent
	coalesced, critical := s.mouseMovesCoalesced, s.criticalEventsSent
	depth := len(s.critical)
	if s.move != nil {
		depth++
	}
	writes := s.writeMetrics.snapshot()
	s.mu.Unlock()
	writeMS, _, _, _ := milliseconds(writes)
	s.viewer.logger.event(fmt.Sprintf("VIEWER_INPUT_STATS mouse_events=%d mouse_moves_sent=%d mouse_moves_coalesced=%d critical_events_sent=%d queue_depth=%d write_ms=%.1f", mouseEvents, movesSent, coalesced, critical, depth, writeMS))
}
