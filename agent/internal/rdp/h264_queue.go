package rdp

import "sync"

// h264GOPQueue retains only decodable units: after any loss it rejects P-frames
// until the next config-bearing IDR establishes a fresh decoder state.
type h264GOPQueue struct {
	mu                 sync.Mutex
	limit              int
	units              [][]byte
	recover            bool
	droppedGOPs        uint64
	droppedAccessUnits uint64
	forcedKeyframes    uint64
}

func newH264GOPQueue(limit int) *h264GOPQueue {
	if limit < 2 {
		limit = 2
	}
	return &h264GOPQueue{limit: limit, recover: true}
}
func (q *h264GOPQueue) enqueue(packet []byte, flags uint32) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	keyframe := flags&H264FlagKeyframe != 0
	if q.recover && !keyframe {
		q.droppedAccessUnits++
		return true
	}
	if len(q.units) >= q.limit {
		discarded := len(q.units)
		q.units = nil
		q.recover = true
		q.droppedGOPs++
		q.droppedAccessUnits += uint64(discarded + 1)
		q.forcedKeyframes++
		if !keyframe {
			return true
		}
	}
	if keyframe {
		q.units = nil
		q.recover = false
	}
	q.units = append(q.units, packet)
	return q.recover
}
func (q *h264GOPQueue) dequeue() []byte {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.units) == 0 {
		return nil
	}
	unit := q.units[0]
	q.units = q.units[1:]
	return unit
}
func (q *h264GOPQueue) requireRecovery() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.units) > 0 {
		q.droppedAccessUnits += uint64(len(q.units))
	}
	q.units = nil
	if !q.recover {
		q.droppedGOPs++
		q.forcedKeyframes++
	}
	q.recover = true
}
func (q *h264GOPQueue) stats() (uint64, uint64, uint64) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.droppedGOPs, q.droppedAccessUnits, q.forcedKeyframes
}
