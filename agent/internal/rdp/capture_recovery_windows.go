//go:build windows

package rdp

import (
	"context"
	"strings"
	"time"
)

const gdiCaptureAttempts = 3

// capturePrimaryJPEGRecover retries only transient desktop/DC failures. Each
// capture owns its DC and DIB resources, so the next attempt is a real resource
// reconstruction rather than reuse of a potentially stale object.
func capturePrimaryJPEGRecover(ctx context.Context) ([]byte, captureTiming, int, error) {
	var timing captureTiming
	var err error
	for attempt := 1; attempt <= gdiCaptureAttempts; attempt++ {
		frame, frameTiming, captureErr := capturePrimaryJPEGTimed()
		if captureErr == nil {
			return frame, frameTiming, attempt, nil
		}
		timing, err = frameTiming, captureErr
		if !recoverableGDICaptureError(err) || attempt == gdiCaptureAttempts {
			break
		}
		timer := time.NewTimer(75 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, timing, attempt, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, timing, gdiCaptureAttempts, err
}

func recoverableGDICaptureError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.HasPrefix(message, "CAPTURE_GETDC_FAILED") ||
		strings.HasPrefix(message, "CAPTURE_CREATE_DC_FAILED") ||
		strings.HasPrefix(message, "CAPTURE_DIB_SECTION_FAILED") ||
		strings.HasPrefix(message, "CAPTURE_SELECT_FAILED") ||
		strings.HasPrefix(message, "CAPTURE_BITBLT_FAILED")
}
