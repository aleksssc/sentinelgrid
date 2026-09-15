//go:build windows

package rdp

import (
	"context"
	"errors"
	"testing"
)

type restartableCaptureForTest struct {
	width, height int
	restarts      int
	err           error
}

func (b *restartableCaptureForTest) Start(context.Context) error { return nil }
func (b *restartableCaptureForTest) Capture(context.Context) (captureFrame, bool, error) {
	return captureFrame{}, false, nil
}
func (b *restartableCaptureForTest) Dimensions() (int, int) { return b.width, b.height }
func (b *restartableCaptureForTest) Close() error           { return nil }
func (b *restartableCaptureForTest) Restart(context.Context) error {
	b.restarts++
	return b.err
}

func TestRecoverRemoteCaptureRestartsOnlyMatchingDesktop(t *testing.T) {
	backend := &restartableCaptureForTest{width: 1920, height: 1080}
	if err := recoverRemoteCapture(context.Background(), nil, backend, backend, 1920, 1080, dxgiErrorAccessLost); err != nil {
		t.Fatalf("recovery failed: %v", err)
	}
	if backend.restarts != 1 {
		t.Fatalf("restarts = %d, want 1", backend.restarts)
	}
}

func TestRecoverRemoteCaptureRejectsChangedDesktop(t *testing.T) {
	backend := &restartableCaptureForTest{width: 1280, height: 720}
	err := recoverRemoteCapture(context.Background(), nil, backend, backend, 1920, 1080, dxgiErrorAccessLost)
	if err == nil {
		t.Fatal("dimension change was accepted")
	}
}

func TestRecoverRemoteCaptureBoundsFailedRestarts(t *testing.T) {
	backend := &restartableCaptureForTest{width: 1920, height: 1080, err: errors.New("recreate failed")}
	if err := recoverRemoteCapture(context.Background(), nil, backend, backend, 1920, 1080, dxgiErrorAccessLost); err == nil {
		t.Fatal("failed recovery returned nil")
	}
	if backend.restarts != 3 {
		t.Fatalf("restarts = %d, want 3", backend.restarts)
	}
}

func TestRecoverableDXGIError(t *testing.T) {
	if !isRecoverableDXGIError(dxgiErrorAccessLost) || !isRecoverableDXGIError(dxgiErrorDeviceRemoved) || !isRecoverableDXGIError(dxgiErrorDeviceReset) {
		t.Fatal("recoverable DXGI errors were not classified")
	}
	if isRecoverableDXGIError(dxgiErrorWaitTimeout) {
		t.Fatal("wait timeout was incorrectly classified as recoverable")
	}
}
