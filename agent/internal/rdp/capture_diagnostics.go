package rdp

import (
	"errors"
	"fmt"
	"syscall"
)

const captureBytesPerPixel = 4
const maxDIBDimension = 1<<31 - 1

// captureAPIError records only stable Win32 diagnostics and display dimensions.
// It deliberately does not include desktop, window, or environment content.
func captureAPIError(stage string, width, height int, result uintptr, callErr error) error {
	var errno syscall.Errno
	lastError := uint32(0)
	if errors.As(callErr, &errno) {
		lastError = uint32(errno)
	}
	return fmt.Errorf("%s width=%d height=%d result=%#x last_error=%d", stage, width, height, result, lastError)
}

func capturePixelBufferSize(width, height int) (int, error) {
	maxInt := int(^uint(0) >> 1)
	if width < 1 || height < 1 || width > maxDIBDimension || height > maxDIBDimension || width > maxInt/captureBytesPerPixel || height > maxInt/(width*captureBytesPerPixel) {
		return 0, fmt.Errorf("CAPTURE_DIMENSIONS_INVALID width=%d height=%d", width, height)
	}
	return width * height * captureBytesPerPixel, nil
}
