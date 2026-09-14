//go:build windows

package rdp

import (
	"errors"
	"testing"
)

func TestRecoverableGDICaptureError(t *testing.T) {
	for _, message := range []string{
		"CAPTURE_GETDC_FAILED width=1 height=1 result=0x0 last_error=5",
		"CAPTURE_CREATE_DC_FAILED width=1 height=1 result=0x0 last_error=5",
		"CAPTURE_DIB_SECTION_FAILED width=1 height=1 result=0x0 last_error=5",
		"CAPTURE_SELECT_FAILED width=1 height=1 result=0x0 last_error=5",
		"CAPTURE_BITBLT_FAILED width=1 height=1 result=0x0 last_error=5",
	} {
		if !recoverableGDICaptureError(errors.New(message)) {
			t.Fatalf("%q was not recoverable", message)
		}
	}
	for _, message := range []string{"CAPTURE_RESTORE_FAILED", "CAPTURE_JPEG_FAILED", "other"} {
		if recoverableGDICaptureError(errors.New(message)) {
			t.Fatalf("%q was incorrectly recoverable", message)
		}
	}
}
