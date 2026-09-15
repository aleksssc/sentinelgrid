//go:build windows

package rdp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	nativeVideoDLLName     = "SentinelGridVideo.dll"
	dxgiErrorWaitTimeout   = syscall.Errno(0x887A0027)
	dxgiErrorAccessLost    = syscall.Errno(0x887A0026)
	dxgiErrorDeviceRemoved = syscall.Errno(0x887A0005)
	dxgiErrorDeviceReset   = syscall.Errno(0x887A0007)
)

type nativeVideoFrame struct {
	Width, Height, Stride, Reserved uint32
	AcquireMicroseconds             uint64
	GPUCopyMicroseconds             uint64
	MapReadbackMicroseconds         uint64
}

type nativeDXGICaptureBackend struct {
	mu                                          sync.Mutex
	dll                                         *windows.DLL
	create, destroy, start, dimensions, acquire *windows.Proc
	handle                                      uintptr
	width, height                               int
	closed                                      bool
	diagnostic                                  func(string)
}

func newNativeDXGICaptureBackend(diagnostic func(string)) (*nativeDXGICaptureBackend, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("native video executable path: %w", err)
	}
	return newNativeDXGICaptureBackendAt(filepath.Join(filepath.Dir(executable), nativeVideoDLLName), diagnostic)
}

func newNativeDXGICaptureBackendAt(path string, diagnostic func(string)) (*nativeDXGICaptureBackend, error) {
	dll, err := windows.LoadDLL(path)
	if err != nil {
		return nil, fmt.Errorf("native video DLL load: %w", err)
	}
	resolve := func(name string) (*windows.Proc, error) {
		proc, findErr := dll.FindProc(name)
		if findErr != nil {
			_ = dll.Release()
			return nil, fmt.Errorf("native video API %s: %w", name, findErr)
		}
		return proc, nil
	}
	create, err := resolve("SGVideo_Create")
	if err != nil {
		return nil, err
	}
	destroy, err := resolve("SGVideo_Destroy")
	if err != nil {
		return nil, err
	}
	start, err := resolve("SGVideo_StartCapture")
	if err != nil {
		return nil, err
	}
	dimensions, err := resolve("SGVideo_GetDimensions")
	if err != nil {
		return nil, err
	}
	acquire, err := resolve("SGVideo_AcquireFrame")
	if err != nil {
		return nil, err
	}
	return &nativeDXGICaptureBackend{dll: dll, create: create, destroy: destroy, start: start, dimensions: dimensions, acquire: acquire, diagnostic: diagnostic}, nil
}

func (b *nativeDXGICaptureBackend) Start(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.startLocked(ctx)
}

// Restart is called only after Capture has returned a DXGI terminal error. It
// keeps all duplication and D3D ownership on the host video goroutine.
func (b *nativeDXGICaptureBackend) Restart(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.startLocked(ctx)
}

func (b *nativeDXGICaptureBackend) startLocked(ctx context.Context) error {
	if b.closed {
		return fmt.Errorf("native DXGI backend is closed")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if b.handle == 0 {
		result, _, _ := b.create.Call(uintptr(unsafe.Pointer(&b.handle)))
		if err := nativeHRESULT(result); err != nil {
			return fmt.Errorf("native video create: %w", err)
		}
	}
	result, _, _ := b.start.Call(b.handle)
	if err := nativeHRESULT(result); err != nil {
		return fmt.Errorf("native DXGI initialization: %w", err)
	}
	var width, height uint32
	result, _, _ = b.dimensions.Call(b.handle, uintptr(unsafe.Pointer(&width)), uintptr(unsafe.Pointer(&height)))
	if err := nativeHRESULT(result); err != nil {
		return fmt.Errorf("native DXGI dimensions: %w", err)
	}
	if _, err := capturePixelBufferSize(int(width), int(height)); err != nil {
		return fmt.Errorf("native DXGI dimensions invalid: %dx%d", width, height)
	}
	b.width, b.height = int(width), int(height)
	b.event(fmt.Sprintf("DXGI_NATIVE_DUPLICATION_CREATED width=%d height=%d", width, height))
	return nil
}
func (b *nativeDXGICaptureBackend) Dimensions() (int, int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.width, b.height
}
func (b *nativeDXGICaptureBackend) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil
	}
	b.closed = true
	if b.handle != 0 {
		b.destroy.Call(b.handle)
		b.handle = 0
	}
	if b.dll != nil {
		return b.dll.Release()
	}
	return nil
}
func (b *nativeDXGICaptureBackend) Capture(ctx context.Context) (captureFrame, bool, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed || b.handle == 0 {
		return captureFrame{}, false, fmt.Errorf("native DXGI backend is closed")
	}
	if err := ctx.Err(); err != nil {
		return captureFrame{}, false, err
	}
	size, err := capturePixelBufferSize(b.width, b.height)
	if err != nil {
		return captureFrame{}, false, err
	}
	pixels := make([]byte, size)
	var native nativeVideoFrame
	result, _, _ := b.acquire.Call(b.handle, uintptr(unsafe.Pointer(&pixels[0])), uintptr(len(pixels)), 100, uintptr(unsafe.Pointer(&native)))
	if err := nativeHRESULT(result); err != nil {
		if errors.Is(err, dxgiErrorWaitTimeout) {
			return captureFrame{}, false, nil
		}
		return captureFrame{}, false, fmt.Errorf("native DXGI AcquireFrame: %w", err)
	}
	if native.Width == 0 || native.Height == 0 || native.Stride != native.Width*4 || int(native.Width) != b.width || int(native.Height) != b.height {
		return captureFrame{}, false, fmt.Errorf("native DXGI invalid frame dimensions")
	}
	return captureFrame{Width: b.width, Height: b.height, Stride: int(native.Stride), BGRA: pixels, Acquire: time.Duration(native.AcquireMicroseconds) * time.Microsecond, Copy: time.Duration(native.GPUCopyMicroseconds) * time.Microsecond, Readback: time.Duration(native.MapReadbackMicroseconds) * time.Microsecond}, true, nil
}
func isRecoverableDXGIError(err error) bool {
	return errors.Is(err, dxgiErrorAccessLost) || errors.Is(err, dxgiErrorDeviceRemoved) || errors.Is(err, dxgiErrorDeviceReset)
}
func (b *nativeDXGICaptureBackend) event(message string) {
	if b.diagnostic != nil {
		b.diagnostic(message)
	}
}
func nativeHRESULT(result uintptr) error {
	if int32(uint32(result)) < 0 {
		return syscall.Errno(uint32(result))
	}
	return nil
}
