package main

import (
	"testing"

	"github.com/gorilla/websocket"
)

func TestInputIsDisabledAfterRelayClose(t *testing.T) {
	viewer := &viewer{ws: &websocket.Conn{}}
	if !viewer.inputEnabled() {
		t.Fatal("connected viewer rejected input")
	}
	viewer.sessionClosed = true
	if viewer.inputEnabled() {
		t.Fatal("closed viewer accepted input")
	}
}

func TestPaintResultRequiresPositiveScanlineCount(t *testing.T) {
	viewer := &viewer{logger: &viewerLogger{}, status: "Starting video..."}
	viewer.recordPaintResult(0, 1920, 1080, 1280, 800, 1)
	if viewer.paintState.paintEvents != 0 || viewer.status != "Starting video..." {
		t.Fatalf("zero scanline result was treated as visible paint: %#v", viewer)
	}
	viewer.recordPaintResult(-1, 1920, 1080, 1280, 800, 1)
	if viewer.paintState.paintEvents != 0 {
		t.Fatal("GDI_ERROR was treated as visible paint")
	}
	viewer.recordPaintResult(1080, 1920, 1080, 1280, 800, 1)
	if viewer.paintState.paintEvents != 1 || viewer.paintState.uniqueFramesPainted != 1 {
		t.Fatalf("positive scanline result was not recorded: %#v", viewer.paintState)
	}
	if viewer.status != "" {
		t.Fatalf("status after first visible frame = %q, want empty", viewer.status)
	}
}
