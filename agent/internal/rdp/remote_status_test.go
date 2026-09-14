package rdp

import (
	"errors"
	"testing"
)

func TestRemoteHostExitCode(t *testing.T) {
	for stage, want := range map[string]int{
		"environment":       21,
		"logger":            22,
		"relay":             23,
		"pairing":           24,
		"screen-info":       25,
		"capture":           26,
		"frame-send":        27,
		"capture-bitmap":    33,
		"capture-getdibits": 37,
		"capture-jpeg":      38,
	} {
		if got := RemoteHostExitCode(remoteHostFailure(stage, errors.New("failure"))); got != want {
			t.Fatalf("stage %s exit code = %d, want %d", stage, got, want)
		}
	}
	if got := RemoteHostExitCode(errors.New("failure")); got != 1 {
		t.Fatalf("unclassified exit code = %d, want 1", got)
	}
}

func TestRemoteCaptureStage(t *testing.T) {
	for message, want := range map[string]string{
		"CAPTURE_GETDC_FAILED width=1 height=1 result=0x0 last_error=5":       "capture-getdc",
		"CAPTURE_DIB_SECTION_FAILED width=1 height=1 result=0x0 last_error=5": "capture-bitmap",
		"CAPTURE_BITBLT_FAILED width=1 height=1 result=0x0 last_error=5":      "capture-bitblt",
		"CAPTURE_JPEG_FAILED width=1 height=1":                                "capture-jpeg",
		"unrelated capture failure":                                           "capture",
	} {
		if got := remoteCaptureStage(errors.New(message)); got != want {
			t.Fatalf("stage for %q = %q, want %q", message, got, want)
		}
	}
}

func TestRemoteHostExitReason(t *testing.T) {
	if got := remoteHostExitReason(37); got != "capture_getdibits" {
		t.Fatalf("GetDIBits reason = %q", got)
	}
	if got := remoteHostExitReason(99); got != "unclassified" {
		t.Fatalf("unknown exit reason = %q", got)
	}
}

func TestRemoteLoggerAccessContract(t *testing.T) {
	if remoteLogAppendAccess != 0x00100004 {
		t.Fatalf("logger access = %#x, want SYNCHRONIZE|FILE_APPEND_DATA", remoteLogAppendAccess)
	}
	if remoteLogShareMode != 0x00000003 || remoteLogDisposition != 3 {
		t.Fatalf("logger open contract changed: share=%#x disposition=%d", remoteLogShareMode, remoteLogDisposition)
	}
}
