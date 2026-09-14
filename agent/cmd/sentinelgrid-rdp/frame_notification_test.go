package main

import "testing"

func TestFrameNotificationLifecycleContinuesAfterManyFrames(t *testing.T) {
	var notifications frameNotificationState
	var paints framePaintState
	for generation := uint64(1); generation <= 500; generation++ {
		if !notifications.schedule() {
			t.Fatalf("generation %d did not schedule a notification", generation)
		}
		notifications.consume()
		if !paints.record(generation) {
			t.Fatalf("generation %d was not counted as unique", generation)
		}
	}
	if paints.paintEvents != 500 || paints.uniqueFramesPainted != 500 || notifications.pending {
		t.Fatalf("unexpected lifecycle state: %#v %#v", notifications, paints)
	}
}

func TestPaintEventsDoNotBecomeUniqueFramesAfterProductionStops(t *testing.T) {
	var paints framePaintState
	for i := 0; i < 10; i++ {
		paints.record(uint64(i + 1))
	}
	for i := 0; i < 1000; i++ {
		if paints.record(10) {
			t.Fatal("repaint without a new frame was counted as unique")
		}
	}
	if paints.uniqueFramesPainted != 10 || paints.paintEvents != 1010 {
		t.Fatalf("paint counters = %#v", paints)
	}
}
