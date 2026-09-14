//go:build windows

package rdp

import (
	"context"
	"fmt"
	"image"
	"time"
)

type captureFrame struct {
	Width, Height           int
	BGRA                    []byte
	Stride                  int
	Acquire, Copy, Readback time.Duration
}

type CaptureBackend interface {
	Start(context.Context) error
	Capture(context.Context) (captureFrame, bool, error)
	Dimensions() (int, int)
	Close() error
}

type gdiCaptureBackend struct{ width, height int }

func (b *gdiCaptureBackend) Start(context.Context) error {
	b.width, b.height = screenSize()
	if b.width <= 0 || b.height <= 0 {
		return fmt.Errorf("GDI primary display unavailable")
	}
	return nil
}
func (b *gdiCaptureBackend) Dimensions() (int, int) { return b.width, b.height }
func (b *gdiCaptureBackend) Close() error           { return nil }
func (b *gdiCaptureBackend) Capture(ctx context.Context) (captureFrame, bool, error) {
	frame, attempts, err := captureGDIBGRARecover(ctx)
	if err != nil {
		return captureFrame{}, false, err
	}
	if attempts <= 1 {
		b.width, b.height = frame.Width, frame.Height
	}
	return frame, true, nil
}

func newPreferredCaptureBackend(ctx context.Context) (CaptureBackend, string, error) {
	return newPreferredCaptureBackendWithDiagnostics(ctx, nil)
}
func newPreferredCaptureBackendWithDiagnostics(ctx context.Context, diagnostic func(string)) (CaptureBackend, string, error) {
	native, err := newNativeDXGICaptureBackend(diagnostic)
	if err == nil {
		err = native.Start(ctx)
	}
	if err == nil {
		return native, "dxgi_native", nil
	}
	if native != nil {
		_ = native.Close()
	}
	gdi := &gdiCaptureBackend{}
	if gdiErr := gdi.Start(ctx); gdiErr != nil {
		return nil, "", fmt.Errorf("native DXGI unavailable (%s); GDI unavailable: %w", nativeDXGIFailureCategory(err), gdiErr)
	}
	return gdi, "gdi reason=" + nativeDXGIFailureCategory(err), nil
}
func nativeDXGIFailureCategory(err error) string {
	if err == nil {
		return "unavailable"
	}
	return "unavailable"
}

func encodeCaptureFrame(frame captureFrame) ([]byte, captureTiming, error) {
	if frame.Width <= 0 || frame.Height <= 0 || len(frame.BGRA) < frame.Stride*frame.Height {
		return nil, captureTiming{}, fmt.Errorf("invalid capture frame")
	}
	conversionStarted := time.Now()
	img := image.NewRGBA(image.Rect(0, 0, frame.Width, frame.Height))
	for y := 0; y < frame.Height; y++ {
		for x := 0; x < frame.Width; x++ {
			source, target := y*frame.Stride+x*4, y*img.Stride+x*4
			img.Pix[target], img.Pix[target+1], img.Pix[target+2], img.Pix[target+3] = frame.BGRA[source+2], frame.BGRA[source+1], frame.BGRA[source], 0xff
		}
	}
	jpg, encodeDuration, err := encodeJPEG(img)
	return jpg, captureTiming{capture: frame.Acquire + frame.Copy + frame.Readback, pixelConversion: time.Since(conversionStarted) - encodeDuration, jpegEncode: encodeDuration}, err
}
