//go:build windows

package rdp

import "testing"

func TestH264WriterForcesRecoveryOnceAfterBrokenGOP(t *testing.T) {
	forced := 0
	writer := &h264Writer{
		queue: newH264GOPQueue(3),
		wake:  make(chan struct{}, 1),
		force: func() error {
			forced++
			return nil
		},
	}
	writer.enqueue([]byte("idr-1"), H264FlagKeyframe|H264FlagConfig)
	writer.enqueue([]byte("p-2"), 0)
	writer.enqueue([]byte("p-3"), 0)
	writer.enqueue([]byte("p-4"), 0)
	writer.enqueue([]byte("p-5"), 0)
	if forced != 1 {
		t.Fatalf("force-keyframe callbacks = %d, want 1", forced)
	}
	writer.enqueue([]byte("idr-6"), H264FlagKeyframe|H264FlagConfig)
	writer.enqueue([]byte("p-7"), 0)
	for _, want := range []string{"idr-6", "p-7"} {
		if got := string(writer.queue.dequeue()); got != want {
			t.Fatalf("forwarded access unit = %q, want %q", got, want)
		}
	}
	droppedGOPs, droppedAUs, forcedKeyframes := writer.stats()
	if droppedGOPs != 1 || droppedAUs != 5 || forcedKeyframes != 1 {
		t.Fatalf("stats gops=%d aus=%d forced=%d, want 1, 5, 1", droppedGOPs, droppedAUs, forcedKeyframes)
	}
}
