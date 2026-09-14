package main

import (
	"image"
	"image/color"
	"testing"
)

func TestRGBAToBGRAKeepsColorChannels(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 6, 1))
	colors := []color.RGBA{{R: 255, A: 255}, {G: 255, A: 255}, {B: 255, A: 255}, {R: 255, G: 255, B: 255, A: 255}, {A: 255}, {R: 17, G: 91, B: 203, A: 255}}
	for x, value := range colors {
		source.SetRGBA(x, 0, value)
	}
	frame := rgbaToBGRA(source)
	if frame.width != 6 || frame.height != 1 || len(frame.pixels) != 24 {
		t.Fatalf("unexpected frame geometry: %+v", frame)
	}
	for x, want := range colors {
		offset := x * 4
		got := color.RGBA{R: frame.pixels[offset+2], G: frame.pixels[offset+1], B: frame.pixels[offset], A: 255}
		if got != want {
			t.Fatalf("pixel %d = %#v, want %#v", x, got, want)
		}
	}
}

func TestMapClientPointUsesRenderedImageAndRejectsLetterbox(t *testing.T) {
	cases := []struct {
		name                          string
		clientWidth, clientHeight     int
		imageWidth, imageHeight, x, y int
		wantX, wantY                  int
		ok                            bool
	}{
		{"top left", 1000, 1000, 1920, 1080, 0, 219, 0, 0, true},
		{"center", 1000, 1000, 1920, 1080, 500, 500, 960, 540, true},
		{"bottom right", 1000, 1000, 1920, 1080, 999, 780, 1919, 1079, true},
		{"top letterbox", 1000, 1000, 1920, 1080, 500, 100, 0, 0, false},
		{"pillarbox", 1000, 500, 800, 1200, 100, 250, 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			x, y, ok := mapClientPoint(tc.clientWidth, tc.clientHeight, tc.imageWidth, tc.imageHeight, tc.x, tc.y)
			if ok != tc.ok || (ok && (x != tc.wantX || y != tc.wantY)) {
				t.Fatalf("mapClientPoint = (%d, %d, %t), want (%d, %d, %t)", x, y, ok, tc.wantX, tc.wantY, tc.ok)
			}
		})
	}
}
