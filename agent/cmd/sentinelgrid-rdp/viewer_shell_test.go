package main

import "testing"

func TestViewerLayoutReservesToolbarAndVideoHost(t *testing.T) {
	layout := viewerLayoutForClient(1280, 800)
	if layout.toolbar.height != viewerToolbarHeight || layout.video.y != viewerToolbarHeight || layout.video.height != 750 {
		t.Fatalf("layout = %#v", layout)
	}
	if layout.actionAt(10, 10) != "" || layout.actionAt(layout.buttons["fit"].x+1, 11) != "fit" || layout.actionAt(layout.buttons["input"].x+1, 11) != "input" {
		t.Fatalf("toolbar hit testing is incorrect: %#v", layout.buttons)
	}
}

func TestActualSizeRectCentersOnlyWhenFrameFits(t *testing.T) {
	if got, ok := actualSizeRect(1280, 720, 800, 600); !ok || got != (imageRect{x: 240, y: 60, width: 800, height: 600}) {
		t.Fatalf("actual size = %#v, %t", got, ok)
	}
	if _, ok := actualSizeRect(800, 600, 1920, 1080); ok {
		t.Fatal("oversized remote frame must not be unpredictably cropped")
	}
}

func TestMapClientPointUsesVideoHostCoordinatesAfterResize(t *testing.T) {
	layout := viewerLayoutForClient(1000, 800)
	x, y, ok := mapClientPoint(layout.video.width, layout.video.height, 1920, 1080, 0, 94)
	if !ok || x != 0 || y != 0 {
		t.Fatalf("top left video point = (%d, %d, %t)", x, y, ok)
	}
	x, y, ok = mapClientPoint(layout.video.width, layout.video.height, 1920, 1080, 999, 655)
	if !ok || x != 1919 || y != 1079 {
		t.Fatalf("bottom right video point = (%d, %d, %t)", x, y, ok)
	}
	if _, _, ok = mapClientPoint(layout.video.width, layout.video.height, 1920, 1080, 500, 20); ok {
		t.Fatal("letterbox coordinate was accepted")
	}
}

func TestToolbarClickIsOutsideVideoHost(t *testing.T) {
	layout := viewerLayoutForClient(1280, 800)
	if layout.video.y == 0 || layout.actionAt(layout.buttons["disconnect"].x+1, 11) != "disconnect" {
		t.Fatalf("toolbar is not excluded from video input: %#v", layout)
	}
}
