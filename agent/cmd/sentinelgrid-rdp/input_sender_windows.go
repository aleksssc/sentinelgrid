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
	viewer                                                               *viewer
	mu                                                                   sync.Mutex
	move                                                                 *rdp.Input
	critical                                                             []rdp.Input
	keys                                                                 map[uint16]rdp.Input
	buttons                                                              map[string]rdp.Input
	wake                                                                 chan struct{}
	stop                                                                 chan struct{}
	done                                                                 chan struct{}
	stopOnce                                                             sync.Once
	mouseEvents, mouseMovesSent, mouseMovesCoalesced, criticalEventsSent uint64
	writeMetrics                                                         durationWindow
	lastMoveSent, lastStatsLogged, lastWriteFailure                      time.Time
}

func newViewerInputSender(v *viewer) *viewerInputSender {
	s := &viewerInputSender{viewer: v, keys: make(map[uint16]rdp.Input), buttons: make(map[string]rdp.Input), wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{}), writeMetrics: newDurationWindow(120), lastStatsLogged: time.Now()}
	go s.run()
	return s
}

// close waits for normal writes to stop, then synchronously sends the releases
// while the websocket is still owned by the viewer.
func (s *viewerInputSender) close() {
	s.stopOnce.Do(func() { close(s.stop); <-s.done; s.releaseAll() })
}
func (s *viewerInputSender) releaseAll() {
	for _, input := range s.releaseEvents() {
		_ = s.viewer.writeInput(input)
	}
}
func (s *viewerInputSender) releaseEvents() []rdp.Input {
	s.mu.Lock()
	defer s.mu.Unlock()
	releases := make([]rdp.Input, 0, len(s.keys)+len(s.buttons))
	for _, input := range s.keys {
		input.Type = "key_up"
		releases = append(releases, input)
	}
	for _, input := range s.buttons {
		input.Type = "mouse_up"
		releases = append(releases, input)
	}
	s.keys = make(map[uint16]rdp.Input)
	s.buttons = make(map[string]rdp.Input)
	s.critical = nil
	s.move = nil
	return releases
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
	switch input.Type {
	case "key_down":
		if _, ok := s.keys[input.VK]; ok {
			s.mu.Unlock()
			return
		}
		s.keys[input.VK] = input
	case "key_up":
		delete(s.keys, input.VK)
	case "mouse_down":
		if _, ok := s.buttons[input.Button]; ok {
			s.mu.Unlock()
			return
		}
		s.buttons[input.Button] = input
	case "mouse_up":
		delete(s.buttons, input.Button)
	}
	if input.Type == "mouse_down" || input.Type == "mouse_up" || input.Type == "mouse_wheel" {
		s.mouseEvents++
	}
	// A viewer can hold at most 256 virtual keys and three buttons. Never drop
	// transitions: a missing release is worse than backpressure.
	s.critical = append(s.critical, input)
	s.mu.Unlock()
	s.signal()
}
func (s *viewerInputSender) releaseOnFocusLoss() { s.releaseAll() }
func (s *viewerInputSender) signal() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *viewerInputSender) run() {
	ticker := time.NewTicker(viewerMouseMoveInterval)
	defer ticker.Stop()
	defer close(s.done)
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
		input, move, ok := s.next()
		if !ok {
			return
		}
		started := time.Now()
		err := s.viewer.writeInput(input)
		elapsed := time.Since(started)
		s.mu.Lock()
		s.writeMetrics.add(elapsed)
		if err == nil {
			if move {
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
	mouse, sent, coalesced, critical := s.mouseEvents, s.mouseMovesSent, s.mouseMovesCoalesced, s.criticalEventsSent
	depth := len(s.critical)
	if s.move != nil {
		depth++
	}
	writes := s.writeMetrics.snapshot()
	s.mu.Unlock()
	ms, _, _, _ := milliseconds(writes)
	s.viewer.logger.event(fmt.Sprintf("VIEWER_INPUT_STATS mouse_events=%d mouse_moves_sent=%d mouse_moves_coalesced=%d critical_events_sent=%d queue_depth=%d write_ms=%.1f", mouse, sent, coalesced, critical, depth, ms))
}
