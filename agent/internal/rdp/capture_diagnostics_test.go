package rdp

import (
	"errors"
	"strings"
	"syscall"
	"testing"
)

func TestCaptureAPIErrorIncludesOnlyStageDimensionsResultAndWin32Error(t *testing.T) {
	err := captureAPIError("CAPTURE_BITBLT_FAILED", 1920, 1080, 0, syscall.Errno(5))
	message := err.Error()
	for _, want := range []string{"CAPTURE_BITBLT_FAILED", "width=1920", "height=1080", "result=0x0", "last_error=5"} {
		if !strings.Contains(message, want) {
			t.Fatalf("capture diagnostic %q does not contain %q", message, want)
		}
	}
	if strings.Contains(message, "Access is denied") {
		t.Fatalf("capture diagnostic must use the numeric Win32 error only: %q", message)
	}
}

func TestCaptureAPIErrorHandlesMissingLastError(t *testing.T) {
	if got := captureAPIError("CAPTURE_GETDC_FAILED", 1, 1, 0, errors.New("unexpected")).Error(); !strings.Contains(got, "last_error=0") {
		t.Fatalf("missing Win32 error was not normalized: %q", got)
	}
}

func TestCapturePixelBufferSize(t *testing.T) {
	if got, err := capturePixelBufferSize(2, 3); err != nil || got != 24 {
		t.Fatalf("size = %d, %v; want 24, nil", got, err)
	}
	if _, err := capturePixelBufferSize(0, 1); err == nil || !strings.Contains(err.Error(), "CAPTURE_DIMENSIONS_INVALID") {
		t.Fatalf("invalid dimensions did not fail diagnostically: %v", err)
	}
	if _, err := capturePixelBufferSize(int(^uint(0)>>1), 2); err == nil {
		t.Fatal("overflowing dimensions were accepted")
	}
}
