//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type nativeRendererStats struct {
	RenderAttempts, SuccessfulPresents, FailedPresents, DeviceResets, LastPresentMicroseconds uint64
	ViewportX, ViewportY, ViewportWidth, ViewportHeight                                       uint32
}

type nativeRenderer struct {
	mu                                             sync.Mutex
	dll                                            *windows.DLL
	destroy, render, resizeProc, redrawProc, stats *windows.Proc
	handle                                         uintptr
}

func newNativeRenderer(hwnd uintptr) (*nativeRenderer, error) {
	if os.Getenv("SENTINELGRID_VIEWER_RENDERER") == "gdi" {
		return nil, fmt.Errorf("renderer forced to gdi")
	}
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("renderer executable path: %w", err)
	}
	dll, err := windows.LoadDLL(filepath.Join(filepath.Dir(exe), "SentinelGridVideo.dll"))
	if err != nil {
		return nil, fmt.Errorf("renderer DLL load: %w", err)
	}
	find := func(name string) (*windows.Proc, error) {
		p, e := dll.FindProc(name)
		if e != nil {
			_ = dll.Release()
			return nil, fmt.Errorf("renderer ABI %s: %w", name, e)
		}
		return p, nil
	}
	create, err := find("SGVideo_CreateRenderer")
	if err != nil {
		return nil, err
	}
	destroy, err := find("SGVideo_DestroyRenderer")
	if err != nil {
		return nil, err
	}
	render, err := find("SGVideo_RenderBGRA")
	if err != nil {
		return nil, err
	}
	resizeProc, err := find("SGVideo_ResizeRenderer")
	if err != nil {
		return nil, err
	}
	redrawProc, err := find("SGVideo_RedrawRenderer")
	if err != nil {
		return nil, err
	}
	stats, err := find("SGVideo_GetRendererStats")
	if err != nil {
		return nil, err
	}
	r := &nativeRenderer{dll: dll, destroy: destroy, render: render, resizeProc: resizeProc, redrawProc: redrawProc, stats: stats}
	result, _, _ := create.Call(hwnd, uintptr(unsafe.Pointer(&r.handle)))
	if err := nativeRendererHRESULT(result); err != nil {
		_ = dll.Release()
		return nil, fmt.Errorf("renderer create: %w", err)
	}
	return r, nil
}
func nativeRendererHRESULT(result uintptr) error {
	if int32(uint32(result)) < 0 {
		return windows.Errno(uint32(result))
	}
	return nil
}
func (r *nativeRenderer) renderFrame(frame viewerFrame) error {
	if !frame.valid() {
		return fmt.Errorf("invalid BGRA frame")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.handle == 0 {
		return fmt.Errorf("renderer closed")
	}
	result, _, _ := r.render.Call(r.handle, uintptr(unsafe.Pointer(&frame.pixels[0])), uintptr(frame.width), uintptr(frame.height), uintptr(frame.stride))
	if err := nativeRendererHRESULT(result); err != nil {
		return fmt.Errorf("renderer present: %w", err)
	}
	return nil
}
func (r *nativeRenderer) resize(width, height int) error {
	if width <= 0 || height <= 0 {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.handle == 0 {
		return nil
	}
	result, _, _ := r.resizeProc.Call(r.handle, uintptr(width), uintptr(height))
	return nativeRendererHRESULT(result)
}
func (r *nativeRenderer) redraw() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.handle == 0 {
		return nil
	}
	result, _, _ := r.redrawProc.Call(r.handle)
	return nativeRendererHRESULT(result)
}
func (r *nativeRenderer) snapshot() nativeRendererStats {
	r.mu.Lock()
	defer r.mu.Unlock()
	var value nativeRendererStats
	if r.handle != 0 {
		r.stats.Call(r.handle, uintptr(unsafe.Pointer(&value)))
	}
	return value
}
func (r *nativeRenderer) close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.handle != 0 {
		r.destroy.Call(r.handle)
		r.handle = 0
	}
	if r.dll != nil {
		_ = r.dll.Release()
		r.dll = nil
	}
}
