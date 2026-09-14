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
		if !notifications.shouldPresent(generation) {
			t.Fatalf("generation %d was not selected for presentation", generation)
		}
		notifications.markAttempted(generation)
		if !paints.record(generation) {
			t.Fatalf("generation %d was not counted as unique", generation)
		}
	}
	if paints.paintEvents != 500 || paints.uniqueFramesPainted != 500 || notifications.pending || notifications.lastAttemptedGeneration != 500 {
		t.Fatalf("unexpected lifecycle state: %#v %#v", notifications, paints)
	}
}

func TestFrameNotificationLatestFrameWins(t *testing.T) {
	var notifications frameNotificationState
	if !notifications.schedule() {
		t.Fatal("first decoded frame did not wake the UI")
	}
	for generation := uint64(2); generation <= 500; generation++ {
		if notifications.schedule() {
			t.Fatalf("generation %d queued redundant UI work", generation)
		}
	}
	notifications.consume()
	if !notifications.shouldPresent(500) {
		t.Fatal("latest generation was not presented")
	}
	notifications.markAttempted(500)
	if notifications.shouldPresent(500) {
		t.Fatal("same generation was presented twice")
	}
}

func TestFailedFrameNotificationPostAllowsRetry(t *testing.T) {
	var notifications frameNotificationState
	if !notifications.schedule() {
		t.Fatal("first post was not scheduled")
	}
	notifications.cancel()
	if !notifications.schedule() {
		t.Fatal("failed post permanently blocked future UI wake-ups")
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
