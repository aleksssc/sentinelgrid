package rdp

import "testing"

func TestH264GOPQueueRecoversAfterOverflowInOrder(t *testing.T) {
	q := newH264GOPQueue(3)
	if q.enqueue([]byte("idr-1"), H264FlagKeyframe|H264FlagConfig) {
		t.Fatal("initial keyframe unexpectedly requested recovery")
	}
	q.enqueue([]byte("p-2"), 0)
	q.enqueue([]byte("p-3"), 0)
	if !q.enqueue([]byte("p-4"), 0) {
		t.Fatal("overflow did not request a forced keyframe")
	}
	if !q.enqueue([]byte("p-5"), 0) {
		t.Fatal("dependent access unit was accepted while recovering")
	}
	if got := q.dequeue(); got != nil {
		t.Fatalf("broken GOP was not discarded: %q", got)
	}
	if q.enqueue([]byte("idr-6"), H264FlagKeyframe|H264FlagConfig) {
		t.Fatal("recovery keyframe did not clear recovery state")
	}
	q.enqueue([]byte("p-7"), 0)
	for _, want := range []string{"idr-6", "p-7"} {
		if got := string(q.dequeue()); got != want {
			t.Fatalf("forwarded access unit = %q, want %q", got, want)
		}
	}
	if got := q.dequeue(); got != nil {
		t.Fatalf("unexpected access unit after recovery: %q", got)
	}
	droppedGOPs, droppedAUs, forcedKeyframes := q.stats()
	if droppedGOPs != 1 || droppedAUs != 5 || forcedKeyframes != 1 {
		t.Fatalf("stats gops=%d aus=%d forced=%d, want 1, 5, 1", droppedGOPs, droppedAUs, forcedKeyframes)
	}
}
