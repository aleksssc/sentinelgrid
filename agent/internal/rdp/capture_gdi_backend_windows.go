//go:build windows

package rdp

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"time"
	"unsafe"
)

func captureGDIBGRARecover(ctx context.Context) (captureFrame, int, error) {
	var last error
	for attempt := 1; attempt <= gdiCaptureAttempts; attempt++ {
		frame, err := captureGDIBGRA()
		if err == nil {
			return frame, attempt, nil
		}
		last = err
		if !recoverableGDICaptureError(err) || attempt == gdiCaptureAttempts {
			break
		}
		timer := time.NewTimer(75 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return captureFrame{}, attempt, ctx.Err()
		case <-timer.C:
		}
	}
	return captureFrame{}, gdiCaptureAttempts, last
}

func captureGDIBGRA() (captureFrame, error) {
	started := time.Now()
	width, height := screenSize()
	info, pixelSize, err := newCaptureDIBInfo(width, height)
	if err != nil {
		return captureFrame{}, err
	}
	dc, _, callErr := getDC.Call(0)
	if dc == 0 {
		return captureFrame{}, captureAPIError("CAPTURE_GETDC_FAILED", width, height, dc, callErr)
	}
	defer releaseDC.Call(0, dc)
	memory, _, callErr := createCompatibleDC.Call(dc)
	if memory == 0 {
		return captureFrame{}, captureAPIError("CAPTURE_CREATE_DC_FAILED", width, height, memory, callErr)
	}
	defer deleteDC.Call(memory)
	var bits unsafe.Pointer
	bitmap, _, callErr := createDIBSection.Call(dc, uintptr(unsafe.Pointer(&info)), dibRGBColors, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if bitmap == 0 || bits == nil {
		return captureFrame{}, captureAPIError("CAPTURE_DIB_SECTION_FAILED", width, height, bitmap, callErr)
	}
	defer deleteObject.Call(bitmap)
	old, _, callErr := selectObject.Call(memory, bitmap)
	if old == 0 || old == ^uintptr(0) {
		return captureFrame{}, captureAPIError("CAPTURE_SELECT_FAILED", width, height, old, callErr)
	}
	defer selectObject.Call(memory, old)
	const srccopyCaptureBlt = 0x00CC0020 | 0x40000000
	copied, _, callErr := bitBlt.Call(memory, 0, 0, uintptr(width), uintptr(height), dc, 0, 0, srccopyCaptureBlt)
	if copied == 0 {
		return captureFrame{}, captureAPIError("CAPTURE_BITBLT_FAILED", width, height, copied, callErr)
	}
	pixels := append([]byte(nil), unsafe.Slice((*byte)(bits), pixelSize)...)
	return captureFrame{Width: width, Height: height, BGRA: pixels, Stride: width * captureBytesPerPixel, Acquire: time.Since(started)}, nil
}

func encodeJPEG(img image.Image) ([]byte, time.Duration, error) {
	started := time.Now()
	var out bytes.Buffer
	for _, quality := range []int{75, 65, 55} {
		out.Reset()
		if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: quality}); err != nil {
			return nil, 0, fmt.Errorf("CAPTURE_JPEG_FAILED: %w", err)
		}
		if out.Len() <= maxRemotePacket-1 {
			return out.Bytes(), time.Since(started), nil
		}
	}
	return nil, 0, fmt.Errorf("CAPTURE_JPEG_FAILED reason=frame_exceeds_limit")
}
