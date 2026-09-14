//go:build windows

package rdp

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNativeDXGIDesktopDuplicationHarness(t *testing.T) {
	if os.Getenv("SENTINELGRID_DXGI_HARNESS") != "1" {
		t.Skip("set SENTINELGRID_DXGI_HARNESS=1 after building the native DLL")
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	dll := filepath.Join(wd, "..", "..", "..", "dist", "native", "video", nativeVideoDLLName)
	backend, err := newNativeDXGICaptureBackendAt(dll, func(message string) { t.Log(message) })
	if err != nil {
		t.Fatalf("native DLL load: %v", err)
	}
	defer backend.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	if err := backend.Start(ctx); err != nil {
		t.Fatalf("native DXGI initialization: %v", err)
	}
	width, height := backend.Dimensions()
	if width <= 0 || height <= 0 {
		t.Fatalf("invalid dimensions %dx%d", width, height)
	}
	started := time.Now()
	frames := 0
	for frames < 300 && ctx.Err() == nil {
		frame, changed, captureErr := backend.Capture(ctx)
		if captureErr != nil {
			t.Fatalf("capture after %d frames: %v", frames, captureErr)
		}
		if !changed {
			continue
		}
		if frame.Width != width || frame.Height != height || len(frame.BGRA) != width*height*4 {
			t.Fatalf("invalid BGRA frame %dx%d bytes=%d", frame.Width, frame.Height, len(frame.BGRA))
		}
		frames++
	}
	if frames != 300 {
		t.Fatalf("captured %d frames", frames)
	}
	elapsed := time.Since(started)
	t.Logf("NATIVE DXGI Go->DLL capture: frames=%d resolution=%dx%d duration=%s fps=%.2f", frames, width, height, elapsed.Round(time.Millisecond), float64(frames)/elapsed.Seconds())
}

func TestGDICaptureBackendFallback(t *testing.T) {
	backend := &gdiCaptureBackend{}
	if err := backend.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	frame, changed, err := backend.Capture(context.Background())
	if err != nil || !changed || len(frame.BGRA) == 0 {
		t.Fatalf("GDI fallback changed=%t err=%v bytes=%d", changed, err, len(frame.BGRA))
	}
}
