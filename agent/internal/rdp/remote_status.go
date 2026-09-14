package rdp

import (
	"errors"
	"strings"
)

type remoteHostStageError struct {
	stage string
	err   error
}

func (e *remoteHostStageError) Error() string { return e.err.Error() }
func (e *remoteHostStageError) Unwrap() error { return e.err }

func remoteHostFailure(stage string, err error) error {
	if err == nil {
		return nil
	}
	return &remoteHostStageError{stage: stage, err: err}
}

func remoteCaptureStage(err error) string {
	if err == nil {
		return "capture"
	}
	for prefix, stage := range map[string]string{
		"CAPTURE_GETDC_FAILED":     "capture-getdc",
		"CAPTURE_CREATE_DC_FAILED": "capture-create-dc",
		"CAPTURE_BITMAP_FAILED":    "capture-bitmap",
		"CAPTURE_SELECT_FAILED":    "capture-select",
		"CAPTURE_BITBLT_FAILED":    "capture-bitblt",
		"CAPTURE_RESTORE_FAILED":   "capture-restore",
		"CAPTURE_GETDIBITS_FAILED": "capture-getdibits",
		"CAPTURE_JPEG_FAILED":      "capture-jpeg",
	} {
		if strings.HasPrefix(err.Error(), prefix) {
			return stage
		}
	}
	return "capture"
}

func RemoteHostExitCode(err error) int {
	var stageErr *remoteHostStageError
	if !errors.As(err, &stageErr) {
		return 1
	}
	switch stageErr.stage {
	case "environment":
		return 21
	case "logger":
		return 22
	case "relay":
		return 23
	case "pairing":
		return 24
	case "screen-info":
		return 25
	case "capture":
		return 26
	case "frame-send":
		return 27
	case "capture-getdc":
		return 31
	case "capture-create-dc":
		return 32
	case "capture-bitmap":
		return 33
	case "capture-select":
		return 34
	case "capture-bitblt":
		return 35
	case "capture-restore":
		return 36
	case "capture-getdibits":
		return 37
	case "capture-jpeg":
		return 38
	default:
		return 1
	}
}

func remoteHostExitReason(code uint32) string {
	switch code {
	case 0:
		return "success"
	case 21:
		return "environment"
	case 22:
		return "logger"
	case 23:
		return "relay_dial"
	case 24:
		return "pairing"
	case 25:
		return "screen_info"
	case 26:
		return "capture"
	case 27:
		return "first_frame_send"
	case 31:
		return "capture_getdc"
	case 32:
		return "capture_create_dc"
	case 33:
		return "capture_bitmap"
	case 34:
		return "capture_select"
	case 35:
		return "capture_bitblt"
	case 36:
		return "capture_restore"
	case 37:
		return "capture_getdibits"
	case 38:
		return "capture_jpeg"
	default:
		return "unclassified"
	}
}
