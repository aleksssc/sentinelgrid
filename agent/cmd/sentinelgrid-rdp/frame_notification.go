package main

// frameNotificationState coalesces UI wake-ups. The UI consumes exactly one
// notification before it invalidates the window; painting never schedules one.
type frameNotificationState struct{ pending bool }

func (s *frameNotificationState) schedule() bool {
	if s.pending {
		return false
	}
	s.pending = true
	return true
}

func (s *frameNotificationState) consume() { s.pending = false }
func (s *frameNotificationState) cancel()  { s.pending = false }

type framePaintState struct {
	paintEvents           uint64
	uniqueFramesPainted   uint64
	lastPaintedGeneration uint64
}

func (s *framePaintState) record(generation uint64) bool {
	s.paintEvents++
	if generation == 0 || generation == s.lastPaintedGeneration {
		return false
	}
	s.lastPaintedGeneration = generation
	s.uniqueFramesPainted++
	return true
}
