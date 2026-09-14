package main

// frameNotificationState coalesces UI wake-ups while ensuring each decoded
// generation is attempted at most once by the continuous presentation path.
type frameNotificationState struct {
	pending                 bool
	lastAttemptedGeneration uint64
}

func (s *frameNotificationState) schedule() bool {
	if s.pending {
		return false
	}
	s.pending = true
	return true
}

func (s *frameNotificationState) consume() { s.pending = false }
func (s *frameNotificationState) cancel()  { s.pending = false }

func (s *frameNotificationState) shouldPresent(generation uint64) bool {
	return generation != 0 && generation > s.lastAttemptedGeneration
}

func (s *frameNotificationState) markAttempted(generation uint64) {
	if generation > s.lastAttemptedGeneration {
		s.lastAttemptedGeneration = generation
	}
}

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
