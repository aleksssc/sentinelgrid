package main

import "testing"

func TestLatestCompressedFrameDropsStaleWork(t *testing.T) {
	queue := newLatestCompressedFrame()
	for i := 0; i < 1000; i++ {
		queue.replace(compressedFrame{data: []byte{byte(i)}})
	}
	frame, ok := queue.take()
	if !ok || len(frame.data) != 1 || frame.data[0] != byte(999%256) {
		t.Fatalf("take = %#v, %t; want latest frame", frame, ok)
	}
	if got := queue.dropCount(); got != 999 {
		t.Fatalf("dropped = %d, want 999", got)
	}
	if _, ok := queue.take(); ok {
		t.Fatal("queue retained a stale frame")
	}
}

func TestLatestCompressedFrameContinuesNotifications(t *testing.T) {
	queue := newLatestCompressedFrame()
	for i := 0; i < 100; i++ {
		queue.replace(compressedFrame{data: []byte{byte(i)}})
		<-queue.ready
		if _, ok := queue.take(); !ok {
			t.Fatalf("notification %d had no frame", i)
		}
	}
}

func TestLatestCompressedFrameCloseDropsPendingWorkAndRejectsNewFrames(t *testing.T) {
	queue := newLatestCompressedFrame()
	queue.replace(compressedFrame{data: []byte{1}})
	queue.close()
	if _, ok := queue.take(); ok {
		t.Fatal("closed queue returned pending compressed work")
	}
	if queue.replace(compressedFrame{data: []byte{2}}) {
		t.Fatal("closed queue accepted a compressed frame")
	}
	select {
	case <-queue.done:
	default:
		t.Fatal("close did not stop decode worker")
	}
}
